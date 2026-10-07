import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import delete, select
from test_maximo import config
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, LoginSession, MaximoConnection
from app.main import create_app

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "case",
    [
        "lifecycle",
        "csrf",
        "admin-no-grant",
        "not-granted",
        "disabled",
        "ambiguous",
        "unknown-field",
        "revoked",
        "expired",
        "unconfigured",
    ],
)
def test_account_connection_setting(case):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            settings = integration_settings()
            settings.maximo = {connection.id: config() for connection in connections}
            async with sessions.begin() as db:
                for connection in connections:
                    (
                        await db.get(MaximoConnection, connection.id)
                    ).base_url = "https://maximo.invalid/maximo"
                actor = admin if case == "admin-no-grant" else user
                token, csrf = await issue_session(db, actor)
                if case in {"lifecycle", "ambiguous"}:
                    db.add(
                        AccessGrant(
                            user_id=user.id,
                            connection_id=connections[1 if case == "lifecycle" else 0].id,
                            discipline="MECH" if case == "lifecycle" else "E&I",
                            capability="read",
                        )
                    )
            app = create_app(settings)
            app.state.sessions = sessions
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                assert (await client.get("/api/settings/connection")).status_code == 401
                client.cookies.set(SESSION_COOKIE, token)
                info = (await client.get("/api/settings/connection")).json()
                assert info["preferred_connection_id"] is None
                assert "api_key" not in str(info) and "secret_reference" not in str(info)
                if case == "admin-no-grant":
                    assert info["connections"] == []
                elif case != "lifecycle":
                    assert {item["connection_id"] for item in info["connections"]} == {
                        str(connections[0].id)
                    }
                if case == "disabled":
                    async with sessions.begin() as db:
                        (await db.get(MaximoConnection, connections[0].id)).enabled = False
                if case == "expired":
                    async with sessions.begin() as db:
                        login = await db.scalar(
                            select(LoginSession).where(LoginSession.user_id == actor.id)
                        )
                        login.created_at = datetime.now(UTC) - timedelta(hours=9)
                        login.expires_at = datetime.now(UTC) - timedelta(hours=1)
                if case == "unconfigured":
                    settings.maximo = {}
                payload = {"connection_id": str(connections[1 if case == "not-granted" else 0].id)}
                if case == "unknown-field":
                    payload["user_id"] = str(admin.id)
                    payload["url"] = "https://arbitrary.invalid"
                response = await client.put(
                    "/api/settings/connection",
                    json=payload,
                    headers={} if case == "csrf" else {"X-CSRF-Token": csrf},
                )
                expected = {
                    "csrf": 403,
                    "admin-no-grant": 404,
                    "not-granted": 404,
                    "disabled": 404,
                    "ambiguous": 409,
                    "unknown-field": 422,
                    "expired": 401,
                    "unconfigured": 503,
                }.get(case, 204)
                assert response.status_code == expected
                if expected != 204:
                    return
                assert response.headers["Cache-Control"] == "no-store"
                if case == "revoked":
                    async with sessions.begin() as db:
                        await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
                    info = (await client.get("/api/settings/connection")).json()
                    assert info["connections"] == [] and info["preferred_connection_id"] is None
                    assert (
                        await client.put(
                            "/api/settings/connection", json=payload, headers={"X-CSRF-Token": csrf}
                        )
                    ).status_code == 404
                else:
                    second_id = str(connections[1].id)
                    assert (
                        await client.put(
                            "/api/settings/connection",
                            json={"connection_id": second_id},
                            headers={"X-CSRF-Token": csrf},
                        )
                    ).status_code == 204
                    async with sessions.begin() as db:
                        new_token, _ = await issue_session(db, user)
                        other_token, _ = await issue_session(db, admin)
                    client.cookies.set(SESSION_COOKIE, new_token)
                    info = await client.get("/api/auth/session")
                    assert info.json()["preferred_connection_id"] == second_id
                    client.cookies.set(SESSION_COOKIE, other_token)
                    assert (await client.get("/api/auth/session")).json()[
                        "preferred_connection_id"
                    ] is None

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
