import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import AccessGrant, Draft, DraftItem, DraftSubmission
from app.maximo.detail import current_snapshot, read_detail, read_pics
from app.maximo.routes import authorized_connection, configured_connection
from app.scheduling.changes import ScheduleChanges, build_changes
from app.scheduling.drafts import WorkOrderKey, create_draft, load_draft, require_scope

router = APIRouter(prefix="/api")


def restored_item(item, current):
    baseline = current.baseline.model_dump(mode="json")
    try:
        build_changes(
            current.baseline,
            ScheduleChanges.model_validate(item.changes),
            set(current.allowed_pics),
        )
        valid = True
    except ValueError:
        valid = False
    return {
        "site_id": item.site_id,
        "workorder_id": item.workorder_id,
        "baseline": item.baseline,
        "changes": item.changes,
        "current": baseline,
        "baseline_changed": item.baseline != baseline,
        "changes_valid_now": valid,
        "allowed_pics": sorted(current.allowed_pics),
    }


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: UUID
    site_id: str = Field(min_length=1, max_length=50)
    workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")
    discipline: str = Field(min_length=1, max_length=50)
    changes: ScheduleChanges
    baseline_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    request_id: UUID


async def checked_settings(request, key, discipline, *, write=False, csrf=False):
    token = request.cookies.get(SESSION_COOKIE)
    await sync_person_access(request, token)
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, token)
        if csrf:
            verify_csrf(identity, request.headers.get("X-CSRF-Token"))
        connection = await authorized_connection(db, token, key.connection_id, discipline)
        await require_scope(db, identity.user_id, key, discipline, write=write)
    return identity, configured_connection(request.app.state.settings, connection)


async def retrieve_snapshot(
    request, key, discipline, *, write=False, csrf=False, require_pics=True
):
    identity, settings = await checked_settings(request, key, discipline, write=write, csrf=csrf)
    async with request.app.state.maximo_client_factory() as client:
        order = await read_detail(client, settings, key, discipline)
        if order is None:
            raise HTTPException(404, "Work order not found")
        if (
            order.status not in settings.open_statuses
            or order.istask
            or order.parent not in (None, "")
        ):
            raise HTTPException(409, "Work order is no longer eligible for scheduling")
        # Viewing WO state does not require a crew mapping; draft operations always do.
        pics = (
            await read_pics(client, settings, discipline)
            if require_pics or discipline in settings.crew_groups
            else frozenset()
        )
    await checked_settings(request, key, discipline, write=write, csrf=csrf)
    return identity, order, current_snapshot(key, order, pics)


@router.get("/work-orders/detail")
async def detail(
    request: Request,
    response: Response,
    connection_id: UUID,
    site_id: Annotated[str, Query(min_length=1, max_length=50)],
    workorder_id: Annotated[str, Query(pattern=r"^[0-9]{1,30}$")],
    discipline: Annotated[str, Query(min_length=1, max_length=50)],
):
    response.headers["Cache-Control"] = "no-store"
    allowed = {"connection_id", "site_id", "workorder_id", "discipline"}
    if any(
        key not in allowed or len(request.query_params.getlist(key)) != 1
        for key in request.query_params
    ):
        raise HTTPException(422, "Unsupported or duplicate query parameter")
    _, order, current = await retrieve_snapshot(
        request, WorkOrderKey(connection_id, site_id, workorder_id), discipline, require_pics=False
    )
    return {
        "connection_id": str(connection_id),
        "item": order.model_dump(mode="json"),
        "allowed_pics": sorted(current.allowed_pics),
        "pics_configured": discipline
        in request.app.state.settings.maximo[connection_id].crew_groups,
        "revision": None,
        "baseline_token": snapshot_token(current),
        "baseline": current.baseline.model_dump(mode="json"),
    }


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def snapshot_token(current):
    # A comparison token, not authorization or a Maximo conditional-write revision.
    return digest(
        {
            "connection": str(current.key.connection_id),
            "site": current.key.site_id,
            "id": current.key.workorder_id,
            "discipline": current.discipline,
            "baseline": current.baseline.model_dump(mode="json"),
            "revision": current.revision,
        }
    )


