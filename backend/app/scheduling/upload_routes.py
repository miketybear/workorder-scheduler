"""Upload API reads/previews only; submit remains closed pending a validated write contract."""

from collections import Counter
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import AuditEvent, UploadBatch, UploadItem
from app.maximo.detail import read_detail
from app.scheduling.batches import BatchKey, BatchPrepare, snapshots
from app.scheduling.drafts import WorkOrderKey, require_scope
from app.scheduling.routes import actor_after_io, checked_settings, owned_draft
from app.scheduling.upload_service import prepare_upload


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


async def preview_data(request, draft_id, payload):
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
            db, actor.user_id, draft_id, payload.version, payload.items, reader
        )
    return {
        "draft_id": str(draft_id),
        "version": prepared.version,
        "preview_hash": prepared.preview_hash,
        "send_enabled": False,
        "gate": "write_contract_unverified",
        "items": [
            {
                "site_id": item.key.site_id,
                "workorder_id": item.key.workorder_id,
                "code": item.code,
                "before": {field: item.before[field] for field in item.changes},
                "changes": item.changes,
            }
            for item in prepared.items
        ],
    }


@router.post("/drafts/{draft_id}/upload-preview")
async def preview(request: Request, response: Response, draft_id: UUID, payload: UploadSelection):
    response.headers["Cache-Control"] = "no-store"
    return await preview_data(request, draft_id, payload)


@router.post("/drafts/{draft_id}/uploads")
async def submit(request: Request, draft_id: UUID, payload: UploadSubmit):
    data = await preview_data(request, draft_id, payload)
    if data["preview_hash"] != payload.preview_hash:
        raise HTTPException(
            409, "Preview changed; preview again", headers={"Cache-Control": "no-store"}
        )
    # Deliberately no feature flag or writer dependency: GET ETag evidence is insufficient.
    raise HTTPException(
        409,
        {"code": "write_contract_unverified", "send_enabled": False},
        headers={"Cache-Control": "no-store"},
    )


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
        return {
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
