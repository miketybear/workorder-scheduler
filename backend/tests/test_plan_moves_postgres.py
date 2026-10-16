"""Independent PostgreSQL transactions and GET-only Maximo for whole-plan relocation."""

import asyncio
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select
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
    AssignmentPlanPreview,
    AssignmentSubmission,
)
from app.assignments.plan_uploads import segment_set
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, MaximoConnection, PlannerPermission
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


@pytest.mark.parametrize(
    "mode",
    [
        "transfer",
        "single_transfer",
        "same_overlap",
        "cross_month",
        "undersubscribed",
        "reallocate",
        "reallocate_more",
        "reallocate_fewer",
        "reallocate_lazy",
        "capacity",
        "off",
        "missing_rota",
        "outside_pool",
        "wrong_discipline",
        "wrong_connection",
        "wrong_pool",
        "csrf",
        "stale",
        "synced",
        "unknown",
        "changed_source",
        "removed_source",
        "wo_moved",
        "revoked_during_load",
        "source_changed_during_load",
        "closed_during_load",
        "preview_drift",
        "duplicate",
        "concurrent_duplicate",
        "concurrent_move",
        "upload_wins",
        "old_upload_preview",
        "old_batch_preview",
        "rollback",
        "person_discipline_changed",
    ],
)
def test_whole_plan_move_is_atomic_scoped_and_local(monkeypatch, mode):
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
                db.add(
                    PlannerPermission(
                        user_id=user.id, connection_id=connection.id, discipline="MECH"
                    )
                )
                pool = ResourcePool(
                    connection_id=connection.id, label="Move test", orgid="ORG", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                data = discipline_fixture(pool)
                data["source"]["coverage_before"] = "2026-11-10"
                for row in data["source"]["rows"]:
                    row["days"] = [
                        dict(
                            date=(date(2026, 10, 1) + timedelta(days=n)).isoformat(),
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
                day = await db.get(PersonDayCapacity, (pool.id, original.id, date(2026, 10, 1)))
                total = (
                    600
                    if mode in {"single_transfer", "reallocate_lazy", "undersubscribed"}
                    else 1200
                )
                if mode == "reallocate_fewer":
                    total = 300
                plan = AssignmentPlan(
                    actor_id=user.id,
                    pool_id=pool.id,
                    connection_id=connection.id,
                    assignment_id="300",
                    person_id=original.id,
                    laborcode=day.laborcode,
                    demand_minutes=1200 if mode == "undersubscribed" else total,
                    state="reserved",
                )
                db.add(plan)
                await db.flush()
                dates = [date(2026, 10, 1), date(2026, 10, 3)]
                minutes = [min(630, total), total - min(630, total)]
                if mode in {"undersubscribed", "reallocate_fewer"}:
                    minutes = [total // 2, total // 2]
                if mode == "cross_month":
                    dates = [date(2026, 10, 30), date(2026, 11, 1)]
                items = []
                for d, amount in zip(dates, minutes, strict=True):
                    if not amount:
                        continue
                    item = Allocation(
                        pool_id=pool.id,
                        person_id=original.id,
                        connection_id=connection.id,
                        site_id="TEST",
                        workorder_id="100",
                        discipline="MECH",
                        craft=day.craft,
                        role=day.role,
                        laborcode=day.laborcode,
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
                original_ids = [i.id for i in items]
                original_snapshot = [
                    (i.id, i.date, i.minutes, i.person_id, i.version) for i in items
                ]
                if mode in {"synced", "unknown"}:
                    plan.sync_state = mode
                    for i in items:
                        i.sync_state = mode
                if mode == "reallocate_more":
                    for d in await db.scalars(
                        select(PersonDayCapacity).where(PersonDayCapacity.person_id == target.id)
                    ):
                        d.capacity_hours = 5
            app = create_app(settings)
            app.state.sessions = sessions
            flags = dict(moving=False, revoked=False, source_changed=False, closed=False)
            loads = []
            requests = []

            async def respond(request):
                requests.append(request)
                assert request.method == "GET", "Moving a local plan must never send Maximo writes"
                where = request.url.params.get("oslc.where", "")
                if "assignment.laborcode=" in where:
                    loads.append(request)
                    if flags["moving"]:
                        if mode == "revoked_during_load" and not flags["revoked"]:
                            flags["revoked"] = True
                            async with sessions.begin() as db:
                                await db.execute(
                                    delete(AccessGrant).where(AccessGrant.user_id == user.id)
                                )
                        if mode == "source_changed_during_load":
                            flags["source_changed"] = True
                        if mode == "closed_during_load":
                            flags["closed"] = True
                    if mode == "capacity" or (mode == "preview_drift" and flags.get("commit")):
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
                                                "laborcode": "L1",
                                                "craft": "MECH",
                                                "laborhrs": 10,
                                                "scheduledate": "2026-10-03T06:30:00+07:00",
                                                "status": "ASSIGNED",
                                            }
                                        ],
                                    }
                                ]
                            },
                        )
                    return httpx.Response(200, json={"member": []})
                if "WOACTIVITYTASK" in request.url.params.get("oslc.select", ""):
                    raw = deepcopy(remote_sample)
                    if mode == "removed_source":
                        raw["woactivitytask"] = []
                    if mode == "changed_source" or flags["source_changed"]:
                        raw["woactivitytask"][0]["showassignment"][0]["laborhrs"] = 19
                    return httpx.Response(200, json={"member": [raw]})
                if mode == "wo_moved":
                    return httpx.Response(200, json={"member": []})
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            record(
                                bdpocdiscipline="MECH", status="COMP" if flags["closed"] else "APPR"
                            )
                        ]
                    },
                )

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(respond)
            )
            if mode == "person_discipline_changed":
                monkeypatch.setattr(
                    "app.assignments.plan_uploads.verified_person_scope",
                    AsyncMock(return_value=("E&I", "synthetic", False)),
                )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"x-csrf-token": csrf}
                reallocate = mode.startswith("reallocate") or mode == "preview_drift"
                target_id = original.id if mode == "same_overlap" else target.id
                body = dict(
                    connection_id=str(connection.id),
                    discipline="MECH",
                    expected_plan_version=1,
                    anchor_allocation_id=str(original_ids[0]),
                    target_person_id=str(target_id),
                    target_date="2026-10-31" if mode == "cross_month" else "2026-10-03",
                    mode="reallocate" if reallocate else "shift",
                )
                url = f"/api/resource-pools/{pool.id}/assignment-plans/{plan.id}"
                if mode == "outside_pool":
                    body["target_person_id"] = str(uuid4())
                if mode == "wrong_pool":
                    url = f"/api/resource-pools/{uuid4()}/assignment-plans/{plan.id}"
                if mode == "wrong_discipline":
                    body["discipline"] = "E&I"
                if mode == "wrong_connection":
                    body["connection_id"] = str(connections[1].id)
                if mode == "stale":
                    body["expected_plan_version"] = 2
                if mode in {"off", "missing_rota"}:
                    async with sessions.begin() as db:
                        day = await db.get(
                            PersonDayCapacity, (pool.id, target.id, date(2026, 10, 3))
                        )
                        if mode == "off":
                            day.code = "O"
                        else:
                            await db.delete(day)
                old_preview = None
                if mode == "old_upload_preview":
                    async with sessions.begin() as db:
                        p = await db.get(AssignmentPlan, plan.id)
                        current = list(
                            (
                                await db.scalars(
                                    select(Allocation)
                                    .where(Allocation.plan_id == plan.id)
                                    .order_by(Allocation.date)
                                )
                            ).unique()
                        )
                        old_preview = AssignmentPlanPreview(
                            actor_id=user.id,
                            plan_id=plan.id,
                            expires_at=datetime.now(UTC) + timedelta(seconds=120),
                            intent={"segment_set": segment_set(p, current)},
                        )
                        db.add(old_preview)
                old_batch = None
                if mode == "old_batch_preview":
                    response = await client.post(
                        f"/api/resource-pools/{pool.id}/plan-upload-batches",
                        json={"month": "2026-10", "request_id": str(uuid4())},
                        headers=headers,
                    )
                    assert response.status_code == 200, response.text
                    old_batch = response.json()["batch_id"]
                flags["moving"] = True
                preview = await client.post(
                    url + "/move-preview", json=body, headers={} if mode == "csrf" else headers
                )
                rejected = mode in {
                    "capacity",
                    "off",
                    "missing_rota",
                    "outside_pool",
                    "wrong_discipline",
                    "wrong_connection",
                    "wrong_pool",
                    "csrf",
                    "stale",
                    "synced",
                    "unknown",
                    "changed_source",
                    "removed_source",
                    "wo_moved",
                    "revoked_during_load",
                    "source_changed_during_load",
                    "closed_during_load",
                    "person_discipline_changed",
                }
                if rejected:
                    expected = (
                        403
                        if mode == "csrf"
                        else 404
                        if mode
                        in {
                            "outside_pool",
                            "wrong_discipline",
                            "wrong_connection",
                            "wrong_pool",
                            "removed_source",
                            "wo_moved",
                            "revoked_during_load",
                            "person_discipline_changed",
                        }
                        else 409
                    )
                    assert preview.status_code == expected, preview.text
                    if mode in {"capacity", "off", "missing_rota"}:
                        assert preview.json()["detail"]["can_reallocate"] is True
                    async with sessions() as db:
                        assert (await db.get(AssignmentPlan, plan.id)).version == 1
                        current = list(
                            (
                                await db.scalars(
                                    select(Allocation)
                                    .where(Allocation.plan_id == plan.id)
                                    .order_by(Allocation.date)
                                )
                            ).unique()
                        )
                        assert [
                            (i.id, i.date, i.minutes, i.person_id, i.version) for i in current
                        ] == original_snapshot
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentSubmission))
                            == 0
                        )
                    return
                assert preview.status_code == 200, preview.text
                proposal = preview.json()
                assert proposal["total_minutes"] == total
                assert proposal["original_demand_minutes"] == plan.demand_minutes
                assert len(proposal["old_items"]) == len(items)
                if mode == "reallocate_lazy":
                    assert len(loads) == 2, (
                        "One31-day read_load chunk uses two complete OSLC predicates"
                    )
                if mode == "cross_month":
                    assert [s["date"] for s in proposal["segments"]] == ["2026-10-31", "2026-11-02"]
                if mode == "same_overlap":
                    assert all(d["allocated_minutes"] == 0 for d in proposal["capacity"])
                commit_body = {**body, "request_id": str(uuid4()), "segments": proposal["segments"]}
                flags["commit"] = True
                if mode == "rollback":
                    monkeypatch.setattr(
                        "app.assignments.plan_moves.metadata",
                        AsyncMock(
                            side_effect=HTTPException(409, "synthetic final metadata failure")
                        ),
                    )
                if mode == "upload_wins":
                    async with sessions.begin() as db:
                        (await db.get(AssignmentPlan, plan.id)).sync_state = "unknown"
                    response = await client.post(url + "/move", json=commit_body, headers=headers)
                    assert response.status_code == 409
                    return
                if mode.startswith("concurrent_"):
                    other = dict(commit_body)
                    if mode == "concurrent_move":
                        other["request_id"] = str(uuid4())
                    responses = await asyncio.gather(
                        *[
                            client.post(url + "/move", json=b, headers=headers)
                            for b in [commit_body, other]
                        ]
                    )
                    assert sorted(r.status_code for r in responses) == (
                        [200, 409] if mode == "concurrent_move" else [200, 200]
                    ), [r.text for r in responses]
                    response = next(r for r in responses if r.status_code == 200)
                else:
                    response = await client.post(url + "/move", json=commit_body, headers=headers)
                if mode in {"preview_drift", "rollback"}:
                    assert response.status_code == 409, response.text
                    async with sessions() as db:
                        assert (await db.get(AssignmentPlan, plan.id)).version == 1
                        current = list(
                            (
                                await db.scalars(
                                    select(Allocation)
                                    .where(Allocation.plan_id == plan.id)
                                    .order_by(Allocation.date)
                                )
                            ).unique()
                        )
                        assert [
                            (i.id, i.date, i.minutes, i.person_id, i.version) for i in current
                        ] == original_snapshot
                        assert all(i.state == "reserved" for i in current)
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentEvent)) == 0
                        )
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentSubmission))
                            == 0
                        )
                    return
                assert response.status_code == 200, response.text
                result = response.json()
                assert (
                    result["plan_version"] == 2
                    and result["assignment_revision"] != result["previous_assignment_revision"]
                )
                assert set(UUID(i["id"]) for i in result["items"]) >= set(original_ids)
                assert {i["person_id"] for i in result["items"] if i["state"] == "reserved"} == {
                    str(target_id)
                }
                async with sessions() as db:
                    updated = await db.get(AssignmentPlan, plan.id)
                    assert (
                        updated.person_id == target_id
                        and updated.demand_minutes == plan.demand_minutes
                    )
                    current = list(
                        (
                            await db.scalars(
                                select(Allocation).where(Allocation.plan_id == plan.id)
                            )
                        ).unique()
                    )
                    active = [i for i in current if i.state == "reserved"]
                    assert sum(i.minutes for i in active) == total
                    assert len({i.date for i in active}) == len(active)
                    assert {i.laborcode for i in active} == {updated.laborcode}
                    assert all(
                        i.assignment_id == "300"
                        and i.upstream_baseline == baseline
                        and i.sync_state == "local"
                        for i in active
                    )
                    assert await db.scalar(
                        select(func.count()).select_from(AssignmentEvent)
                    ) == len(current)
                    assert (
                        await db.scalar(select(func.count()).select_from(AssignmentSubmission)) == 1
                    )
                receipt = await client.get(
                    f"/api/assignment-submissions/{commit_body['request_id']}"
                )
                assert receipt.status_code == 200, receipt.text
                assert receipt.json()["result"]["items"] == result["items"]
                if mode == "duplicate":
                    repeated = await client.post(url + "/move", json=commit_body, headers=headers)
                    assert repeated.status_code == 200, repeated.text
                    changed = {**commit_body, "target_date": "2026-10-04"}
                    assert (
                        await client.post(url + "/move", json=changed, headers=headers)
                    ).status_code == 409
                if old_preview:
                    response = await client.post(
                        f"/api/assignment-plans/{plan.id}/upload",
                        json={
                            "plan_version": 1,
                            "request_id": str(uuid4()),
                            "preview_token": str(old_preview.id),
                        },
                        headers=headers,
                    )
                    assert response.status_code == 409, response.text
                if old_batch:
                    response = await client.post(
                        f"/api/plan-upload-batches/{old_batch}/prepare-next", headers=headers
                    )
                    assert response.status_code == 200, response.text
                    assert response.json()["changed_item"]["state"] == "blocked"
                    assert response.json()["changed_item"]["reason"] == "proposal_changed"

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
