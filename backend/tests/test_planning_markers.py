import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, Draft, DraftItem, MaximoConnection
from app.main import create_app
from app.maximo.detail import current_snapshot
from app.maximo.reader import map_work_order
from app.scheduling.drafts import WorkOrderKey

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("case", ["allowed", "stale", "moved", "revoked"])
def test_planning_index_is_owned_scoped_and_uses_one_upstream_list(case):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            connection_id = connections[0].id
            baseline = current_snapshot(
                WorkOrderKey(connection_id, "TEST", "100"),
                map_work_order(record(worktype="CM", estdur=8, bdpocdiscipline="MECH")),
                frozenset(),
            ).baseline.model_dump(mode="json")
            async with sessions.begin() as db:
                (
                    await db.get(MaximoConnection, connection_id)
                ).base_url = "https://maximo.invalid/maximo"
                token, _ = await issue_session(db, user)
                drafts = []
                for owner, connection, discipline, site, identifiers in [
                    (user.id, connection_id, "MECH", "TEST", ["100"]),
                    (user.id, connection_id, "MECH", "TEST", ["100", "101"]),
                    (user.id, connection_id, "MECH", "SECOND", ["100"]),
                    (admin.id, connection_id, "MECH", "TEST", ["100"]),
                    (user.id, connections[1].id, "MECH", "TEST", ["100"]),
                    (user.id, connection_id, "OTHER", "TEST", ["100"]),
                ]:
                    draft = Draft(id=uuid4(), owner_id=owner, connection_id=connection, version=2)
                    db.add(draft)
                    await db.flush()
                    drafts.append(draft.id)
                    for identifier in identifiers:
                        db.add(
                            DraftItem(
                                draft_id=draft.id,
                                site_id=site,
                                workorder_id=identifier,
                                wonum="WO-" + identifier,
                                discipline=discipline,
                                baseline=baseline,
                                changes={"estdur": "9"},
                            )
                        )
            settings = integration_settings()
            settings.maximo = {connection_id: config(crew_groups={"MECH": "CREW"})}
            app = create_app(settings)
            app.state.sessions = sessions
            calls = []

            async def upstream(request):
                calls.append(request)
                assert request.method == "GET"
                if case == "revoked":
                    async with sessions.begin() as db:
                        await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
                if request.url.path.endswith("mxpersongroup"):
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {"persongroup": "CREW", "persongroupteam": [{"respparty": "TECH"}]}
                            ]
                        },
                    )
                where = request.url.params["oslc.where"]
                identifier = "101" if "workorderid=101" in where else "100"
                site = "SECOND" if 'siteid="SECOND"' in where else "TEST"
                members = (
                    []
                    if case == "moved"
                    else [
                        record(
                            siteid=site,
                            workorderid=int(identifier),
                            wonum="WO-" + identifier,
                            bdpocdiscipline="MECH",
                            worktype="CM",
                            estdur=10 if case == "stale" else 8,
                        )
                    ]
                )
                return httpx.Response(200, json={"member": members})

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                scope = {"connection_id": str(connection_id), "discipline": "MECH"}
                response = await client.get(
                    "/api/work-orders",
                    params={
                        **scope,
                        "target_from": "2026-09-01T00:00:00+07:00",
                        "target_before": "2026-10-01T00:00:00+07:00",
                    },
                )
                assert len(calls) == 1  # No N+1 detail or crew calls to paint markers.
                if case == "revoked":
                    assert response.status_code == 404
                    return
                assert response.status_code == 200, response.text
                assert response.headers["Cache-Control"] == "no-store"
                if case == "moved":
                    assert response.json()["items"] == []
                    return
                row = response.json()["items"][0]
                assert row["estdur"] == ("10" if case == "stale" else "8")
                markers = row["drafts"]
                assert {item["draft_id"] for item in markers} == {
                    str(value) for value in drafts[:2]
                }
                assert {item["is_batch"] for item in markers} == {False, True}
                assert all(item["changes"] == {"estdur": "9"} for item in markers)
                assert all(item["baseline_changed"] == (case == "stale") for item in markers)
                assert all("item_count" not in item and "items" not in item for item in markers)
                plans = await client.get("/api/drafts", params={**scope, "include_items": "true"})
                assert plans.status_code == 200, plans.text
                assert plans.json()["connection_id"] == str(connection_id)
                assert {item["draft_id"] for item in plans.json()["items"]} == {
                    str(value) for value in drafts[:3]
                }
                group = next(
                    item for item in plans.json()["items"] if item["draft_id"] == str(drafts[1])
                )
                assert {item["workorder_id"] for item in group["items"]} == {"100", "101"}
                assert all(item["discipline"] == "MECH" for item in group["items"])

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