class DraftUpdate(DraftRequest):
    version: int = Field(gt=0, strict=True)


async def actor_after_io(request, db, identity):
    actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
    verify_csrf(actor, request.headers.get("X-CSRF-Token"))
    if actor.user_id != identity.user_id:
        raise HTTPException(401, "Sign-in required")
    return actor


async def submission(db, actor_id, payload, draft_id):
    request_hash = digest({"draft_id": str(draft_id), "payload": payload.model_dump(mode="json")})
    # The unique insert waits for a concurrent transaction. Receipt and draft commit together.
    inserted = await db.scalar(
        insert(DraftSubmission)
        .values(
            actor_id=actor_id, request_id=payload.request_id, request_hash=request_hash, result={}
        )
        .on_conflict_do_nothing()
        .returning(DraftSubmission.request_id)
    )
    receipt = await db.get(DraftSubmission, (actor_id, payload.request_id))
    if receipt.request_hash != request_hash:
        raise HTTPException(409, "Request ID already used for different changes")
    return receipt, inserted is None


async def owned_draft(db, actor_id, draft_id, *, lock=False):
    query = select(Draft).where(Draft.id == draft_id, Draft.owner_id == actor_id)
    draft = await db.scalar(query.with_for_update() if lock else query)
    if draft is None:
        raise HTTPException(404, "Draft not found")
    items = list((await db.scalars(select(DraftItem).where(DraftItem.draft_id == draft_id))).all())
    return draft, items


async def persist(request, payload, draft_id=None):
    key = WorkOrderKey(payload.connection_id, payload.site_id, payload.workorder_id)
    identity, _, current = await retrieve_snapshot(
        request, key, payload.discipline, write=True, csrf=True
    )
    async with request.app.state.sessions.begin() as db:
        actor = await actor_after_io(request, db, identity)
        await require_scope(db, actor.user_id, key, payload.discipline, write=True)
        if draft_id is not None:
            draft, items = await owned_draft(db, actor.user_id, draft_id, lock=True)
            if (
                len(items) != 1
                or draft.connection_id != key.connection_id
                or (items[0].site_id, items[0].workorder_id, items[0].discipline)
                != (key.site_id, key.workorder_id, payload.discipline)
            ):
                raise HTTPException(404, "Draft not found")
        receipt, replay = await submission(db, actor.user_id, payload, draft_id)
        if replay:
            # Deleted drafts must not be recreated by replaying a formerly successful save.
            await owned_draft(db, actor.user_id, UUID(receipt.result["draft_id"]))
            return receipt.result
        if snapshot_token(current) != payload.baseline_token:
            raise HTTPException(409, "Work order changed; reload before saving")
        try:
            if draft_id is None:
                draft = await create_draft(db, actor.user_id, current, payload.changes)
            else:
                if draft.version != payload.version:
                    raise HTTPException(409, "Draft changed; reopen before saving")
                item = items[0]
                if item.baseline != current.baseline.model_dump(mode="json"):
                    raise HTTPException(409, "Draft baseline changed; start a new draft")
                if not build_changes(current.baseline, payload.changes, set(current.allowed_pics)):
                    raise ValueError("Empty changes")
                item.changes = payload.changes.model_dump(mode="json", exclude_unset=True)
                draft.version += 1
                draft.updated_at = datetime.now(UTC)
            receipt.result = {"draft_id": str(draft.id), "version": draft.version, "state": "draft"}
            await db.flush()
        except ValueError:
            raise HTTPException(
                422, "Invalid schedule changes for the current work order"
            ) from None
        return receipt.result


@router.post("/drafts", status_code=201)
async def save(request: Request, response: Response, payload: DraftRequest):
    response.headers["Cache-Control"] = "no-store"
    return await persist(request, payload)


@router.put("/drafts/{draft_id}")
async def update(request: Request, response: Response, draft_id: UUID, payload: DraftUpdate):
    response.headers["Cache-Control"] = "no-store"
    return await persist(request, payload, draft_id)


