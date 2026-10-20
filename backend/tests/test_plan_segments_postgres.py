"""Independent PostgreSQL transactions and GET-only Maximo for plan day-hour edits."""

import asyncio
from copy import deepcopy
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

D1, D2, D3 = date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3)
REJECTED = {
    "same_dates_noop": 422,
    "sum_mismatch": 422,
    "duplicate_dates": 422,
    "off_day": 409,
    "missing_rota": 409,
    "over_capacity": 409,
    "foreign_load": 409,
    "stale": 409,
    "synced": 409,
    "unknown": 409,
    "csrf": 403,
    "wrong_pool": 404,
    "no_planner_permission": 404,
    "person_discipline_changed": 404,
    "rollback": 409,
}


def seg(*pairs):
    return [{"date": d.isoformat(), "minutes": m} for d, m in pairs]


@pytest.mark.parametrize(
    "mode",
    [
        "edit_add",
        "remove_day",
        "swap_uses_own_minutes",
        "same_dates_noop",
        "sum_mismatch",
        "duplicate_dates",
        "off_day",
        "missing_rota",
        "over_capacity",
        "foreign_load",
        "stale",
        "synced",
        "unknown",
        "csrf",
        "wrong_pool",
        "no_planner_permission",
        "person_discipline_changed",
        "replay",
        "rollback",
        "concurrent_same_request",
    ],
)
def test_plan_segment_edit_is_atomic_scoped_and_local(monkeypatch, mode):
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
                if mode != "no_planner_permission":
                    db.add(
                        PlannerPermission(
                            user_id=user.id, connection_id=connection.id, discipline="MECH"
                        )
                    )
                pool = ResourcePool(
                    connection_id=connection.id, label="Segments", orgid="ORG", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                data = discipline_fixture(pool)
                data["source"]["coverage_before"] = "2026-11-10"
                for row in data["source"]["rows"]:
                    row["days"] = [
                        dict(
                            date=(D1 + timedelta(days=n)).isoformat(),
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
                person = (
                    await db.scalars(
                        select(ResourcePerson)
                        .where(ResourcePerson.pool_id == pool.id)
                        .order_by(ResourcePerson.person_key)
                    )
                ).first()
                day = await db.get(PersonDayCapacity, (pool.id, person.id, D1))
                labor = day.laborcode
                plan = AssignmentPlan(
                    actor_id=user.id,
                    pool_id=pool.id,
                    connection_id=connection.id,
                    assignment_id="300",
                    person_id=person.id,
                    laborcode=labor,
                    demand_minutes=1200,
                    state="reserved",
                )
                db.add(plan)
                await db.flush()
                items = []
                for d, amount in ((D1, 630), (D3, 570)):
                    item = Allocation(
                        pool_id=pool.id,
                        person_id=person.id,
                        connection_id=connection.id,
                        site_id="TEST",
                        workorder_id="100",
                        discipline="MECH",
                        craft=day.craft,
                        role=day.role,
                        laborcode=labor,
                        date=d,
                        minutes=amount,
                        plan=plan,
                        task_workorder_id="200",
                        task_id=10,
                        assignment_id="300",
                        upstream_baseline=baseline,
                        sync_state="local",
                    )
                    db.add(item)
                    items.append(item)
                await db.flush()
                ids = {i.date: i.id for i in items}
                if mode in {"synced", "unknown"}:
                    plan.sync_state = mode
                    for i in items:
                        i.sync_state = mode
            app = create_app(settings)
            app.state.sessions = sessions
            requests = []

            async def respond(request):
                requests.append(request)
                assert request.method == "GET", "Editing a local plan must never send Maximo writes"
                where = request.url.params.get("oslc.where", "")
                if "assignment.laborcode=" in where:
                    if mode == "foreign_load":
                        return httpx.Response(
                            200,
                            json={
                                "member": [
                                    {
                                        "siteid": "OTHER",
                                        "workorderid": 999,
                                        "assignment": [
                                            {
                                                "assignmentid": 999,
                                                "laborcode": labor,
                                                "craft": "MECH",
                                                "laborhrs": 5,
                                                "scheduledate": "2026-10-02T06:30:00+07:00",
                                                "status": "ASSIGNED",
                                            }
                                        ],
                                    }
                                ]
                            },
                        )
                    return httpx.Response(200, json={"member": []})
                if "WOACTIVITYTASK" in request.url.params.get("oslc.select", ""):
                    return httpx.Response(200, json={"member": [deepcopy(remote_sample)]})
                return httpx.Response(200, json={"member": [record(bdpocdiscipline="MECH")]})

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(respond)
            )
            if mode == "person_discipline_changed":
                monkeypatch.setattr(
                    "app.assignments.plan_uploads.verified_person_scope",
                    AsyncMock(return_value=("E&I", "synthetic", False)),
                )
            if mode == "rollback":
                monkeypatch.setattr(
                    "app.assignments.plan_segments.metadata",
                    AsyncMock(side_effect=HTTPException(409, "synthetic final metadata failure")),
                )

            async def snapshot():
                async with sessions() as db:
                    plan_row = await db.get(AssignmentPlan, plan.id)
                    rows = list(
                        (
                            await db.scalars(
                                select(Allocation)
                                .where(Allocation.plan_id == plan.id)
                                .order_by(Allocation.date)
                            )
                        ).unique()
                    )
                    return plan_row.version, [
                        (i.id, i.date, i.minutes, i.version, i.state) for i in rows
                    ]

            before = await snapshot()
            segments = {
                "remove_day": seg((D2, 630), (D3, 570)),
                "swap_uses_own_minutes": seg((D1, 570), (D3, 630)),
                "same_dates_noop": seg((D1, 630), (D3, 570)),
                "sum_mismatch": seg((D1, 630), (D3, 569)),
                "duplicate_dates": seg((D1, 630), (D1, 570)),
                "off_day": seg((D1, 630), (D2, 570)),
                "missing_rota": seg((D1, 630), (D2, 570)),
                "over_capacity": seg((D1, 630), (D2, 570)),
                "foreign_load": seg((D1, 600), (D2, 600)),
            }.get(mode, seg((D1, 400), (D2, 400), (D3, 400)))
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"x-csrf-token": csrf}
                if mode in {"off_day", "missing_rota", "over_capacity"}:
                    async with sessions.begin() as db:
                        capacity_day = await db.get(PersonDayCapacity, (pool.id, person.id, D2))
                        if mode == "off_day":
                            capacity_day.code = "O"
                        elif mode == "over_capacity":
                            capacity_day.capacity_hours = 5
                        else:
                            await db.delete(capacity_day)
                body = dict(
                    request_id=str(uuid4()),
                    expected_version=2 if mode == "stale" else 1,
                    segments=segments,
                )
                pool_id = uuid4() if mode == "wrong_pool" else pool.id
                url = f"/api/resource-pools/{pool_id}/assignment-plans/{plan.id}/segments"
                if mode == "concurrent_same_request":
                    responses = await asyncio.gather(
                        *[client.post(url, json=body, headers=headers) for _ in range(2)]
                    )
                    assert [r.status_code for r in responses] == [200, 200], [
                        r.text for r in responses
                    ]
                    assert {r.json()["plan_version"] for r in responses} == {2}
                    response = responses[0]
                else:
                    response = await client.post(
                        url, json=body, headers={} if mode == "csrf" else headers
                    )
                if mode in REJECTED:
                    assert response.status_code == REJECTED[mode], response.text
                    assert await snapshot() == before
                    async with sessions() as db:
                        for model in (AssignmentEvent, AssignmentSubmission):
                            assert await db.scalar(select(func.count()).select_from(model)) == 0
                    return
                assert response.status_code == 200, response.text
                result = response.json()
                assert result["plan_id"] == str(plan.id) and result["plan_version"] == 2
                assert result["plan_total_minutes"] == 1200
                assert result["assignment_revision"] != result["previous_assignment_revision"]
                assert {d["date"] for d in result["affected_days"]} >= {s["date"] for s in segments}
                after_version, rows = await snapshot()
                active = {r[1]: r for r in rows if r[4] == "reserved"}
                assert after_version == 2
                assert {d.isoformat(): r[2] for d, r in active.items()} == {
                    s["date"]: s["minutes"] for s in segments
                }
                for d, row_id in ids.items():
                    if d in active:
                        assert active[d][0] == row_id, "dates keep their row identity"
                if mode == "edit_add":
                    assert active[D1][3] == 2 and active[D3][3] == 2 and active[D2][3] == 1
                    assert {i["date"] for i in result["items"]} == {
                        D1.isoformat(),
                        D2.isoformat(),
                        D3.isoformat(),
                    }
                if mode == "remove_day":
                    released = [r for r in rows if r[4] == "released"]
                    assert [(r[0], r[3]) for r in released] == [(ids[D1], 2)]
                    assert active[D3][3] == 1 and active[D2][3] == 1
                async with sessions() as db:
                    events = list(await db.scalars(select(AssignmentEvent)))
                    assert len(events) == len(result["items"])
                    assert all(e.actor_id == user.id and e.event == "plan_segments" for e in events)
                    submissions = await db.scalar(
                        select(func.count()).select_from(AssignmentSubmission)
                    )
                    assert submissions == 1
                assert all(r.method == "GET" for r in requests)
                receipt = await client.get(f"/api/assignment-submissions/{body['request_id']}")
                assert receipt.status_code == 200, receipt.text
                if mode == "replay":
                    repeated = await client.post(url, json=body, headers=headers)
                    assert repeated.status_code == 200, repeated.text
                    assert repeated.json()["items"] == result["items"]
                    assert repeated.json()["plan_version"] == 2
                    assert await snapshot() == (after_version, rows)
                    different = {**body, "segments": seg((D1, 600), (D2, 600))}
                    assert (
                        await client.post(url, json=different, headers=headers)
                    ).status_code == 409
                    stale = {**body, "request_id": str(uuid4())}
                    assert (await client.post(url, json=stale, headers=headers)).status_code == 409

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
