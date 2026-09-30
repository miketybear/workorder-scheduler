from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import Draft, DraftItem
from app.maximo.detail import current_snapshot, read_detail, read_pics
from app.maximo.routes import authorized_connection
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


async def checked_settings(request, key, discipline, *, write=False, csrf=False):
    token = request.cookies.get(SESSION_COOKIE)
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, token)
        if csrf:
            verify_csrf(identity, request.headers.get("X-CSRF-Token"))
        connection = await authorized_connection(db, token, key.connection_id, discipline)
        await require_scope(db, identity.user_id, key, discipline, write=write)
    settings = request.app.state.settings.maximo.get(key.connection_id)
    if (
        settings is None
        or settings.collection_url != connection.base_url.rstrip("/") + "/oslc/os/oslcmxwodetail"
    ):
        raise HTTPException(503, "Maximo connection is not configured")
    return identity, settings


async def retrieve_snapshot(request, key, discipline, *, write=False, csrf=False):
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
        pics = await read_pics(client, settings, discipline)
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
        request, WorkOrderKey(connection_id, site_id, workorder_id), discipline
    )
    return {
        "connection_id": str(connection_id),
        "item": order.model_dump(mode="json"),
        "allowed_pics": sorted(current.allowed_pics),
        "revision": None,
    }


@router.post("/drafts", status_code=201)
async def save(request: Request, response: Response, payload: DraftRequest):
    response.headers["Cache-Control"] = "no-store"
    key = WorkOrderKey(payload.connection_id, payload.site_id, payload.workorder_id)
    identity, _, current = await retrieve_snapshot(
        request, key, payload.discipline, write=True, csrf=True
    )
    async with request.app.state.sessions.begin() as db:
        # Recheck session after network I/O before persisting under its actor.
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        if actor.user_id != identity.user_id:
            raise HTTPException(401, "Sign-in required")
        try:
            draft = await create_draft(db, actor.user_id, current, payload.changes)
        except ValueError:
            raise HTTPException(
                422, "Invalid schedule changes for the current work order"
            ) from None
    return {"draft_id": str(draft.id), "version": draft.version, "state": "draft"}


@router.get("/drafts/{draft_id}")
async def restore(request: Request, response: Response, draft_id: UUID):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        draft = await db.scalar(
            select(Draft).where(Draft.id == draft_id, Draft.owner_id == actor.user_id)
        )
        if draft is None:
            raise HTTPException(404, "Draft not found")
        scopes = list(
            (await db.scalars(select(DraftItem).where(DraftItem.draft_id == draft_id))).all()
        )
    currents = {}
    # Check stored scope before fetching, then load_draft verifies each fresh scope again.
    for item in scopes:
        key = WorkOrderKey(draft.connection_id, item.site_id, item.workorder_id)
        _, _, currents[key] = await retrieve_snapshot(request, key, item.discipline)

    async def reader(key):
        return currents[key]

    async with request.app.state.sessions() as db:
        fresh_actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        if fresh_actor.user_id != actor.user_id:
            raise HTTPException(401, "Sign-in required")
        items = await load_draft(db, actor.user_id, draft_id, reader)
        return {
            "draft_id": str(draft_id),
            "connection_id": str(draft.connection_id),
            "state": "draft",
            "items": [
                restored_item(
                    item,
                    currents[WorkOrderKey(draft.connection_id, item.site_id, item.workorder_id)],
                )
                for item in items
            ],
        }
