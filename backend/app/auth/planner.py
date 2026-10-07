"""Audited Planner assignments. Administrative authority never supplies WO scope."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import AccessGrant, AuthorizationEvent, MaximoConnection, PlannerPermission, User

router = APIRouter(prefix="/api/admin")


class PlannerChange(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    user_id: UUID
    connection_id: UUID
    discipline: str = Field(min_length=1, max_length=50)
    enabled: bool
    reason: str = Field(min_length=1, max_length=500)


async def change_planner(db, settings, actor_id, change, *, source="admin_session"):
    # The same user lock is held by PERSON sync, so a concurrent sync cannot undo revocation.
    user = await db.scalar(select(User).where(User.id == change.user_id).with_for_update())
    connection = await db.get(MaximoConnection, change.connection_id)
    config = settings.maximo.get(change.connection_id)
    if not user or not connection or not config or not config.person_login_domain:
        raise HTTPException(404, "PERSON-managed user/connection not found")
    if change.enabled and (not user.active or not connection.enabled):
        raise HTTPException(409, "User and connection must be active")
    key = (user.id, connection.id, change.discipline)
    permission = await db.get(PlannerPermission, key)
    before = permission is not None
    if before == change.enabled:
        return False
    if change.enabled:
        db.add(
            PlannerPermission(
                user_id=user.id, connection_id=connection.id, discipline=change.discipline
            )
        )
    else:
        await db.delete(permission)
    # Never elevate cached access. The next PERSON verification supplies effective write access.
    grant = await db.scalar(
        select(AccessGrant).where(
            AccessGrant.user_id == user.id,
            AccessGrant.connection_id == connection.id,
            AccessGrant.discipline == change.discipline,
        )
    )
    if grant and not change.enabled:
        grant.capability = "read"
    db.add(
        AuthorizationEvent(
            actor_id=actor_id,
            connection_id=connection.id,
            event="planner_permission",
            details={
                "user_id": str(user.id),
                "tenant_id": str(user.tenant_id),
                "object_id": str(user.object_id),
                "discipline": change.discipline,
                "before": before,
                "after": change.enabled,
                "reason": change.reason,
                "source": source,
            },
        )
    )
    await db.flush()
    return True


@router.put("/planner-permissions")
async def set_planner(request: Request, change: PlannerChange):
    async with request.app.state.sessions.begin() as db:
        identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        verify_csrf(identity, request.headers.get("X-CSRF-Token"))
        if not identity.is_admin:
            raise HTTPException(403, "Administrative access required")
        await change_planner(db, request.app.state.settings, identity.user_id, change)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
