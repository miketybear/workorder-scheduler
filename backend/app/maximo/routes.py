from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import AwareDatetime
from sqlalchemy import select

from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.db.models import AccessGrant, MaximoConnection
from app.maximo.connections import configured_connection
from app.maximo.reader import MaximoReadError, read_open_orders

router = APIRouter(prefix="/api")


async def authorized_connection(db, token, connection_id, discipline):
    identity = await resolve_session(db, token)
    connection = await db.scalar(
        select(MaximoConnection)
        .join(AccessGrant)
        .where(
            MaximoConnection.id == connection_id,
            MaximoConnection.enabled.is_(True),
            AccessGrant.user_id == identity.user_id,
            AccessGrant.discipline == discipline,
            AccessGrant.capability.in_(["read", "write"]),
        )
    )
    if connection is None:
        raise HTTPException(404, "Connection or discipline not found")
    return connection


@router.get("/work-orders")
async def list_work_orders(
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
        connection = await authorized_connection(db, token, connection_id, discipline)
        configured_connection(request.app.state.settings, connection)
    return {
        "connection_id": str(connection_id),
        "discipline": discipline,
        "count": len(orders),
        "items": [order.model_dump(mode="json") for order in orders],
    }
