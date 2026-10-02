import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AccessGrant, LoginSession, MaximoConnection, User

SESSION_COOKIE = "__Host-wos-session"
CSRF_COOKIE = "__Host-wos-csrf"
SESSION_LIFETIME = timedelta(hours=8)


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class SessionIdentity:
    user_id: uuid.UUID
    display_name: str
    is_admin: bool
    token_hash: str
    csrf_hash: str


async def issue_session(db: AsyncSession, verified_user: User) -> tuple[str, str]:
    """Called only after verified Entra login; caller commits before setting cookies."""
    if not verified_user.active:
        raise HTTPException(403, "Account disabled")
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    db.add(
        LoginSession(
            token_hash=token_hash(token),
            csrf_hash=token_hash(csrf),
            user_id=verified_user.id,
            created_at=now,
            expires_at=now + SESSION_LIFETIME,
        )
    )
    await db.flush()
    return token, csrf


def set_session_cookies(response: Response, token: str, csrf: str) -> None:
    for name, value, http_only in ((SESSION_COOKIE, token, True), (CSRF_COOKIE, csrf, False)):
        response.set_cookie(
            name,
            value,
            max_age=int(SESSION_LIFETIME.total_seconds()),
            secure=True,
            httponly=http_only,
            samesite="lax",
            path="/",
        )


async def resolve_session(db: AsyncSession, token: str | None) -> SessionIdentity:
    if not token or len(token) != 43:
        raise HTTPException(401, "Sign-in required")
    result = (
        await db.execute(
            select(LoginSession, User)
            .join(User, LoginSession.user_id == User.id)
            .where(
                LoginSession.token_hash == token_hash(token),
                LoginSession.expires_at > datetime.now(UTC),
                User.active.is_(True),
            )
        )
    ).one_or_none()
    if result is None:
        raise HTTPException(401, "Sign-in required")
    session, user = result
    return SessionIdentity(
        user.id, user.display_name, user.is_admin, session.token_hash, session.csrf_hash
    )


def verify_csrf(identity: SessionIdentity, supplied: str | None) -> None:
    if (
        not supplied
        or len(supplied) != 43
        or not hmac.compare_digest(token_hash(supplied), identity.csrf_hash)
    ):
        raise HTTPException(403, "Invalid CSRF token")


async def current_grants(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    rows = (
        await db.execute(
            select(AccessGrant, MaximoConnection)
            .join(MaximoConnection)
            .where(AccessGrant.user_id == user_id, MaximoConnection.enabled.is_(True))
            .order_by(MaximoConnection.label, AccessGrant.discipline)
        )
    ).all()
    return [
        {
            "connection_id": str(connection.id),
            "label": connection.label,
            "system": connection.system,
            "environment": connection.environment,
            "timezone": connection.timezone,
            "discipline": grant.discipline,
            "capability": grant.capability,
        }
        for grant, connection in rows
    ]


async def session_info(request: Request, response: Response):
    from app.auth.person_access import sync_person_access

    response.headers["Cache-Control"] = "no-store"
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Sign-in required")
    await sync_person_access(request, token)
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, token)
        grants = await current_grants(db, identity.user_id)
    return {
        "user": {
            "id": str(identity.user_id),
            "name": identity.display_name,
            "is_admin": identity.is_admin,
        },
        "grants": grants,
    }


async def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Sign-in required")
    async with request.app.state.sessions.begin() as db:
        identity = await resolve_session(db, token)
        verify_csrf(identity, request.headers.get("X-CSRF-Token"))
        await db.execute(delete(LoginSession).where(LoginSession.token_hash == identity.token_hash))
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(
            name, path="/", secure=True, httponly=name == SESSION_COOKIE, samesite="lax"
        )
    return response
