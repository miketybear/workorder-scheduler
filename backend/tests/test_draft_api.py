import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, Draft, DraftSubmission, LoginSession, MaximoConnection, User
from app.main import create_app
from app.maximo.detail import current_snapshot
from app.maximo.reader import WorkOrder
from app.scheduling.drafts import WorkOrderKey
from app.scheduling.routes import snapshot_token

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "case", ["success", "csrf", "viewer", "pic", "pm", "moved", "closed", "unknown-field", "stale"]
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
                                estdur=10 if case == "stale" else 8,
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
                    "request_id": str(uuid4()),
                    "baseline_token": snapshot_token(
                        current_snapshot(
                            WorkOrderKey(connections[0].id, "TEST", "100"),
                            WorkOrder.model_validate(
                                record(
                                    bdpocdiscipline="MECH", worktype="PM" if case == "pm" else "CM"
                                )
                            ),
                            frozenset({"TECH"}),
                        )
                    ),
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
                    "stale": 409,
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
                    params={
                        key: value
                        for key, value in payload.items()
                        if key in {"connection_id", "site_id", "workorder_id", "discipline"}
                    },
                )
                assert detail.status_code == 200
                assert detail.json()["allowed_pics"] == ["TECH"]
                assert detail.json()["revision"] is None
                headers = {"X-CSRF-Token": csrf}
                duplicate = await client.post("/api/drafts", json=payload, headers=headers)
                assert duplicate.json() == response.json()
                altered = {**payload, "changes": {"estdur": "10"}}
                assert (
                    await client.post("/api/drafts", json=altered, headers=headers)
                ).status_code == 409
                stale = {**payload, "request_id": str(uuid4()), "baseline_token": "0" * 64}
                assert (
                    await client.post("/api/drafts", json=stale, headers=headers)
                ).status_code == 409
                listing = await client.get(
                    "/api/drafts",
                    params={"connection_id": payload["connection_id"], "discipline": "MECH"},
                )
                assert listing.status_code == 200, listing.text
                assert len(listing.json()["items"]) == 1
                assert (
                    await client.get(
                        "/api/drafts",
                        params={"connection_id": str(connections[1].id), "discipline": "MECH"},
                    )
                ).status_code == 404
                updated = {
                    **payload,
                    "request_id": str(uuid4()),
                    "version": 1,
                    "changes": {"estdur": "10"},
                }
                saved = await client.put(url, json=updated, headers=headers)
                assert saved.status_code == 200, saved.text
                assert saved.json()["version"] == 2
                assert (await client.put(url, json=updated, headers=headers)).json() == saved.json()
                updated["request_id"] = str(uuid4())
                assert (await client.put(url, json=updated, headers=headers)).status_code == 409
                assert (
                    await client.delete(url, params={"version": 1}, headers=headers)
                ).status_code == 409
                client.cookies.set(SESSION_COOKIE, other_token)
                before = len(calls)
                assert (await client.get(url)).status_code == 404
                assert len(calls) == before
                assert (
                    await client.put(url, json=updated, headers={"X-CSRF-Token": csrf})
                ).status_code == 403
                client.cookies.set(SESSION_COOKIE, token)
                moved = True
                response = await client.get(url)
                assert response.status_code == 502 and "TECH" not in response.text
                assert (
                    await client.put(url, json={**updated, "version": 2}, headers=headers)
                ).status_code == 502
                assert (
                    await client.delete(url, params={"version": 2}, headers=headers)
                ).status_code == 502
                moved = False
                async with sessions.begin() as db:
                    await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
                before = len(calls)
                assert (await client.get(url)).status_code == 404
                assert len(calls) == before
                assert (await client.put(url, json=updated, headers=headers)).status_code == 404
                assert (
                    await client.delete(url, params={"version": 2}, headers=headers)
                ).status_code == 404
                async with sessions.begin() as db:
                    db.add(
                        AccessGrant(
                            user_id=user.id,
                            connection_id=connections[0].id,
                            discipline="MECH",
                            capability="write",
                        )
                    )
                assert (
                    await client.delete(url, params={"version": 2}, headers=headers)
                ).status_code == 204
                assert (await client.get(url)).status_code == 404
                assert (
                    await client.post("/api/drafts", json=payload, headers=headers)
                ).status_code == 404

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_concurrent_create_and_update_use_separate_transactions():
    async def scenario():
        settings = integration_settings()
        engine = create_async_engine(
            settings.database_url.get_secret_value(),
            hide_parameters=True,
            connect_args={"connect_timeout": 3},
        )
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        actors = []
        connection_ids = []
        try:
            user, admin, connections = await seed(sessions)
            actors = [user.id, admin.id]
            connection_ids = [connection.id for connection in connections]
            async with sessions.begin() as db:
                (
                    await db.get(MaximoConnection, connections[0].id)
                ).base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
            settings.maximo = {connections[0].id: config(crew_groups={"MECH": "CREW"})}
            app = create_app(settings)
            app.state.sessions = sessions

            def upstream(request):
                assert request.method == "GET"
                member = (
                    [{"persongroup": "CREW", "persongroupteam": [{"respparty": "TECH"}]}]
                    if request.url.path.endswith("mxpersongroup")
                    else [record(bdpocdiscipline="MECH")]
                )
                return httpx.Response(200, json={"member": member})

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                key = {
                    "connection_id": str(connections[0].id),
                    "site_id": "TEST",
                    "workorder_id": "100",
                    "discipline": "MECH",
                }
                current = await client.get("/api/work-orders/detail", params=key)
                assert current.status_code == 200
                payload = {
                    **key,
                    "baseline_token": current.json()["baseline_token"],
                    "request_id": str(uuid4()),
                    "changes": {"estdur": "9"},
                }
                headers = {"X-CSRF-Token": csrf}
                responses = await asyncio.gather(
                    *[client.post("/api/drafts", json=payload, headers=headers) for _ in range(2)]
                )
                assert [response.status_code for response in responses] == [201, 201]
                assert responses[0].json() == responses[1].json()
                async with sessions() as db:
                    assert (
                        await db.scalar(
                            select(func.count()).select_from(Draft).where(Draft.owner_id == user.id)
                        )
                        == 1
                    )
                url = "/api/drafts/" + responses[0].json()["draft_id"]
                responses = await asyncio.gather(
                    *[
                        client.put(
                            url,
                            json={
                                **payload,
                                "request_id": str(uuid4()),
                                "version": 1,
                                "changes": {"estdur": duration},
                            },
                            headers=headers,
                        )
                        for duration in ["10", "11"]
                    ]
                )
                assert sorted(response.status_code for response in responses) == [200, 409]
                assert (await client.get(url)).json()["version"] == 2
        finally:
            # This test commits to exercise actual lock waiting; remove only its own rows.
            if actors:
                async with sessions.begin() as db:
                    await db.execute(
                        delete(DraftSubmission).where(DraftSubmission.actor_id.in_(actors))
                    )
                    await db.execute(delete(Draft).where(Draft.owner_id.in_(actors)))
                    await db.execute(delete(LoginSession).where(LoginSession.user_id.in_(actors)))
                    await db.execute(delete(AccessGrant).where(AccessGrant.user_id.in_(actors)))
                    await db.execute(delete(User).where(User.id.in_(actors)))
                    await db.execute(
                        delete(MaximoConnection).where(MaximoConnection.id.in_(connection_ids))
                    )
            await engine.dispose()

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