async def restore_data(request, draft_id):
    async with request.app.state.sessions.begin() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        draft, scopes = await owned_draft(db, actor.user_id, draft_id, lock=True)
        currents = {}
        orders = {}
        for item in scopes:
            key = WorkOrderKey(draft.connection_id, item.site_id, item.workorder_id)
            _, orders[key], currents[key] = await retrieve_snapshot(request, key, item.discipline)

        async def reader(key):
            return currents[key]

        fresh_actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        if fresh_actor.user_id != actor.user_id:
            raise HTTPException(401, "Sign-in required")
        items = await load_draft(db, actor.user_id, draft_id, reader)
        return {
            "draft_id": str(draft_id),
            "version": draft.version,
            "connection_id": str(draft.connection_id),
            "state": "draft",
            "items": [
                {
                    **restored_item(item, currents[key]),
                    "discipline": item.discipline,
                    "wonum": item.wonum,
                    "item": orders[key].model_dump(mode="json"),
                    "baseline_token": snapshot_token(currents[key]),
                }
                for item in items
                for key in [WorkOrderKey(draft.connection_id, item.site_id, item.workorder_id)]
            ],
        }


@router.get("/drafts")
async def list_drafts(
    request: Request,
    response: Response,
    connection_id: UUID,
    discipline: Annotated[str, Query(min_length=1, max_length=50)],
    offset: Annotated[int, Query(ge=0)] = 0,
):
    response.headers["Cache-Control"] = "no-store"
    key = WorkOrderKey(connection_id, "", "")
    actor, _ = await checked_settings(request, key, discipline)
    async with request.app.state.sessions() as db:
        ids = list(
            (
                await db.scalars(
                    select(Draft.id)
                    .join(DraftItem)
                    .join(
                        AccessGrant,
                        (AccessGrant.user_id == Draft.owner_id)
                        & (AccessGrant.connection_id == Draft.connection_id)
                        & (AccessGrant.discipline == DraftItem.discipline),
                    )
                    .where(
                        Draft.owner_id == actor.user_id,
                        Draft.connection_id == connection_id,
                        DraftItem.discipline == discipline,
                    )
                    .distinct()
                    .order_by(Draft.id)
                    .offset(offset)
                    .limit(21)
                )
            ).all()
        )
    results = []
    for draft_id in ids[:20]:
        try:
            data = await restore_data(request, draft_id)
        except HTTPException as error:
            if error.status_code in (404, 409):
                continue
            raise
        results.append(
            {
                "draft_id": data["draft_id"],
                "version": data["version"],
                "wonum": data["items"][0]["wonum"],
                "site_id": data["items"][0]["site_id"],
            }
        )
    fresh_actor, _ = await checked_settings(request, key, discipline)
    if fresh_actor.user_id != actor.user_id:
        raise HTTPException(401, "Sign-in required")
    return {"items": results, "next_offset": offset + 20 if len(ids) > 20 else None}


@router.get("/drafts/{draft_id}")
async def restore(request: Request, response: Response, draft_id: UUID):
    response.headers["Cache-Control"] = "no-store"
    return await restore_data(request, draft_id)


@router.delete("/drafts/{draft_id}", status_code=204)
async def remove(request: Request, draft_id: UUID, version: Annotated[int, Query(gt=0)]):
    async with request.app.state.sessions.begin() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        verify_csrf(actor, request.headers.get("X-CSRF-Token"))
        draft, items = await owned_draft(db, actor.user_id, draft_id, lock=True)
        for item in items:
            key = WorkOrderKey(draft.connection_id, item.site_id, item.workorder_id)
            identity, _, _ = await retrieve_snapshot(request, key, item.discipline, write=True)
            await actor_after_io(request, db, identity)
            await require_scope(db, actor.user_id, key, item.discipline, write=True)
        if draft.version != version:
            raise HTTPException(409, "Draft changed; reopen before deleting")
        await db.delete(draft)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
