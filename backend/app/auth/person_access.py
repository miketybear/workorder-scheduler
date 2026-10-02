from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.sessions import resolve_session
from app.db.models import (
    AccessGrant,
    AuthorizationEvent,
    MaximoConnection,
    MaximoPersonBinding,
    User,
)
from app.maximo.connections import configured_connection
from app.maximo.person import person_id_from_login, read_person_discipline
from app.maximo.reader import MaximoReadError


async def verified_person_scope(request, db, user, connection, token):
    settings = request.app.state.settings
    config = settings.maximo[connection.id]
    person_id = None
    if settings.entra and user.tenant_id == settings.entra.tenant_id:
        person_id = person_id_from_login(user.login_name, config.person_login_domain)
    binding = await db.get(MaximoPersonBinding, (user.id, connection.id))
    # A renamed/reused login cannot silently move an existing identity binding.
    if not person_id or (binding and binding.person_id != person_id):
        return None, "no_verified_person_locator", False
    owner = await db.scalar(
        select(MaximoPersonBinding).where(
            MaximoPersonBinding.connection_id == connection.id,
            MaximoPersonBinding.person_id == person_id,
        )
    )
    if owner and owner.user_id != user.id:
        return None, "person_already_bound", False
    before_metadata = (connection.base_url, connection.environment)
    try:
        config = configured_connection(settings, connection)
        async with request.app.state.maximo_client_factory() as client:
            discipline = await read_person_discipline(client, config, person_id)
        await db.refresh(connection)
        configured_connection(settings, connection)
        if not connection.enabled or before_metadata != (
            connection.base_url,
            connection.environment,
        ):
            raise MaximoReadError("PERSON connection changed during lookup")
        await resolve_session(db, token)
    except (MaximoReadError, HTTPException):
        return None, "person_lookup_unavailable", True
    if binding is None:
        db.add(
            MaximoPersonBinding(
                user_id=user.id,
                connection_id=connection.id,
                person_id=person_id,
            )
        )
        db.add(
            AuthorizationEvent(
                actor_id=user.id,
                connection_id=connection.id,
                event="person_binding",
                details={"person_id": person_id},
            )
        )
    reason = "person_discipline" if discipline else "person_without_discipline"
    return discipline, reason, False


async def replace_person_grants(db, user_id, connection_id, discipline, reason):
    rows = list(
        await db.scalars(
            select(AccessGrant)
            .where(
                AccessGrant.user_id == user_id,
                AccessGrant.connection_id == connection_id,
            )
            .with_for_update()
        )
    )
    before = sorted((row.discipline, row.capability) for row in rows)
    after = [(discipline, "read")] if discipline else []
    if before == after:
        return
    for row in rows:
        await db.delete(row)
    # Flush deletes before inserting a changed grant with the same unique scope.
    await db.flush()
    if discipline:
        db.add(
            AccessGrant(
                user_id=user_id,
                connection_id=connection_id,
                discipline=discipline,
                capability="read",
            )
        )
    db.add(
        AuthorizationEvent(
            actor_id=user_id,
            connection_id=connection_id,
            event="person_grants",
            details={"before": before, "after": after, "reason": reason},
        )
    )


async def sync_person_access(request: Request, token: str | None) -> None:
    """PERSON-managed connections grant read only; lookup failures revoke persisted grants."""
    settings = request.app.state.settings
    managed_ids = [key for key, value in settings.maximo.items() if value.person_login_domain]
    if not managed_ids:
        return
    failed = False
    try:
        async with request.app.state.sessions.begin() as db:
            identity = await resolve_session(db, token)
            user = await db.scalar(
                select(User).where(User.id == identity.user_id).with_for_update()
            )
            connections = list(
                await db.scalars(
                    select(MaximoConnection)
                    .where(
                        MaximoConnection.id.in_(managed_ids),
                        MaximoConnection.enabled.is_(True),
                    )
                    .order_by(MaximoConnection.id)
                )
            )
            for connection in connections:
                discipline, reason, unavailable = await verified_person_scope(
                    request,
                    db,
                    user,
                    connection,
                    token,
                )
                failed |= unavailable
                await replace_person_grants(db, user.id, connection.id, discipline, reason)
            await db.flush()
    except IntegrityError:
        # Unique PERSON ownership is the final guard for simultaneous first logins.
        raise HTTPException(503, "PERSON identity binding conflict") from None
    if failed:
        raise HTTPException(
            503, "PERSON access could not be verified", headers={"Cache-Control": "no-store"}
        )
