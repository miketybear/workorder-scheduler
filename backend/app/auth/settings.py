"""Account preferences select approved connections; they do not grant WO access."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, resolve_session, session_payload, verify_csrf
from app.db.models import MaximoConnection, UserConnectionSetting
from app.maximo.connections import configured_connection

router = APIRouter(prefix="/api/settings")


class ConnectionChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: UUID


@router.get("/connection")
async def connection_settings(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Sign-in required")
    await sync_person_access(request, token)
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, token)
        payload = await session_payload(db, identity)
        ids = {UUID(grant["connection_id"]) for grant in payload["grants"]}
        connections = (
            await db.scalars(
                select(MaximoConnection).where(
                    MaximoConnection.id.in_(ids), MaximoConnection.enabled.is_(True)
                )
            )
        ).all()
        for connection in connections:
            configured_connection(request.app.state.settings, connection)
        return {
            **payload,
            "connections": [
                {"connection_id": str(connection.id), "url": connection.base_url}
                for connection in connections
            ],
        }


@router.put("/connection")
async def save_connection(request: Request, choice: ConnectionChoice):
    token = request.cookies.get(SESSION_COOKIE)
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, token)
        verify_csrf(identity, request.headers.get("X-CSRF-Token"))
    await sync_person_access(request, token)
    async with request.app.state.sessions.begin() as db:
        identity = await resolve_session(db, token)
        payload = await session_payload(db, identity)
        matches = [
            grant
            for grant in payload["grants"]
            if grant["connection_id"] == str(choice.connection_id)
        ]
        if not matches:
            raise HTTPException(404, "Connection not available for this account")
        if len(matches) != 1:
            raise HTTPException(409, "Account must have one discipline for this connection")
        connection = await db.get(MaximoConnection, choice.connection_id)
        if connection is None or not connection.enabled:
            raise HTTPException(404, "Connection not available for this account")
        configured_connection(request.app.state.settings, connection)
        await db.execute(
            insert(UserConnectionSetting)
            .values(user_id=identity.user_id, connection_id=choice.connection_id)
            .on_conflict_do_update(
                index_elements=[UserConnectionSetting.user_id],
                set_={"connection_id": choice.connection_id},
            )
        )
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
