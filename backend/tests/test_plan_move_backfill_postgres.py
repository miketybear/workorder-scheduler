"""Moving a task plan away backfills the source person's following plans of the same WO."""

import asyncio
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from test_assignment_plans_postgres import concurrent_plan_database
from test_assignments_postgres import discipline_fixture
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import seed
from test_task_assignments import sample

from app.assignments.models import (
    Allocation,
    AssignmentEvent,
    AssignmentPlan,
    AssignmentSubmission,
)
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import MaximoConnection, PlannerPermission
from app.main import create_app
from app.maximo.tasks import map_tasks
from app.rota.activation import materialize, proposed_days
from app.rota.models import (
    PersonDayCapacity,
    ResourcePerson,
    ResourcePool,
    ResourcePoolGrant,
    ResourcePoolState,
    RotaImport,
)
from app.scheduling.drafts import WorkOrderKey

pytestmark = pytest.mark.integration


def d(n):
    return date(2026, 10, n)


# (task id, assignment id, [(day-of-month, minutes)])
CHAIN = [
    (20, "320", [(1, 30), (2, 630), (3, 630), (4, 630), (5, 480)]),
    (30, "330", [(5, 150), (6, 450)]),
    (40, "340", [(6, 180), (7, 420)]),
    (50, "350", [(7, 210), (8, 390)]),
]
# Cell rule: T20 takes the 600 freed hours of 10-01 from its tail; each emptied tail day is then
# offered to the task that continues from it, cascading down the chain.
EXPECTED = {
    20: [(1, 630), (2, 630), (3, 630), (4, 510)],
    30: [(5, 600)],
    40: [(6, 600)],
    50: [(7, 600)],
}


async def rows_of(sessions, plan_id):
    async with sessions() as db:
        rows = (
            await db.scalars(
                select(Allocation)
                .where(Allocation.plan_id == plan_id, Allocation.state == "reserved")
                .order_by(Allocation.date)
            )
        ).unique()
        return [(r.date.day, r.minutes) for r in rows]


