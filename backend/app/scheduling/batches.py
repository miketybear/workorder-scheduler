"""Bounded, atomic multi-WO drafts; all upstream operations remain read-only."""

import asyncio
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.db.models import Draft, DraftItem
from app.maximo.detail import current_snapshot, read_detail, read_pics
from app.maximo.reader import MaximoReadError
from app.scheduling.changes import ScheduleChanges, build_changes
from app.scheduling.drafts import WorkOrderKey, require_scope
from app.scheduling.routes import (
    actor_after_io,
    checked_settings,
    owned_draft,
    restore_data,
    snapshot_token,
    submission,
)

router = APIRouter(prefix="/api/draft-batches")


class BatchKey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_id: str = Field(min_length=1, max_length=50)
    workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")


class BatchScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: UUID
    discipline: str = Field(min_length=1, max_length=50)


class BatchPrepare(BatchScope):
    items: list[BatchKey] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def unique_items(self):
        keys = [(item.site_id, item.workorder_id) for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate work order identity")
        return self


class BatchEdit(BatchKey):
    baseline_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    changes: ScheduleChanges


class BatchSave(BatchPrepare):
    items: list[BatchEdit] = Field(min_length=1, max_length=200)
    request_id: UUID


class BatchUpdate(BatchSave):
    version: int = Field(gt=0, strict=True)


async def snapshots(request, payload, *, write=True, csrf=True):
    key = WorkOrderKey(payload.connection_id, "", "")
    identity, config = await checked_settings(
        request, key, payload.discipline, write=write, csrf=csrf
    )
    semaphore = asyncio.Semaphore(4)
    async with request.app.state.maximo_client_factory() as client:
        pics = await read_pics(client, config, payload.discipline)

        async def read(item):
            key = WorkOrderKey(payload.connection_id, item.site_id, item.workorder_id)
            async with semaphore:
                try:
                    order = await read_detail(client, config, key, payload.discipline)
                    if order is None:
                        raise HTTPException(404, "Work order not found")
                    if order.status not in config.open_statuses or order.istask or order.parent:
                        raise HTTPException(409, "Work order no longer eligible")
                    return order, current_snapshot(key, order, pics)
                except (MaximoReadError, HTTPException):
                    # Never echo upstream values or disclose a guessed record outside scope.
                    return {
                        "site_id": item.site_id,
                        "workorder_id": item.workorder_id,
                        "code": "unavailable",
                    }

        # Bound the entire batch as well as each HTTP call; cancel children on timeout.
        try:
            async with asyncio.timeout(config.retrieval_timeout_seconds):
                results = await asyncio.gather(*(read(item) for item in payload.items))
        except TimeoutError:
            raise HTTPException(503, "Batch verification timed out") from None
    fresh_identity, _ = await checked_settings(
        request, key, payload.discipline, write=write, csrf=csrf
    )
    if fresh_identity.user_id != identity.user_id:
        raise HTTPException(401, "Sign-in required")
    errors = [result for result in results if isinstance(result, dict)]
    if errors:
        raise HTTPException(409, {"errors": errors})
    return identity, results


@router.post("/prepare")
async def prepare(request: Request, response: Response, payload: BatchPrepare):
    response.headers["Cache-Control"] = "no-store"
    _, results = await snapshots(request, payload)
    return {
        "connection_id": str(payload.connection_id),
        "discipline": payload.discipline,
        "items": [
            {
                "item": order.model_dump(mode="json"),
                "baseline": current.baseline.model_dump(mode="json"),
                "baseline_token": snapshot_token(current),
                "allowed_pics": sorted(current.allowed_pics),
            }
            for order, current in results
        ],
    }


async def persist_batch(request, payload, draft_id=None):
    identity, results = await snapshots(request, payload)
    errors = []
    for edit, (_, current) in zip(payload.items, results, strict=True):
        code = None
        if snapshot_token(current) != edit.baseline_token:
            code = "baseline_changed"
        else:
            try:
                if not build_changes(current.baseline, edit.changes, set(current.allowed_pics)):
                    code = "empty_changes"
            except ValueError:
                code = "invalid_changes"
        if code:
            errors.append(
                {"site_id": edit.site_id, "workorder_id": edit.workorder_id, "code": code}
            )
    if errors:
        raise HTTPException(409, {"errors": errors})
    async with request.app.state.sessions.begin() as db:
        actor = await actor_after_io(request, db, identity)
        for _, current in results:
            await require_scope(db, actor.user_id, current.key, payload.discipline, write=True)
        if draft_id is not None:
            draft, existing = await owned_draft(db, actor.user_id, draft_id, lock=True)
            old = {(item.site_id, item.workorder_id): item for item in existing}
            keys = {(item.site_id, item.workorder_id) for item in payload.items}
            if (
                draft.connection_id != payload.connection_id
                or keys != old.keys()
                or any(item.discipline != payload.discipline for item in existing)
            ):
                raise HTTPException(404, "Draft not found")
        receipt, replay = await submission(db, actor.user_id, payload, draft_id)
        if replay:
            await owned_draft(db, actor.user_id, UUID(receipt.result["draft_id"]))
            return receipt.result
        if draft_id is None:
            draft = Draft(owner_id=actor.user_id, connection_id=payload.connection_id)
            db.add(draft)
            await db.flush()
        elif draft.version != payload.version:
            raise HTTPException(409, "Draft changed; reopen before saving")
        for edit, (_, current) in zip(payload.items, results, strict=True):
            values = current.baseline.model_dump(mode="json")
            if draft_id is None:
                item = DraftItem(
                    draft_id=draft.id,
                    site_id=edit.site_id,
                    workorder_id=edit.workorder_id,
                    wonum=current.wonum,
                    discipline=payload.discipline,
                    baseline=values,
                    upstream_revision=current.revision,
                )
                db.add(item)
            else:
                item = old[(edit.site_id, edit.workorder_id)]
                if item.baseline != values:
                    raise HTTPException(409, "Draft baseline changed; create a new draft")
            item.changes = edit.changes.model_dump(mode="json", exclude_unset=True)
        if draft_id is not None:
            draft.version += 1
            draft.updated_at = datetime.now(UTC)
        receipt.result = {
            "draft_id": str(draft.id),
            "version": draft.version,
            "state": "draft",
            "updated_at": draft.updated_at.isoformat(),
        }
        await db.flush()
        return receipt.result


@router.post("", status_code=201)
async def save(request: Request, response: Response, payload: BatchSave):
    response.headers["Cache-Control"] = "no-store"
    return await persist_batch(request, payload)


@router.put("/{draft_id}")
async def update(request: Request, response: Response, draft_id: UUID, payload: BatchUpdate):
    response.headers["Cache-Control"] = "no-store"
    return await persist_batch(request, payload, draft_id)


@router.get("/{draft_id}")
async def restore(request: Request, response: Response, draft_id: UUID):
    response.headers["Cache-Control"] = "no-store"
    return await restore_data(request, draft_id)
