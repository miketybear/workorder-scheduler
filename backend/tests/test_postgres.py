import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.audit.uploads import recover_stale_sends, transition_upload
from app.auth.sessions import (
    SESSION_COOKIE,
    current_grants,
    issue_session,
    resolve_session,
    token_hash,
)
from app.config import integration_settings
from app.db.models import (
    AccessGrant,
    AuditEvent,
    LoginSession,
    MaximoConnection,
    UploadBatch,
    UploadItem,
    User,
)
from app.main import create_app
from app.scheduling.changes import ScheduleChanges, WorkOrderBaseline
from app.scheduling.drafts import CurrentWorkOrder, WorkOrderKey, create_draft, load_draft

pytestmark = pytest.mark.integration


def test_session_api_logout_requires_csrf_and_revokes_session():
    async def scenario():
        async with database() as sessions:
            user, _, _ = await seed(sessions)
            async with sessions.begin() as db:
                token, csrf = await issue_session(db, user)
            app = create_app(integration_settings())
            app.state.sessions = sessions
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                assert (await client.get("/api/auth/session")).status_code == 401
                client.cookies.set(SESSION_COOKIE, token)
                response = await client.get("/api/auth/session")
                assert response.status_code == 200
                assert response.headers["Cache-Control"] == "no-store"
                assert response.json()["user"]["id"] == str(user.id)
                grant = response.json()["grants"][0]
                assert grant["discipline"] == "MECH"
                assert grant["timezone"] == "Asia/Ho_Chi_Minh"
                assert "base_url" not in grant and "secret_reference" not in grant
                assert (await client.post("/api/auth/logout")).status_code == 403
                assert (await client.get("/api/auth/session")).status_code == 200
                response = await client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
                assert response.status_code == 204
                client.cookies.set(SESSION_COOKIE, token)
                assert (await client.get("/api/auth/session")).status_code == 401

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@asynccontextmanager
async def database():
    settings = integration_settings()
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        connect_args={"connect_timeout": 3},
        hide_parameters=True,
    )
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            sessions = async_sessionmaker(
                connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
            )
            try:
                yield sessions
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


async def seed(sessions):
    async with sessions.begin() as db:
        user = User(tenant_id=uuid4(), object_id=uuid4(), display_name="Test planner")
        admin = User(tenant_id=uuid4(), object_id=uuid4(), display_name="Admin", is_admin=True)
        connections = [
            MaximoConnection(
                system=system,
                environment="test",
                label=system,
                base_url="https://invalid.example",
                timezone="Asia/Ho_Chi_Minh",
                secret_reference="test-only",
                enabled=True,
            )
            for system in ("onshore", "offshore")
        ]
        db.add_all([user, admin, *connections])
        await db.flush()
        db.add(
            AccessGrant(
                user_id=user.id,
                connection_id=connections[0].id,
                discipline="MECH",
                capability="write",
            )
        )
    return user, admin, connections


def snapshot(connection):
    return CurrentWorkOrder(
        WorkOrderKey(connection.id, "TEST", "100"),
        "WO100",
        "MECH",
        "v1",
        WorkOrderBaseline(worktype="CM", estdur=8),
        frozenset({"PIC"}),
    )


