import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, MaximoConnection
from app.main import create_app

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "case",
    [
        "allowed",
        "admin",
        "other-system",
        "other-discipline",
        "unknown",
        "revoked",
        "missing-config",
        "anonymous",
        "raw-query",
        "host-mismatch",
    ],
)
def test_retrieval_api_enforces_scope_and_revocation(monkeypatch, case):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            if case != "host-mismatch":
                async with sessions.begin() as db:
                    connection = await db.get(MaximoConnection, connections[0].id)
                    connection.base_url = "https://maximo.invalid/maximo"
            settings = integration_settings()
            settings.maximo = {connections[0].id: config()}
            if case == "missing-config":
                settings.maximo = {}
            app = create_app(settings)
            app.state.sessions = sessions
            calls = []

            async def upstream(request):
                calls.append(request)
                if case == "revoked":
                    async with sessions.begin() as db:
                        await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
                return httpx.Response(
                    200,
                    json={
                        "member": [record(bdpocdiscipline="MECH")],
                        "responseInfo": {"totalCount": 999},
                    },
                )

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with sessions.begin() as db:
                token, _ = await issue_session(db, admin if case == "admin" else user)
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                if case != "anonymous":
                    client.cookies.set(SESSION_COOKIE, token)
                params = {
                    "connection_id": str(connections[0].id),
                    "discipline": "MECH",
                    "target_from": "2026-09-01T00:00:00+07:00",
                    "target_before": "2026-10-01T00:00:00+07:00",
                }
                if case == "other-system":
                    params["connection_id"] = str(connections[1].id)
                if case == "unknown":
                    params["connection_id"] = str(uuid4())
                if case == "other-discipline":
                    params["discipline"] = "ELEC"
                if case == "raw-query":
                    params["oslc.where"] = 'status="APPR"'
                response = await client.get("/api/work-orders", params=params)
                expected = {
                    "allowed": 200,
                    "anonymous": 401,
                    "missing-config": 503,
                    "host-mismatch": 503,
                    "raw-query": 422,
                }.get(case, 404)
                assert response.status_code == expected
                if case == "allowed":
                    assert response.json()["count"] == 1
                    assert response.headers["Cache-Control"] == "no-store"
                    assert response.json()["connection_id"] == str(connections[0].id)
                else:
                    assert "DEMO" not in response.text
                assert "synthetic-test-key" not in response.text
                assert len(calls) == (1 if case in {"allowed", "revoked"} else 0)

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
