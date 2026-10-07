import asyncio
import copy
import re
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, Draft, DraftItem, DraftSubmission, MaximoConnection
from app.main import create_app

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "case",
    [
        "success",
        "csrf",
        "viewer",
        "moved",
        "closed",
        "stale",
        "pic",
        "dates",
        "pm",
        "duplicate",
        "limit",
        "other-scope",
    ],
)
def test_batch_atomic_validation_and_lifecycle(case):
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
            saving = False
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
                identifier = re.search(
                    r"workorderid=(\d+)", request.url.params["oslc.where"]
                ).group(1)
                bad = saving and identifier == "101"
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            record(
                                workorderid=int(identifier),
                                wonum="WO-" + identifier,
                                bdpocdiscipline="OTHER" if bad and case == "moved" else "MECH",
                                status="CLOSE" if bad and case == "closed" else "APPR",
                                worktype="PM" if case == "pm" else "CM",
                                estdur=10 if bad and case == "stale" else 8,
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
                headers = {"X-CSRF-Token": "bad" if case == "csrf" else csrf}
                scope = {"connection_id": str(connections[0].id), "discipline": "MECH"}
                keys = [
                    {"site_id": "TEST", "workorder_id": identifier} for identifier in ["100", "101"]
                ]
                if case == "duplicate":
                    keys.append(keys[0])
                if case == "limit":
                    keys = [{"site_id": "TEST", "workorder_id": str(i)} for i in range(201)]
                if case == "other-scope":
                    scope["connection_id"] = str(connections[1].id)
                prepared = await client.post(
                    "/api/draft-batches/prepare", json={**scope, "items": keys}, headers=headers
                )
                if case in {"csrf", "viewer", "duplicate", "limit", "other-scope"}:
                    assert (
                        prepared.status_code
                        == {
                            "csrf": 403,
                            "viewer": 404,
                            "duplicate": 422,
                            "limit": 422,
                            "other-scope": 404,
                        }[case]
                    ), prepared.text
                    assert not calls
                    return
                assert prepared.status_code == 200, prepared.text
                assert [item["item"]["workorderid"] for item in prepared.json()["items"]] == [
                    "100",
                    "101",
                ]
                assert sum(call.url.path.endswith("/mxpersongroup") for call in calls) == 1
                edits = [
                    {**key, "baseline_token": item["baseline_token"], "changes": {"estdur": "9"}}
                    for key, item in zip(keys, prepared.json()["items"], strict=True)
                ]
                if case == "pic":
                    edits[1]["changes"]["assignedtechname"] = "BAD"
                if case == "dates":
                    edits[1]["changes"].update(
                        schedstart="2026-10-02T10:00:00+07:00",
                        schedfinish="2026-10-02T09:00:00+07:00",
                    )
                if case == "pm":
                    edits[1]["changes"].update(
                        change_target=True, targcompdate="2026-10-02T00:00:00+07:00"
                    )
                payload = {**scope, "items": edits, "request_id": str(uuid4())}
                saving = True
                created = await client.post("/api/draft-batches", json=payload, headers=headers)
                assert created.status_code == (201 if case == "success" else 409), created.text
                async with sessions() as db:
                    assert await db.scalar(select(func.count()).select_from(Draft)) == (
                        1 if case == "success" else 0
                    )
                if case != "success":
                    assert created.json()["detail"]["errors"][0]["workorder_id"] == "101"
                    return
                result = created.json()
                replay = await client.post("/api/draft-batches", json=payload, headers=headers)
                assert replay.json() == result
                url = "/api/draft-batches/" + result["draft_id"]
                restored = await client.get(url)
                assert restored.status_code == 200, restored.text
                assert len(restored.json()["items"]) == 2
                assert all(item["changes"]["estdur"] == "9" for item in restored.json()["items"])
                update = {**copy.deepcopy(payload), "request_id": str(uuid4()), "version": 1}
                update["items"][0]["changes"]["estdur"] = "11"
                changed = await client.put(url, json=update, headers=headers)
                assert changed.status_code == 200, changed.text
                assert changed.json()["version"] == 2
                assert (
                    await client.put(url, json=update, headers=headers)
                ).json() == changed.json()
                assert (
                    await client.put(
                        url, json={**update, "request_id": str(uuid4())}, headers=headers
                    )
                ).status_code == 409
                client.cookies.set(SESSION_COOKIE, other_token)
                assert (await client.get(url)).status_code == 404
                client.cookies.set(SESSION_COOKIE, token)
                assert (
                    await client.delete(
                        "/api/drafts/" + result["draft_id"], params={"version": 2}, headers=headers
                    )
                ).status_code == 204
                assert (
                    await client.post("/api/draft-batches", json=payload, headers=headers)
                ).status_code == 404

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.parametrize("count", [100, 200])
@pytest.mark.parametrize("fault", [None, "stale", "pic", "revoked"])
def test_monthly_batch_persistence_and_atomic_failure(count, fault):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            connection = connections[0]
            async with sessions.begin() as db:
                (
                    await db.get(MaximoConnection, connection.id)
                ).base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
                other_token, _ = await issue_session(db, admin)
            settings = integration_settings()
            settings.maximo = {connection.id: config(crew_groups={"MECH": "CREW"})}
            app = create_app(settings)
            app.state.sessions = sessions
            saving = False
            active = peak = crew_calls = detail_calls = 0

            async def upstream(request):
                nonlocal active, peak, crew_calls, detail_calls
                assert request.method == "GET"
                if request.url.path.endswith("/mxpersongroup"):
                    crew_calls += 1
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {
                                    "persongroup": "CREW",
                                    "persongroupteam": [
                                        {"respparty": "TECH"},
                                        {"respparty": "OTHER"},
                                    ],
                                }
                            ]
                        },
                    )
                identifier = int(
                    re.search(r"workorderid=(\d+)", request.url.params["oslc.where"]).group(1)
                )
                detail_calls += 1
                active += 1
                peak = max(peak, active)
                try:
                    await asyncio.sleep(0.001)
                    if saving and identifier == 1000 + count - 1 and fault == "revoked":
                        async with sessions.begin() as db:
                            grant = await db.scalar(
                                select(AccessGrant).where(AccessGrant.user_id == user.id)
                            )
                            if grant is not None:
                                await db.delete(grant)
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                record(
                                    workorderid=identifier,
                                    wonum=f"MONTH-{identifier - 999}",
                                    bdpocdiscipline="MECH",
                                    worktype="PM" if identifier % 10 == 0 else "CM",
                                    assignedtechname="TECH",
                                    schedstart=None,
                                    schedfinish=None,
                                    estdur=10
                                    if saving
                                    and fault == "stale"
                                    and identifier == 1000 + count - 1
                                    else 8,
                                )
                            ]
                        },
                    )
                finally:
                    active -= 1

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"X-CSRF-Token": csrf}
                scope = {"connection_id": str(connection.id), "discipline": "MECH"}
                keys = [{"site_id": "TEST", "workorder_id": str(1000 + i)} for i in range(count)]
                prepared = await client.post(
                    "/api/draft-batches/prepare", json={**scope, "items": keys}, headers=headers
                )
                assert prepared.status_code == 200, prepared.text
                assert crew_calls == 1 and detail_calls == count and 1 < peak <= 4
                changes = {
                    "schedstart": "2026-10-09T08:00:00+07:00",
                    "schedfinish": "2026-10-09T17:30:00+07:00",
                    "estdur": "9.5",
                    "assignedtechname": "OTHER",
                }
                edits = [
                    {
                        **key,
                        "baseline_token": item["baseline_token"],
                        "changes": copy.deepcopy(changes),
                    }
                    for key, item in zip(keys, prepared.json()["items"], strict=True)
                ]
                edits[-1]["changes"].update(estdur="2.25", schedfinish="2026-10-09T10:15:00+07:00")
                if fault == "pic":
                    edits[-1]["changes"]["assignedtechname"] = "INVALID"
                payload = {**scope, "items": edits, "request_id": str(uuid4())}
                saving = True
                created = await client.post("/api/draft-batches", json=payload, headers=headers)
                assert created.status_code == (
                    404 if fault == "revoked" else 409 if fault else 201
                ), created.text
                async with sessions() as db:
                    for model, expected in [(Draft, 1), (DraftItem, count), (DraftSubmission, 1)]:
                        assert await db.scalar(select(func.count()).select_from(model)) == (
                            0 if fault else expected
                        )
                if fault:
                    if fault != "revoked":
                        issue = created.json()["detail"]["errors"]
                        assert (
                            len(issue) == 1 and issue[0]["workorder_id"] == keys[-1]["workorder_id"]
                        )
                    return
                result = created.json()
                assert (
                    await client.post("/api/draft-batches", json=payload, headers=headers)
                ).json() == result
                url = "/api/draft-batches/" + result["draft_id"]
                restored = await client.get(url)
                assert restored.status_code == 200, restored.text
                by_id = {item["workorder_id"]: item for item in restored.json()["items"]}
                assert len(by_id) == count
                for edit in edits:
                    assert by_id[edit["workorder_id"]]["changes"] == edit["changes"]
                update = {**copy.deepcopy(payload), "version": 1, "request_id": str(uuid4())}
                update["items"][0]["changes"]["assignedtechname"] = "TECH"
                updated = await client.put(url, json=update, headers=headers)
                assert updated.status_code == 200 and updated.json()["version"] == 2, updated.text
                assert (
                    await client.put(url, json=update, headers=headers)
                ).json() == updated.json()
                stale = await client.put(
                    url, json={**update, "request_id": str(uuid4())}, headers=headers
                )
                assert stale.status_code == 409
                async with sessions() as db:
                    assert await db.scalar(select(func.count()).select_from(DraftItem)) == count
                    assert await db.scalar(select(func.count()).select_from(DraftSubmission)) == 2
                before = detail_calls
                client.cookies.set(SESSION_COOKIE, other_token)
                assert (await client.get(url)).status_code == 404
                assert detail_calls == before
                assert peak <= 4 and active == 0

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
