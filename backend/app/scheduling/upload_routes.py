"""Scoped draft preview, verified TEST uploads and durable upload receipts."""

import asyncio
from collections import Counter
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import AuditEvent, MaximoConnection, UploadBatch, UploadItem
from app.maximo.contract_probe import OPERATOR_WORKTYPES
from app.maximo.detail import read_detail
from app.maximo.sender import NativeTestTransport, write_enabled
from app.scheduling.batches import BatchKey, BatchPrepare, snapshots
from app.scheduling.changes import WorkOrderBaseline
from app.scheduling.drafts import WorkOrderKey, require_scope
from app.scheduling.routes import actor_after_io, checked_settings, owned_draft
from app.scheduling.upload_service import (
    create_upload,
    finalize_confirmed,
    immutable_item,
    pm_schedule_change,
    prepare_upload,
    preview_warnings,
    reconcile_unknown,
    send_pending,
)


class PrivateRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private(request):
            try:
                response = await handler(request)
            except HTTPException as error:
                error.headers = {**(error.headers or {}), "Cache-Control": "no-store"}
                raise
            except RequestValidationError as error:
                response = await request_validation_exception_handler(request, error)
            response.headers["Cache-Control"] = "no-store"
            return response

        return private


router = APIRouter(prefix="/api", route_class=PrivateRoute)


class UploadSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(gt=0, strict=True)
    items: list[BatchKey] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def unique_items(self):
        keys = [(item.site_id, item.workorder_id) for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate work order identity")
        return self


class UploadSubmit(UploadSelection):
    request_id: UUID
    preview_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


async def preview_data(request, draft_id, payload, *, return_prepared=False):
    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        verify_csrf(actor, request.headers.get("X-CSRF-Token"))
        draft, members = await owned_draft(db, actor.user_id, draft_id)
        if draft.version != payload.version:
            raise HTTPException(409, "Draft changed; reopen before uploading")
        keys = {(item.site_id, item.workorder_id) for item in payload.items}
        selected = [item for item in members if (item.site_id, item.workorder_id) in keys]
        if len(selected) != len(keys):
            raise HTTPException(404, "Draft member not found")
        connection = await db.get(MaximoConnection, draft.connection_id)
        enabled = bool(connection and write_enabled(request.app.state.settings, connection))
        disciplines = {item.discipline for item in selected}
        if len(disciplines) != 1:
            raise HTTPException(409, "Select members from one discipline")
        batch = BatchPrepare(
            connection_id=draft.connection_id,
            discipline=selected[0].discipline,
            items=payload.items,
        )
    identity, results = await snapshots(request, batch)
    if identity.user_id != actor.user_id:
        raise HTTPException(401, "Sign-in required")
    current = {snapshot.key: snapshot for _, snapshot in results}
    enabled = enabled and all(
        snapshot.baseline.worktype in OPERATOR_WORKTYPES for snapshot in current.values()
    )
    if enabled:
        async with request.app.state.maximo_client_factory() as client:
            transport = NativeTestTransport(
                request, actor.user_id, batch.connection_id, batch.discipline, client
            )
            semaphore = asyncio.Semaphore(4)

            async def pinned(key):
                async with semaphore:
                    return key, await transport.read(key)

            async with asyncio.timeout(
                request.app.state.settings.maximo[batch.connection_id].retrieval_timeout_seconds
            ):
                verified = await asyncio.gather(
                    *(pinned(key) for key in current), return_exceptions=True
                )
                if any(isinstance(result, Exception) for result in verified):
                    raise HTTPException(409, "Selected work orders could not be verified")
                current = dict(verified)

    async def reader(key):
        return current[key]

    async with request.app.state.sessions.begin() as db:
        await actor_after_io(request, db, actor)
        # Serialize final source snapshot against edits and Planner revocation.
        for item in selected:
            await require_scope(
                db,
                actor.user_id,
                WorkOrderKey(batch.connection_id, item.site_id, item.workorder_id),
                item.discipline,
                write=True,
            )
        await owned_draft(db, actor.user_id, draft_id, lock=True)
        prepared = await prepare_upload(
            db,
            actor.user_id,
            draft_id,
            payload.version,
            payload.items,
            reader,
            pin_current_revision=enabled,
        )
    data = {
        "draft_id": str(draft_id),
        "version": prepared.version,
        "preview_hash": prepared.preview_hash,
        "send_enabled": enabled,
        "gate": None if enabled else "write_contract_unverified",
        "items": [
            {
                "site_id": item.key.site_id,
                "workorder_id": item.key.workorder_id,
                "code": item.code,
                "before": {field: item.before[field] for field in item.changes},
                "changes": item.changes,
                "warnings": preview_warnings(item),
            }
            for item in prepared.items
        ],
    }

    return (data, prepared, actor.user_id) if return_prepared else data


@router.post("/drafts/{draft_id}/upload-preview")
async def preview(request: Request, response: Response, draft_id: UUID, payload: UploadSelection):
    response.headers["Cache-Control"] = "no-store"
    return await preview_data(request, draft_id, payload)


async def existing_receipt(request, draft_id, payload):
    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        verify_csrf(actor, request.headers.get("X-CSRF-Token"))
        existing = await db.scalar(
            select(UploadBatch).where(
                UploadBatch.actor_id == actor.user_id,
                UploadBatch.idempotency_key == payload.request_id,
            )
        )
        if existing:
            sources = list(
                (
                    await db.scalars(
                        select(AuditEvent)
                        .join(UploadItem)
                        .where(UploadItem.batch_id == existing.id, AuditEvent.event == "prepared")
                    )
                ).all()
            )
            keys = {(item.site_id, item.workorder_id) for item in payload.items}
            if (
                existing.request_hash != payload.preview_hash
                or not sources
                or any(
                    event.details.get("draft_id") != str(draft_id)
                    or event.details.get("draft_version") != payload.version
                    for event in sources
                )
                or {(event.details["site_id"], event.details["workorder_id"]) for event in sources}
                != keys
            ):
                raise HTTPException(409, "Request ID already used for a different upload")
            batch_id = existing.id
        else:
            batch_id = None
    return batch_id


@router.post("/drafts/{draft_id}/uploads")
async def submit(request: Request, draft_id: UUID, payload: UploadSubmit):
    batch_id = await existing_receipt(request, draft_id, payload)
    if batch_id is not None:
        return await status(request, Response(), batch_id)
    try:
        data, prepared, actor_id = await preview_data(
            request, draft_id, payload, return_prepared=True
        )
    except HTTPException as error:
        if error.status_code not in {404, 409}:
            raise
        receipt = await existing_receipt(request, draft_id, payload)
        if receipt is None:
            raise
        return await status(request, Response(), receipt)
    if data["preview_hash"] != payload.preview_hash:
        receipt = await existing_receipt(request, draft_id, payload)
        if receipt is not None:
            return await status(request, Response(), receipt)
        raise HTTPException(409, "Preview changed; preview again")
    if not data["send_enabled"]:
        raise HTTPException(409, {"code": "write_contract_unverified", "send_enabled": False})
    batch_id, created = await create_upload(
        request.app.state.sessions,
        actor_id,
        payload.request_id,
        prepared,
        payload.preview_hash,
        return_created=True,
    )
    if created:
        await execute_batch(request, actor_id, batch_id)
    return await status(request, Response(), batch_id)


@router.get("/uploads/by-request/{request_id}")
async def receipt_by_request(request: Request, response: Response, request_id: UUID):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        batch_id = await db.scalar(
            select(UploadBatch.id).where(
                UploadBatch.actor_id == actor.user_id, UploadBatch.idempotency_key == request_id
            )
        )
    if batch_id is None:
        # Absence is an observation, not proof an in-flight submission cannot commit.
        raise HTTPException(404, {"code": "receipt_not_found"})
    return await status(request, response, batch_id)


@router.get("/uploads/{batch_id}")
async def status(request: Request, response: Response, batch_id: UUID):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        batch = await db.scalar(
            select(UploadBatch).where(
                UploadBatch.id == batch_id,
                UploadBatch.actor_id == actor.user_id,
            )
        )
        if batch is None:
            raise HTTPException(404, "Upload not found")
        items = list(
            (
                await db.scalars(
                    select(UploadItem)
                    .where(
                        UploadItem.batch_id == batch_id,
                    )
                    .order_by(UploadItem.site_id, UploadItem.workorder_id)
                )
            ).all()
        )
    for item in items:
        key = WorkOrderKey(item.connection_id, item.site_id, item.workorder_id)
        identity, settings = await checked_settings(request, key, item.discipline)
        if identity.user_id != actor.user_id:
            raise HTTPException(401, "Sign-in required")
        # Historical status needs current discipline/scope, not scheduling eligibility or crew.
        async with request.app.state.maximo_client_factory() as client:
            order = await read_detail(client, settings, key, item.discipline)
        if order is None:
            raise HTTPException(404, "Upload not found")
        fresh_identity, _ = await checked_settings(request, key, item.discipline)
        if fresh_identity.user_id != actor.user_id:
            raise HTTPException(401, "Sign-in required")
    async with request.app.state.sessions() as db:
        fresh = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        if fresh.user_id != actor.user_id:
            raise HTTPException(401, "Sign-in required")
        for item in items:
            await require_scope(
                db,
                actor.user_id,
                WorkOrderKey(item.connection_id, item.site_id, item.workorder_id),
                item.discipline,
                write=False,
            )
        # Refresh states after the I/O; never return stale cached audit payloads.
        rows = list(
            (
                await db.scalars(
                    select(UploadItem)
                    .where(
                        UploadItem.batch_id == batch_id,
                    )
                    .order_by(UploadItem.site_id, UploadItem.workorder_id)
                )
            ).all()
        )
        sources = {
            event.upload_item_id: event.details
            for event in (
                await db.scalars(
                    select(AuditEvent).where(
                        AuditEvent.upload_item_id.in_([item.id for item in rows]),
                        AuditEvent.event == "prepared",
                    )
                )
            ).all()
        }
        finalized = set(
            (
                await db.scalars(
                    select(AuditEvent.upload_item_id).where(
                        AuditEvent.upload_item_id.in_([item.id for item in rows]),
                        AuditEvent.event == "source_finalized",
                    )
                )
            ).all()
        )
        duration_results = {
            event.upload_item_id: {
                field: event.details[field] for field in ("code", "expected", "actual")
            }
            for event in (
                await db.scalars(
                    select(AuditEvent)
                    .where(
                        AuditEvent.upload_item_id.in_([item.id for item in rows]),
                        AuditEvent.actor_id == actor.user_id,
                        AuditEvent.event == "pm_duration_result",
                    )
                    .order_by(AuditEvent.created_at, AuditEvent.id)
                )
            ).all()
        }
        # A later exact reconciliation resolves a previously observed mismatch. Keep
        # its historical audit, but do not present it as a current unresolved result.
        for item in rows:
            result = duration_results.get(item.id)
            if item.state == "confirmed" and result and result["code"] == "pm_duration_mismatch":
                duration_results.pop(item.id)
        restore_sources = {}
        for item in rows:
            if item.state != "confirmed" or item.id not in sources:
                continue
            evidence = await immutable_item(db, item)
            if (
                pm_schedule_change(evidence.before, evidence.changes)
                and not set(evidence.changes) - {"schedstart", "schedfinish", "estdur"}
                and await db.scalar(
                    select(AuditEvent.actor_id).where(
                        AuditEvent.upload_item_id == item.id,
                        AuditEvent.event == "prepared",
                    )
                )
                == actor.user_id
            ):
                restore_sources[item.id] = {
                    "before": WorkOrderBaseline.model_validate(evidence.before).model_dump(
                        mode="json"
                    )
                }
        return {
            "source_finalized": bool(rows) and all(item.id in finalized for item in rows),
            "batch_id": str(batch_id),
            "counts": dict(Counter(item.state for item in rows)),
            "items": [
                {
                    "item_id": str(item.id),
                    "connection_id": str(item.connection_id),
                    "site_id": item.site_id,
                    "workorder_id": item.workorder_id,
                    "state": item.state,
                    "updated_at": item.updated_at.isoformat(),
                    "duration_result": duration_results.get(item.id),
                    "restore_source": restore_sources.get(item.id),
                    "source": {
                        field: sources[item.id][field]
                        for field in ("draft_id", "draft_version", "member_id")
                    }
                    if item.id in sources
                    else None,
                }
                for item in rows
            ],
        }


class EmptyCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")


async def execute_batch(request, actor_id, batch_id, *, reconcile=False):
    async with request.app.state.sessions() as db:
        batch = await db.scalar(
            select(UploadBatch).where(UploadBatch.id == batch_id, UploadBatch.actor_id == actor_id)
        )
        if batch is None:
            raise HTTPException(404, "Upload not found")
        items = list(
            (
                await db.scalars(
                    select(UploadItem)
                    .where(UploadItem.batch_id == batch_id)
                    .order_by(UploadItem.site_id, UploadItem.workorder_id)
                )
            ).all()
        )
    if not items:
        return
    first = items[0]
    # Every batch originates from one saved connection/discipline selection.
    if any(
        item.connection_id != first.connection_id or item.discipline != first.discipline
        for item in items
    ):
        raise HTTPException(409, "Upload source scope is inconsistent")
    await checked_settings(
        request,
        WorkOrderKey(first.connection_id, first.site_id, first.workorder_id),
        first.discipline,
        write=True,
        csrf=True,
    )
    async with request.app.state.maximo_client_factory() as client:
        transport = NativeTestTransport(
            request, actor_id, first.connection_id, first.discipline, client
        )
        await transport.authorize()
        selected = [
            item for item in items if item.state == ("unknown" if reconcile else "pending")
        ][:10]
        for item in selected:
            if reconcile:
                await reconcile_unknown(
                    request.app.state.sessions, actor_id, item.id, transport.read
                )
            else:
                await send_pending(
                    request.app.state.sessions, actor_id, item.id, transport.read, transport
                )
        if (
            all(item.state == "confirmed" for item in items if item not in selected)
            and len(selected) <= 10
        ):
            await finalize_confirmed(request.app.state.sessions, actor_id, batch_id, transport.read)


async def command_actor(request):
    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        verify_csrf(actor, request.headers.get("X-CSRF-Token"))
        return actor.user_id


@router.post("/uploads/{batch_id}/continue")
async def continue_upload(request: Request, batch_id: UUID, payload: EmptyCommand):
    actor_id = await command_actor(request)
    await execute_batch(request, actor_id, batch_id)
    return await status(request, Response(), batch_id)


@router.post("/uploads/{batch_id}/reconcile")
async def reconcile_upload(request: Request, batch_id: UUID, payload: EmptyCommand):
    actor_id = await command_actor(request)
    await execute_batch(request, actor_id, batch_id, reconcile=True)
    return await status(request, Response(), batch_id)