def test_sessions_recheck_expiry_user_and_grants():
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            async with sessions.begin() as db:
                token, csrf = await issue_session(db, user)
            async with sessions.begin() as db:
                stored = await db.get(LoginSession, token_hash(token))
                assert stored.token_hash != token and stored.csrf_hash != csrf
                assert (await resolve_session(db, token)).user_id == user.id
                assert len(await current_grants(db, user.id)) == 1
                assert await current_grants(db, admin.id) == []
                await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
            async with sessions.begin() as db:
                assert await current_grants(db, user.id) == []
                stored = await db.get(LoginSession, token_hash(token))
                stored.created_at = datetime.now(UTC) - timedelta(days=2)
                stored.expires_at = datetime.now(UTC) - timedelta(days=1)
            async with sessions() as db:
                with pytest.raises(HTTPException) as error:
                    await resolve_session(db, token)
                assert error.value.status_code == 401
            async with sessions.begin() as db:
                token, _ = await issue_session(db, user)
                active_user = await db.get(User, user.id)
                active_user.active = False
            async with sessions() as db:
                with pytest.raises(HTTPException):
                    await resolve_session(db, token)

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_drafts_isolate_owner_scope_and_live_discipline():
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            current = snapshot(connections[0])
            async with sessions.begin() as db:
                draft = await create_draft(db, user.id, current, ScheduleChanges(estdur=9))

            async def reader(key):
                assert key == current.key
                return current

            async def moved(key):
                return replace(current, discipline="ELEC")

            async def unavailable(key):
                raise ConnectionError("Upstream unavailable")

            async with sessions() as db:
                items = await load_draft(db, user.id, draft.id, reader)
                assert ScheduleChanges.model_validate(items[0].changes).estdur == 9
                with pytest.raises(HTTPException):
                    await load_draft(db, admin.id, draft.id, reader)
                with pytest.raises(HTTPException):
                    await load_draft(db, user.id, draft.id, moved)
                with pytest.raises(ConnectionError):
                    await load_draft(db, user.id, draft.id, unavailable)
                with pytest.raises(HTTPException):
                    await create_draft(
                        db, user.id, snapshot(connections[1]), ScheduleChanges(estdur=9)
                    )
            async with sessions.begin() as db:
                await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
            async with sessions() as db:
                # A revoked grant is denied before the upstream reader is invoked.
                with pytest.raises(HTTPException):
                    await load_draft(db, user.id, draft.id, unavailable)
                with pytest.raises(HTTPException):
                    await create_draft(db, admin.id, current, ScheduleChanges(estdur=9))

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


async def new_upload(db, user, connection, site="TEST", key=None):
    batch = UploadBatch(actor_id=user.id, idempotency_key=key or uuid4(), request_hash="a" * 64)
    db.add(batch)
    await db.flush()
    item = UploadItem(
        batch_id=batch.id,
        connection_id=connection.id,
        site_id=site,
        workorder_id="100",
        wonum="WO100",
        discipline="MECH",
        before={"estdur": 8},
        changes={"estdur": 9},
    )
    db.add(item)
    await db.flush()
    return item


def test_upload_uniqueness_includes_connection_and_site():
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            key = uuid4()
            async with sessions.begin() as db:
                await new_upload(db, user, connections[0], key=key)
                await new_upload(db, user, connections[1])
                await new_upload(db, user, connections[0], site="OTHER")
            with pytest.raises(IntegrityError):
                async with sessions.begin() as db:
                    await new_upload(db, user, connections[0])
            with pytest.raises(IntegrityError):
                async with sessions.begin() as db:
                    await new_upload(db, user, connections[0], site="THIRD", key=key)

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_upload_recovery_and_append_only_audit():
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            async with sessions.begin() as db:
                item = await new_upload(db, user, connections[0])
                fresh = await new_upload(db, user, connections[1])
            with pytest.raises(ValueError):
                await transition_upload(sessions, item.id, admin.id, "sending")
            await transition_upload(sessions, item.id, user.id, "sending")
            await transition_upload(sessions, fresh.id, user.id, "sending")
            async with sessions.begin() as db:
                intent = await db.scalar(
                    select(AuditEvent).where(AuditEvent.upload_item_id == item.id)
                )
                assert intent.event == "intent" and intent.actor_id == user.id
                assert intent.details["before"] == {"estdur": 8}
                assert intent.details["changes"] == {"estdur": 9}
                stale = await db.get(UploadItem, item.id)
                stale.updated_at = datetime.now(UTC) - timedelta(hours=1)
            assert (
                await recover_stale_sends(sessions, datetime.now(UTC) - timedelta(minutes=5)) == 1
            )
            async with sessions() as db:
                assert (await db.get(UploadItem, item.id)).state == "unknown"
                assert (await db.get(UploadItem, fresh.id)).state == "sending"
            with pytest.raises(ValueError):
                await transition_upload(sessions, item.id, user.id, "sending")
            with pytest.raises(ValueError):
                await transition_upload(sessions, item.id, user.id, "confirmed")
            await transition_upload(sessions, item.id, user.id, "confirmed", reconciled=True)
            for statement in (
                "UPDATE audit_event SET event = 'tampered'",
                "DELETE FROM audit_event",
                "TRUNCATE audit_event",
            ):
                with pytest.raises(DBAPIError, match="append-only"):
                    async with sessions.begin() as db:
                        await db.execute(text(statement))

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
