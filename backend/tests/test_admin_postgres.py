import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from test_entra import entra_settings
from test_maximo import config
from test_postgres import database, seed

from app.auth.bootstrap import bootstrap_admin
from app.auth.planner import PlannerChange, change_planner
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, AdminAuthorityEvent, LoginFlow, LoginSession, User
from app.main import create_app
from cleanup_auth import cleanup_auth

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("case", ["admin", "viewer", "revoked", "inactive", "foreign", "anonymous"])
def test_roster_current_authority_and_tenant_scope(case):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {
                connections[0].id: config(
                    person_login_domain="biendongpoc.vn", crew_groups={"MECH": "CREW"}
                )
            }
            foreign_id = uuid4()
            async with sessions.begin() as db:
                stored = await db.get(User, admin.id)
                stored.tenant_id = user.tenant_id
                db.add(
                    User(
                        id=foreign_id, tenant_id=uuid4(), object_id=uuid4(), display_name="foreign"
                    )
                )
                token, _ = await issue_session(db, user if case == "viewer" else stored)
            async with sessions.begin() as db:
                stored = await db.get(User, admin.id)
                if case == "revoked":
                    stored.is_admin = False
                if case == "inactive":
                    stored.active = False
                if case == "foreign":
                    stored.tenant_id = uuid4()
            app = create_app(settings)
            app.state.sessions = sessions
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                if case != "anonymous":
                    client.cookies.set(SESSION_COOKIE, token)
                response = await client.get("/api/admin/roster")
            assert (
                response.status_code
                == {
                    "admin": 200,
                    "viewer": 403,
                    "revoked": 403,
                    "inactive": 401,
                    "foreign": 403,
                    "anonymous": 401,
                }[case]
            )
            if case == "admin":
                assert response.headers["Cache-Control"] == "no-store"
                payload = response.json()
                assert {row["id"] for row in payload["users"]} == {str(user.id), str(admin.id)}
                assert payload["connections"] == [
                    {
                        "id": str(connections[0].id),
                        "label": "onshore",
                        "system": "onshore",
                        "environment": "test",
                        "enabled": True,
                        "disciplines": ["MECH"],
                    }
                ]
                assert payload["grants"] == [
                    {
                        "user_id": str(user.id),
                        "connection_id": str(connections[0].id),
                        "discipline": "MECH",
                        "capability": "write",
                    }
                ]
                assert payload["permissions"] == []
                assert "base_url" not in response.text and "secret_reference" not in response.text

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_planner_rejects_unknown_mapping_and_cross_tenant_but_allows_stale_revoke():
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {
                connections[0].id: config(
                    person_login_domain="biendongpoc.vn", crew_groups={"MECH": "CREW"}
                )
            }
            change = PlannerChange(
                user_id=user.id,
                connection_id=connections[0].id,
                discipline="MECH",
                enabled=True,
                reason="Synthetic approval",
            )
            async with sessions.begin() as db:
                with pytest.raises(HTTPException) as error:
                    await change_planner(
                        db, settings, admin.id, change.model_copy(update={"discipline": "OTHER"})
                    )
                assert error.value.status_code == 422
                with pytest.raises(HTTPException) as error:
                    await change_planner(
                        db, settings, admin.id, change.model_copy(update={"user_id": admin.id})
                    )
                assert error.value.status_code == 404
                await change_planner(db, settings, admin.id, change)
                settings.maximo[connections[0].id].crew_groups = {}
                assert await change_planner(
                    db, settings, admin.id, change.model_copy(update={"enabled": False})
                )

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_first_admin_bootstrap_audited_no_grants_and_immutable():
    async def scenario():
        async with database() as sessions:
            settings = integration_settings()
            settings.entra = entra_settings()
            target = User(
                tenant_id=settings.entra.tenant_id, object_id=uuid4(), display_name="First"
            )
            async with sessions.begin() as db:
                db.add(target)
                await db.flush()
                preview = await bootstrap_admin(
                    db,
                    settings,
                    target.tenant_id,
                    target.object_id,
                    "IT operator",
                    "Preview only",
                    execute=False,
                )
                assert preview["object_id"] == str(target.object_id)
                assert not target.is_admin
                assert await db.scalar(select(func.count()).select_from(AdminAuthorityEvent)) == 0
                for tenant, object_id, operator, reason in [
                    (uuid4(), target.object_id, "IT operator", "Approval"),
                    (target.tenant_id, uuid4(), "IT operator", "Approval"),
                    (target.tenant_id, target.object_id, " ", "Approval"),
                    (target.tenant_id, target.object_id, "IT operator", " "),
                ]:
                    with pytest.raises(ValueError):
                        await bootstrap_admin(db, settings, tenant, object_id, operator, reason)
                await bootstrap_admin(
                    db,
                    settings,
                    target.tenant_id,
                    target.object_id,
                    "IT operator",
                    "Synthetic approval",
                )
                assert target.is_admin
                assert await db.scalar(select(func.count()).select_from(AccessGrant)) == 0
                event = await db.scalar(select(AdminAuthorityEvent))
                assert event.operator == "IT operator" and event.user_id == target.id
                assert event.details["object_id"] == str(target.object_id)
                with pytest.raises(ValueError, match="already exists"):
                    await bootstrap_admin(
                        db, settings, target.tenant_id, target.object_id, "IT operator", "Replay"
                    )
                for sql in [
                    "UPDATE admin_authority_event SET reason='changed'",
                    "DELETE FROM admin_authority_event",
                    "TRUNCATE admin_authority_event",
                ]:
                    with pytest.raises(DBAPIError):
                        async with db.begin_nested():
                            await db.execute(text(sql))

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_auth_cleanup_dry_run_and_only_expired_records():
    async def scenario():
        async with database() as sessions:
            user, _, _ = await seed(sessions)
            now = datetime.now(UTC)
            async with sessions.begin() as db:
                await issue_session(db, user)
                db.add(
                    LoginSession(
                        token_hash="a" * 64,
                        csrf_hash="b" * 64,
                        user_id=user.id,
                        created_at=now - timedelta(hours=9),
                        expires_at=now - timedelta(hours=1),
                    )
                )
                db.add_all(
                    [
                        LoginFlow(token_hash="a" * 64, flow={}, expires_at=now - timedelta(1)),
                        LoginFlow(token_hash="b" * 64, flow={}, expires_at=now + timedelta(1)),
                    ]
                )
                await db.flush()
                expected = {"login_session": 1, "login_flow": 1}
                assert await cleanup_auth(db, cutoff=now) == expected
                assert await cleanup_auth(db, cutoff=now) == expected
                assert await cleanup_auth(db, execute=True, cutoff=now) == expected
                assert await cleanup_auth(db, cutoff=now) == {"login_session": 0, "login_flow": 0}
                assert await db.scalar(select(func.count()).select_from(LoginSession)) == 1
                assert await db.scalar(select(func.count()).select_from(LoginFlow)) == 1
                assert await db.scalar(select(func.count()).select_from(AccessGrant)) == 1

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
