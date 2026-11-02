"""Counts for the Home page: the same scoped read as the WO list, plus the actor's own open work."""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import AwareDatetime
from sqlalchemy import distinct, func, select

from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.db.models import Draft, DraftItem, UploadBatch, UploadItem, WorkflowRouteAttempt
from app.maximo.connections import configured_connection
from app.maximo.reader import MaximoReadError, WorkOrder, read_open_orders
from app.maximo.routes import authorized_connection
from app.request_deadline import ReadDraftDeadlineRoute

router = APIRouter(prefix="/api", route_class=ReadDraftDeadlineRoute)


def count_orders(orders: Iterable[WorkOrder], now: datetime) -> dict[str, int]:
    counts = {"total": 0, "missing_schedule": 0, "missing_pic": 0, "overdue": 0}
    for order in orders:
        counts["total"] += 1
        counts["missing_schedule"] += not (order.schedstart and order.schedfinish)
        counts["missing_pic"] += not order.assignedto
        counts["overdue"] += order.targcompdate < now and order.actfinish is None
    return counts


async def count_own_work(db, user_id: UUID, connection_id: UUID, discipline: str) -> dict[str, int]:
    drafts = await db.scalar(
        select(func.count(distinct(Draft.id)))
        .join(DraftItem, DraftItem.draft_id == Draft.id)
        .where(
            Draft.owner_id == user_id,
            Draft.connection_id == connection_id,
            DraftItem.discipline == discipline,
        )
    )
    uploads = await db.scalar(
        select(func.count())
        .select_from(UploadItem)
        .join(UploadBatch, UploadBatch.id == UploadItem.batch_id)
        .where(
            UploadBatch.actor_id == user_id,
            UploadItem.connection_id == connection_id,
            UploadItem.discipline == discipline,
            UploadItem.state.in_(["pending", "sending", "unknown"]),
        )
    )
    routes = await db.scalar(
        select(func.count())
        .select_from(WorkflowRouteAttempt)
        .where(
            WorkflowRouteAttempt.actor_user_id == user_id,
            WorkflowRouteAttempt.connection_id == connection_id,
            WorkflowRouteAttempt.discipline == discipline,
            WorkflowRouteAttempt.state.in_(["pending", "sending", "unknown"]),
        )
    )
    return {
        "drafts": drafts or 0,
        "unresolved_uploads": uploads or 0,
        "unresolved_routes": routes or 0,
    }


@router.get("/home/summary")
async def home_summary(
    request: Request,
    response: Response,
    connection_id: UUID,
    discipline: Annotated[str, Query(min_length=1, max_length=50)],
    target_from: AwareDatetime,
    target_before: AwareDatetime,
):
    response.headers["Cache-Control"] = "no-store"
    allowed = {"connection_id", "discipline", "target_from", "target_before"}
    if any(
        key not in allowed or len(request.query_params.getlist(key)) != 1
        for key in request.query_params
    ):
        raise HTTPException(422, "Unsupported or duplicate query parameter")
    if target_before <= target_from or target_before - target_from > timedelta(days=366):
        raise HTTPException(422, "Choose a date range up to 366 days; end is exclusive")
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Sign-in required")
    await sync_person_access(request, token)
    async with request.app.state.sessions() as db:
        connection = await authorized_connection(db, token, connection_id, discipline)
    settings = configured_connection(request.app.state.settings, connection)
    try:
        async with request.app.state.maximo_client_factory() as client:
            orders = await read_open_orders(
                client, settings, discipline, target_from, target_before
            )
    except MaximoReadError as error:
        raise HTTPException(502, str(error), headers={"Cache-Control": "no-store"}) from None
    # A retrieval may span many pages. Recheck revocation in a fresh DB session before release.
    await sync_person_access(request, token)
    async with request.app.state.sessions() as db:
        await authorized_connection(db, token, connection_id, discipline)
        actor = await resolve_session(db, token)
        own = await count_own_work(db, actor.user_id, connection_id, discipline)
    now = datetime.now(UTC)
    return {**count_orders(orders, now), **own, "as_of": now.isoformat()}