@pytest.mark.parametrize(
    "mode",
    [
        "backfill",
        "preview_off",
        "commit_without_backfill",
        "stale_follower",
        "tampered",
        "rollback",
        "synced_follower",
        "replay",
        "other_wo_load",
    ],
)
def test_move_backfills_followers_atomically(monkeypatch, mode):
    for module in (
        "app.scheduling.routes",
        "app.assignments.routes",
        "app.assignments.bulk_uploads",
    ):
        monkeypatch.setattr(module + ".sync_person_access", AsyncMock())
    monkeypatch.setattr(
        "app.assignments.plan_uploads.verified_person_scope",
        AsyncMock(return_value=("MECH", "synthetic", False)),
    )

    chain = CHAIN
    moved_day = 1

    async def scenario():
        async with concurrent_plan_database() as sessions:
            user, _, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {
                connections[0].id: config(task_load_contract="bdsched_assignment_test")
            }
            remote_sample = sample()
            remote_sample["woactivitytask"][0]["showassignment"][0]["laborhrs"] = 20
            baseline = (
                map_tasks(remote_sample, WorkOrderKey(connections[0].id, "TEST", "100"), "MECH")[0]
                .assignments[0]
                .model_dump(mode="json")
            )
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
                db.add(
                    PlannerPermission(
                        user_id=user.id, connection_id=connection.id, discipline="MECH"
                    )
                )
                pool = ResourcePool(
                    connection_id=connection.id, label="Backfill", orgid="ORG", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                data = discipline_fixture(pool)
                data["source"]["coverage_before"] = "2026-11-10"
                for row in data["source"]["rows"]:
                    row["days"] = [
                        dict(
                            date=(d(1) + timedelta(days=n)).isoformat(),
                            code="1",
                            capacity_hours=10.5,
                        )
                        for n in range(40)
                    ]
                stage = RotaImport(
                    pool_id=pool.id,
                    actor_id=user.id,
                    version=2,
                    file_name="synthetic.ods",
                    sheet="ROTA_2026",
                    **data,
                )
                state = ResourcePoolState(pool_id=pool.id, version=0)
                db.add_all([stage, state])
                await db.flush()
                proposed, errors = proposed_days(stage, pool)
                assert not errors
                await materialize(
                    db, stage, pool, state, SimpleNamespace(user_id=user.id), proposed
                )
                people = list(
                    await db.scalars(
                        select(ResourcePerson)
                        .where(ResourcePerson.pool_id == pool.id)
                        .order_by(ResourcePerson.person_key)
                    )
                )
                original, target = people[:2]
                day = await db.get(PersonDayCapacity, (pool.id, original.id, d(1)))

                def make_plan(task_id, assignment, rows, workorder="100", sync="local"):
                    plan = AssignmentPlan(
                        actor_id=user.id,
                        pool_id=pool.id,
                        connection_id=connection.id,
                        assignment_id=assignment,
                        person_id=original.id,
                        laborcode=day.laborcode,
                        demand_minutes=sum(m for _, m in rows),
                        state="reserved",
                        sync_state=sync,
                    )
                    db.add(plan)
                    out = []
                    for n, minutes in rows:
                        item = Allocation(
                            pool_id=pool.id,
                            person_id=original.id,
                            connection_id=connection.id,
                            site_id="TEST",
                            workorder_id=workorder,
                            discipline="MECH",
                            craft=day.craft,
                            role=day.role,
                            laborcode=day.laborcode,
                            date=d(n),
                            minutes=minutes,
                            plan=plan,
                            task_workorder_id="2" + assignment,
                            task_id=task_id,
                            task_description=f"T{task_id}",
                            assignment_id=assignment,
                            upstream_baseline=baseline,
                            sync_state=sync,
                        )
                        db.add(item)
                        out.append(item)
                    return plan, out

                moved, moved_rows = make_plan(10, "300", [(moved_day, 600)])
                # The moved plan's source task id must match the mocked Maximo task.
                for item in moved_rows:
                    item.task_workorder_id, item.task_id = "200", 10
                followers = {}
                for task_id, assignment, rows in chain:
                    sync = "synced" if mode == "synced_follower" and task_id == 20 else "local"
                    followers[task_id] = make_plan(task_id, assignment, rows, sync=sync)[0]
                if mode == "other_wo_load":
                    # Another work order's multi-day task sharing the cell is used like any other.
                    followers[5] = make_plan(5, "305", [(1, 30), (9, 300)], workorder="555")[0]
                await db.flush()
                moved_id = moved.id
                follower_ids = {t: p.id for t, p in followers.items()}
                anchor_id = moved_rows[0].id
                original_id = original.id
                target_id = target.id
            app = create_app(settings)
            app.state.sessions = sessions

            async def respond(request):
                assert request.method == "GET"
                where = request.url.params.get("oslc.where", "")
                if "assignment.laborcode=" in where:
                    return httpx.Response(200, json={"member": []})
                if "WOACTIVITYTASK" in request.url.params.get("oslc.select", ""):
                    return httpx.Response(200, json={"member": [remote_sample]})
                return httpx.Response(
                    200, json={"member": [record(bdpocdiscipline="MECH", status="APPR")]}
                )

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(respond)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"x-csrf-token": csrf}
                url = f"/api/resource-pools/{pool.id}/assignment-plans/{moved_id}"
                body = dict(
                    connection_id=str(connection.id),
                    discipline="MECH",
                    expected_plan_version=1,
                    anchor_allocation_id=str(anchor_id),
                    target_person_id=str(target_id),
                    target_date="2026-10-12",
                    mode="shift",
                )
                if mode == "preview_off":
                    body["backfill"] = False
                preview = await client.post(url + "/move-preview", json=body, headers=headers)
                assert preview.status_code == 200, preview.text
                proposal = preview.json()
                shown = proposal["backfill"]
                if mode == "preview_off":
                    assert shown == {"enabled": False, "plans": [], "skipped": []}
                    assert await rows_of(sessions, follower_ids[20]) == chain[0][2]
                    return
                assert shown["enabled"] is True and shown["skipped"] == []
                changing = {20, 30, 40, 50}
                if mode == "synced_follower":
                    # The synced T20 is the only task in the vacated cell and is left alone.
                    changing = set()
                elif mode == "other_wo_load":
                    changing = {5, 20, 30, 40, 50}
                by_task = {p["task_id"]: p for p in shown["plans"]}
                assert set(by_task) == changing
                if mode == "backfill":
                    for task_id, plan_view in by_task.items():
                        assert plan_view["plan_id"] == str(follower_ids[task_id])
                        assert plan_view["plan_version"] == 1
                        assert plan_view["after"] == [
                            {"date": d(n).isoformat(), "minutes": m} for n, m in EXPECTED[task_id]
                        ]
                        assert plan_view["before"] == [
                            {"date": d(n).isoformat(), "minutes": m}
                            for n, m in next(c[2] for c in chain if c[0] == task_id)
                        ]
                    assert by_task[20]["finish_before"] == "2026-10-05"
                    assert by_task[20]["finish_after"] == "2026-10-04"
                    assert by_task[50]["task_description"] == "T50"
                    # Preview never writes.
                    assert await rows_of(sessions, follower_ids[20]) == chain[0][2]
                if mode == "other_wo_load":
                    # Free on 10-01 is 570: the lower task id (5) takes its 300 first, T20 the rest.
                    assert by_task[5]["after"] == [{"date": d(1).isoformat(), "minutes": 330}]
                    assert by_task[20]["after"][0] == {"date": d(1).isoformat(), "minutes": 300}
                backfill_plans = [
                    {
                        "plan_id": p["plan_id"],
                        "expected_version": p["plan_version"],
                        "segments": p["after"],
                    }
                    for p in shown["plans"]
                ]
                commit = {
                    **body,
                    "request_id": str(uuid4()),
                    "segments": proposal["segments"],
                    "backfill_plans": backfill_plans,
                }
                if mode == "commit_without_backfill":
                    commit["backfill_plans"] = []
                if mode == "tampered":
                    commit["backfill_plans"][0]["segments"][0]["minutes"] -= 1
                if mode == "stale_follower":
                    async with sessions.begin() as db:
                        (await db.get(AssignmentPlan, follower_ids[30])).version = 2
                if mode == "rollback":
                    monkeypatch.setattr(
                        "app.assignments.plan_moves.metadata",
                        AsyncMock(side_effect=HTTPException(409, "synthetic")),
                    )
                response = await client.post(url + "/move", json=commit, headers=headers)
                if mode in {
                    "tampered",
                    "stale_follower",
                    "rollback",
                }:
                    assert response.status_code == 409, response.text
                    if mode != "rollback":
                        assert "preview" in response.text
                    for task_id, _, rows in chain:
                        assert await rows_of(sessions, follower_ids[task_id]) == rows
                    assert await rows_of(sessions, moved_id) == [(moved_day, 600)]
                    async with sessions() as db:
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentEvent)) == 0
                        )
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentSubmission))
                            == 0
                        )
                        assert (await db.get(AssignmentPlan, follower_ids[20])).version == 1
                    return
                assert response.status_code == 200, response.text
                result = response.json()
                assert result["plan_version"] == 2
                assert result["assignment_revision"] != result["previous_assignment_revision"]
                if mode in {"commit_without_backfill", "synced_follower"}:
                    assert result["backfill_items"] == [] and result["backfill_plans"] == []
                    if mode == "commit_without_backfill":
                        assert shown["plans"], "the preview offered backfill; the client declined"
                    for task_id, _, rows in chain:
                        assert await rows_of(sessions, follower_ids[task_id]) == rows
                    return
                assert {p["plan_id"] for p in result["backfill_plans"]} == {
                    str(follower_ids[t]) for t in changing
                }
                assert all(p["plan_version"] == 2 for p in result["backfill_plans"])
                assert all(i["person_id"] == str(original_id) for i in result["backfill_items"])
                if mode == "backfill":
                    for task_id, expected in EXPECTED.items():
                        assert await rows_of(sessions, follower_ids[task_id]) == expected
                assert await rows_of(sessions, moved_id) == [(12, 600)]
                # No source-person day is over capacity afterwards and totals are preserved.
                async with sessions() as db:
                    per_day = {}
                    rows = (
                        await db.scalars(
                            select(Allocation).where(
                                Allocation.state == "reserved",
                                Allocation.person_id == original_id,
                            )
                        )
                    ).unique()
                    for r in rows:
                        per_day[r.date] = per_day.get(r.date, 0) + r.minutes
                    assert max(per_day.values()) <= 630
                    if mode == "synced_follower":
                        assert await rows_of(sessions, follower_ids[20]) == chain[0][2]
                    for task_id, _assignment, rows in chain:
                        got = await rows_of(sessions, follower_ids[task_id])
                        assert sum(m for _, m in got) == sum(m for _, m in rows)
                        assert got[-1][0] <= rows[-1][0]
                    events = list(
                        await db.scalars(
                            select(AssignmentEvent).where(AssignmentEvent.event == "plan_backfill")
                        )
                    )
                    assert len(events) == len(result["backfill_items"]) > 0
                    assert all(e.details["moved_plan_id"] == str(moved_id) for e in events)
                    released = [i for i in result["backfill_items"] if i["state"] == "released"]
                    for e in events:
                        assert e.details["plan_version"] == 2
                    if mode == "backfill":
                        assert released, "T20/T30... lose their old last days"
                    assert (
                        await db.scalar(select(func.count()).select_from(AssignmentSubmission)) == 1
                    )
                # Affected days cover old and new dates of the source person.
                touched = {
                    x["date"] for x in result["affected_days"] if x["person_id"] == str(original_id)
                }
                if mode == "backfill":
                    assert {d(n).isoformat() for n in (1, 4, 5, 6, 7, 8)} <= touched
                receipt = await client.get(f"/api/assignment-submissions/{commit['request_id']}")
                assert receipt.status_code == 200, receipt.text
                assert receipt.json()["result"]["backfill_items"] == result["backfill_items"]
                if mode == "replay":
                    again = await client.post(url + "/move", json=commit, headers=headers)
                    assert again.status_code == 200, again.text
                    assert again.json()["backfill_items"] == result["backfill_items"]
                    assert again.json()["backfill_plans"] == result["backfill_plans"]
                    assert again.json()["items"] == result["items"]
                    async with sessions() as db:
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentSubmission))
                            == 1
                        )
                        assert (await db.get(AssignmentPlan, follower_ids[20])).version == 2
                    changed = {**commit, "target_date": "2026-10-13"}
                    assert (
                        await client.post(url + "/move", json=changed, headers=headers)
                    ).status_code == 409

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
