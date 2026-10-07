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
    if not settings.entra or user.tenant_id != settings.entra.tenant_id:
        raise HTTPException(404, "PERSON-managed user/connection not found")
    if change.enabled and change.discipline not in config.crew_groups:
        raise HTTPException(422, "Discipline must have a configured crew mapping")
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
        await require_admin(db, request.app.state.settings, identity)
        await change_planner(db, request.app.state.settings, identity.user_id, change)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


async def require_admin(db, settings, identity):
    user = await db.scalar(select(User).where(User.id == identity.user_id).with_for_update())
    if (
        not settings.entra
        or not user
        or not user.active
        or not user.is_admin
        or user.tenant_id != settings.entra.tenant_id
    ):
        raise HTTPException(403, "Administrative access required")
    return user


@router.get("/roster")
async def roster(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    settings = request.app.state.settings
    async with request.app.state.sessions.begin() as db:
        identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        await require_admin(db, settings, identity)
        users = list(
            await db.scalars(
                select(User)
                .where(User.tenant_id == settings.entra.tenant_id)
                .order_by(User.display_name, User.id)
            )
        )
        configured = [key for key, config in settings.maximo.items() if config.person_login_domain]
        connections = list(
            await db.scalars(
                select(MaximoConnection)
                .where(MaximoConnection.id.in_(configured))
                .order_by(MaximoConnection.label, MaximoConnection.id)
            )
        )
        user_ids = [user.id for user in users]
        connection_ids = [connection.id for connection in connections]
        permissions = list(
            await db.scalars(
                select(PlannerPermission)
                .where(
                    PlannerPermission.user_id.in_(user_ids),
                    PlannerPermission.connection_id.in_(connection_ids),
                )
                .order_by(
                    PlannerPermission.user_id,
                    PlannerPermission.connection_id,
                    PlannerPermission.discipline,
                )
            )
        )
        grants = list(
            await db.scalars(
                select(AccessGrant)
                .where(
                    AccessGrant.user_id.in_(user_ids),
                    AccessGrant.connection_id.in_(connection_ids),
                )
                .order_by(AccessGrant.user_id, AccessGrant.connection_id, AccessGrant.discipline)
            )
        )

        def scope(row):
            return {
                "user_id": str(row.user_id),
                "connection_id": str(row.connection_id),
                "discipline": row.discipline,
            }

        return {
            "users": [
                {
                    "id": str(user.id),
                    "tenant_id": str(user.tenant_id),
                    "object_id": str(user.object_id),
                    "display_name": user.display_name,
                    "active": user.active,
                    "is_admin": user.is_admin,
                }
                for user in users
            ],
            "connections": [
                {
                    "id": str(connection.id),
                    "label": connection.label,
                    "system": connection.system,
                    "environment": connection.environment,
                    "enabled": connection.enabled,
                    "disciplines": sorted(settings.maximo[connection.id].crew_groups),
                }
                for connection in connections
            ],
            "permissions": [scope(permission) for permission in permissions],
            "grants": [{**scope(grant), "capability": grant.capability} for grant in grants],
        }
