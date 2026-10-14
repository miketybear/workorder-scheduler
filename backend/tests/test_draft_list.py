import asyncio
import re
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, event, update
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, Draft, DraftItem, MaximoConnection
from app.main import create_app
from app.maximo.detail import current_snapshot
from app.maximo.reader import map_work_order
from app.scheduling.draft_list import page_rows
from app.scheduling.drafts import WorkOrderKey

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("case", ["overlap", "distinct", "mixed", "changed", "revoked", "moved"])
@pytest.mark.parametrize("expanded", [False, True])
def test_draft_page_verifies_distinct_keys_and_current_scope(case, expanded):
    async def scenario():
        async with database() as sessions:
            user, other, connections = await seed(sessions)
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
                ids = []
                specifications = [
                    (user.id, connection_id, "TEST", list(range(100, 300))),
                    (
                        user.id,
                        connection_id,
                        "TEST",
                        list(range(300, 500)) if case == "distinct" else list(range(100, 300)),
                    ),
                    (user.id, connection_id, "SECOND", [100]),
                    (other.id, connection_id, "TEST", [900]),
                    (user.id, connections[1].id, "TEST", [901]),
                ]
                for owner, connection, site, numbers in specifications:
                    draft = Draft(id=uuid4(), owner_id=owner, connection_id=connection)
                    db.add(draft)
                    await db.flush()
                    ids.append(draft.id)
                    for number in numbers:
                        db.add(
                            DraftItem(
                                draft_id=draft.id,
                                site_id=site,
                                workorder_id=str(number),
                                wonum=f"WO-{number}",
                                discipline="OTHER"
                                if case == "mixed" and draft.id == ids[0] and number == 299
                                else "MECH",
                                baseline=baseline,
                                changes={"estdur": "9"},
                            )
                        )
            settings = integration_settings()
            settings.maximo = {connection_id: config(crew_groups={"MECH": "CREW"})}
            app = create_app(settings)
            app.state.sessions = sessions
            calls = []
            active = peak = 0
            changed = False

            async def upstream(request):
                nonlocal active, peak, changed
                calls.append(request)
                if request.url.path.endswith("mxpersongroup"):
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {"persongroup": "CREW", "persongroupteam": [{"respparty": "TECH"}]}
                            ]
                        },
                    )
                active += 1
                peak = max(peak, active)
                try:
                    await asyncio.sleep(0.001)
                    if not changed and case in ("changed", "revoked"):
                        changed = True
                        async with sessions.begin() as db:
                            if case == "changed":
                                (await db.get(Draft, ids[0])).version += 1
                            else:
                                await db.execute(
                                    delete(AccessGrant).where(AccessGrant.user_id == user.id)
                                )
                    where = request.url.params["oslc.where"]
                    number = int(re.search(r"workorderid=(\d+)", where)[1])
                    site = "SECOND" if 'siteid="SECOND"' in where else "TEST"
                    return httpx.Response(
                        200,
                        json={
                            "member": []
                            if case == "moved" and number == 299
                            else [
                                record(
                                    workorderid=number,
                                    siteid=site,
                                    wonum=f"WO-{number}",
                                    worktype="CM",
                                    estdur=10,
                                    bdpocdiscipline="MECH",
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
                response = await client.get(
                    "/api/drafts",
                    params={
                        "connection_id": str(connection_id),
                        "discipline": "MECH",
                        "include_items": str(expanded).lower(),
                    },
                )
                assert peak <= 4
                assert active == 0
                assert len(calls) == (402 if case == "distinct" else 202)
                if case == "revoked":
                    assert response.status_code == 404
                    return
                assert response.status_code == 200, response.text
                rows = response.json()["items"]
                expected = ids[:3]
                if case in ("mixed", "changed"):
                    expected = ids[1:3]
                elif case == "moved":
                    expected = ids[2:3]
                assert {row["draft_id"] for row in rows} == {str(value) for value in expected}
                assert response.headers["Cache-Control"] == "no-store"
                assert response.json()["next_offset"] is None
                for row in rows:
                    assert ("items" in row) == expanded
                    if expanded:
                        assert len(row["items"]) == row["item_count"]
                        assert all(item["allowed_pics"] == ["TECH"] for item in row["items"])
                        assert all(item["baseline_changed"] for item in row["items"])
                        assert all(item["changes_valid_now"] for item in row["items"])

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_page_metadata_and_changes_share_one_statement_snapshot():
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            connection_id = connections[0].id
            draft_id = uuid4()
            async with sessions.begin() as db:
                db.add(Draft(id=draft_id, owner_id=user.id, connection_id=connection_id))
                await db.flush()
                db.add(
                    DraftItem(
                        draft_id=draft_id,
                        site_id="TEST",
                        workorder_id="100",
                        wonum="WO-100",
                        discipline="MECH",
                        baseline={},
                        changes={"estdur": "9"},
                    )
                )
            async with sessions() as db:
                connection = (await db.connection()).sync_connection
                saved = False

                def save_between_statement_and_materialization(
                    conn, cursor, statement, parameters, context, executemany
                ):
                    nonlocal saved
                    if (
                        saved
                        or not statement.lstrip().startswith("SELECT")
                        or "FROM draft" not in statement
                    ):
                        return
                    saved = True
                    # READ COMMITTED sees this save in the next SELECT. A split
                    # metadata/items read would combine old version with new edits.
                    conn.execute(update(Draft).where(Draft.id == draft_id).values(version=2))
                    conn.execute(
                        update(DraftItem)
                        .where(DraftItem.draft_id == draft_id)
                        .values(changes={"estdur": "10"})
                    )

                event.listen(
                    connection, "after_cursor_execute", save_between_statement_and_materialization
                )
                try:
                    drafts, groups = await page_rows(db, user.id, connection_id, [draft_id])
                finally:
                    event.remove(
                        connection,
                        "after_cursor_execute",
                        save_between_statement_and_materialization,
                    )
                assert saved
                assert drafts[draft_id].version == 1
                assert groups[draft_id][0].changes == {"estdur": "9"}

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
