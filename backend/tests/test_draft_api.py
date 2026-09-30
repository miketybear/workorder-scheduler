import asyncio

import httpx
import pytest
from sqlalchemy import delete, func, select
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, Draft, MaximoConnection
from app.main import create_app

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "case", ["success", "csrf", "viewer", "pic", "pm", "moved", "closed", "unknown-field"]
)
def test_draft_creation_uses_current_upstream_and_permissions(case):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            async with sessions.begin() as db:
                (
                    await db.get(MaximoConnection, connections[0].id)
                ).base_url = "https://maximo.invalid/maximo"
                if case == "viewer":
                    grant = await db.scalar(
                        select(AccessGrant).where(AccessGrant.user_id == user.id)
                    )
                    grant.capability = "read"
                token, csrf = await issue_session(db, user)
                other_token, _ = await issue_session(db, admin)
            settings = integration_settings()
            settings.maximo = {connections[0].id: config(crew_groups={"MECH": "CREW"})}
            app = create_app(settings)
            app.state.sessions = sessions
            moved = False
            calls = []

            def upstream(request):
                calls.append(request)
                assert request.method == "GET"
                if request.url.path.endswith("/mxpersongroup"):
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {"persongroup": "CREW", "persongroupteam": [{"respparty": "TECH"}]}
                            ]
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            record(
                                bdpocdiscipline="OTHER" if moved or case == "moved" else "MECH",
                                worktype="PM" if case == "pm" else "CM",
                                status="CLOSE" if case == "closed" else "APPR",
                            )
                        ]
                    },
                )

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                changes = {"estdur": "9", "assignedtechname": "BAD" if case == "pic" else "TECH"}
                if case == "pm":
                    changes.update(change_target=True, targcompdate="2026-10-02T00:00:00+07:00")
                if case == "unknown-field":
                    changes["status"] = "COMP"
                payload = {
                    "connection_id": str(connections[0].id),
                    "site_id": "TEST",
                    "workorder_id": "100",
                    "discipline": "MECH",
                    "changes": changes,
                }
                response = await client.post(
                    "/api/drafts",
                    json=payload,
                    headers={"X-CSRF-Token": "wrong" if case == "csrf" else csrf},
                )
                expected = {
                    "success": 201,
                    "csrf": 403,
                    "viewer": 404,
                    "moved": 502,
                    "closed": 409,
                }.get(case, 422)
                assert response.status_code == expected, response.text
                async with sessions() as db:
                    assert await db.scalar(select(func.count()).select_from(Draft)) == (
                        1 if case == "success" else 0
                    )
                if case in {"csrf", "viewer", "unknown-field"}:
                    assert calls == []
                if case != "success":
                    return
                url = "/api/drafts/" + response.json()["draft_id"]
                restored = await client.get(url)
                assert restored.status_code == 200
                assert restored.json()["items"][0]["baseline"]["estdur"] == "8"
                assert restored.json()["items"][0]["changes"]["estdur"] == "9"
                assert restored.json()["items"][0]["baseline_changed"] is False
                assert restored.json()["items"][0]["changes_valid_now"] is True
                detail = await client.get(
                    "/api/work-orders/detail",
                    params={key: value for key, value in payload.items() if key != "changes"},
                )
                assert detail.status_code == 200
                assert detail.json()["allowed_pics"] == ["TECH"]
                assert detail.json()["revision"] is None
                client.cookies.set(SESSION_COOKIE, other_token)
                before = len(calls)
                assert (await client.get(url)).status_code == 404
                assert len(calls) == before
                client.cookies.set(SESSION_COOKIE, token)
                moved = True
                response = await client.get(url)
                assert response.status_code == 502 and "TECH" not in response.text
                moved = False
                async with sessions.begin() as db:
                    await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
                before = len(calls)
                assert (await client.get(url)).status_code == 404
                assert len(calls) == before

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
