import asyncio
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select, text
from test_assignment_plans_postgres import concurrent_plan_database
from test_assignments_postgres import discipline_fixture
from test_daily_plan_sender import confirmed_target, fixture
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import seed

from app.assignments.load import load_lock
from app.assignments.models import (
    Allocation,
    AssignmentPlan,
    AssignmentPlanPreview,
    AssignmentPlanUpload,
)
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import MaximoConnection, PlannerPermission, User
from app.main import create_app
from app.maximo.tasks import Task, TaskAssignment
from app.rota.activation import materialize, proposed_days
from app.rota.activation_routes import pool_lock
from app.rota.models import (
    ResourcePerson,
    ResourcePool,
    ResourcePoolGrant,
    ResourcePoolState,
    RotaImport,
)

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "mode",
    [
        "confirmed",
        "timeout",
        "partial",
        "failed_unchanged",
        "failed_partial",
        "conflict",
        "duplicate",
        "concurrent_duplicate",
        "preview_changed",
        "preview_expired",
        "rota_revoke",
        "planner_revoke",
        "wo_moved",
        "disabled",
        "reconcile_revoke",
        "cancel",
        "deadline",
        "revoke_after_intent",
        "other_pool_capacity",
        "lock_order",
        "registry_environment",
        "registry_timezone",
        "registry_after_intent",
        "person_moved_before_send",
        "changed_segment",
        "revoke_during_load",
        "remote_capacity",
    ],
)
def test_daily_plan_durable_routes(monkeypatch, mode):
    monkeypatch.setattr("app.scheduling.routes.sync_person_access", AsyncMock())
    monkeypatch.setattr("app.assignments.routes.sync_person_access", AsyncMock())
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
                connections[0].id: config(
                    collection_url="https://maximo.invalid/maximo/oslc/os/BDSCHED_WO",
                    task_load_contract="bdsched_assignment_test",
                    assignment_write_contract="native_assignment_rowstamp_test",
                    assignment_daily_write_contract=None
                    if mode == "disabled"
                    else "native_daily_assignment_rowstamp_test",
                )
            }
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
                    connection_id=connection.id, label="Daily test", orgid="ORG", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                data = discipline_fixture(pool)
                data["source"]["coverage_before"] = "2026-10-05"
                for r in data["source"]["rows"]:
                    r["days"].extend(
                        [
                            {"date": "2026-10-03", "code": "1", "capacity_hours": 10.5},
                            {"date": "2026-10-04", "code": "1", "capacity_hours": 10.5},
                        ]
                    )
                stage = RotaImport(
                    pool_id=pool.id,
                    actor_id=user.id,
                    version=2,
                    file_name="test.ods",
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
                person = await db.scalar(
                    select(ResourcePerson).where(
                        ResourcePerson.pool_id == pool.id, ResourcePerson.person_key == "P0"
                    )
                )
                plan = AssignmentPlan(
                    actor_id=user.id,
                    pool_id=pool.id,
                    connection_id=connection.id,
                    assignment_id="1",
                    person_id=person.id,
                    laborcode="L0",
                    demand_minutes=300,
                    state="reserved",
                )
                db.add(plan)
                await db.flush()
                items = []
                for day in [date(2026, 10, 3), date(2026, 10, 4)]:
                    item = Allocation(
                        pool_id=pool.id,
                        plan=plan,
                        person_id=person.id,
                        connection_id=connection.id,
                        site_id="TEST",
                        workorder_id="100",
                        discipline="MECH",
                        craft="MECH",
                        role="TECH",
                        laborcode="L0",
                        date=day,
                        minutes=150,
                        task_workorder_id="200",
                        task_id=10,
                        assignment_id="1",
                        upstream_baseline={"revision": "10"},
                    )
                    db.add(item)
                    items.append(item)
                await db.flush()
            if mode == "deadline":
                settings.read_draft_request_timeout_seconds = 1
            if mode == "other_pool_capacity":
                async with sessions.begin() as db:
                    other_pool = ResourcePool(
                        connection_id=connection.id, label="Other", orgid="ORG", enabled=True
                    )
                    db.add(other_pool)
                    await db.flush()
                    other_person = ResourcePerson(pool_id=other_pool.id, person_key="OTHER")
                    db.add(other_person)
                    await db.flush()
                    db.add(
                        Allocation(
                            pool_id=other_pool.id,
                            person_id=other_person.id,
                            connection_id=connection.id,
                            site_id="OTHER",
                            workorder_id="999",
                            discipline="MECH",
                            craft="MECH",
                            role="TECH",
                            laborcode="L0",
                            date=date(2026, 10, 3),
                            minutes=600,
                        )
                    )
            app = create_app(settings)
            app.state.sessions = sessions
            baseline, _ = fixture()
            remote = deepcopy(baseline)
            for row in remote["assignments"]:
                row["craft"] = "MECH"
            remote["assignment"] = remote["assignments"][0]
            writes = []
            cancel_entered = asyncio.Event()
            network_pause = asyncio.Event()

            async def target(*args):
                return deepcopy(remote)

            task = Task(
                task_workorder_id="200",
                task_id=10,
                description="Task",
                planned_labor=[],
                assignments=[
                    TaskAssignment(
                        assignment_id="1",
                        task_id=10,
                        craft="MECH",
                        labor_hours=5,
                        status="WAITASGN",
                        revision="10",
                    )
                ],
            )
            monkeypatch.setattr(
                "app.assignments.plan_uploads.read_tasks", AsyncMock(return_value=[task])
            )
            monkeypatch.setattr("app.assignments.plan_uploads.read_daily_target", target)
            if mode == "person_moved_before_send":
                monkeypatch.setattr(
                    "app.assignments.plan_uploads.verified_person_scope",
                    AsyncMock(return_value=("OTHER", "synthetic", False)),
                )
            load_calls = 0

            async def loads(*args):
                nonlocal load_calls
                load_calls += 1
                if mode == "revoke_during_load" and load_calls > 1:
                    async with sessions.begin() as db:
                        await db.execute(delete(PlannerPermission))
                if mode in {"registry_environment", "registry_timezone"} and load_calls > 1:
                    async with sessions.begin() as db:
                        fresh = await db.get(MaximoConnection, connection.id)
                        if mode == "registry_environment":
                            fresh.environment = "production"
                        else:
                            fresh.timezone = "UTC"
                if mode == "remote_capacity" and load_calls > 1:
                    return {"999": {"laborcode": "L0", "date": date(2026, 10, 3), "minutes": 600}}
                return {}

            monkeypatch.setattr("app.assignments.plan_uploads.read_load", loads)

            async def transport(request):
                nonlocal remote
                if request.method == "GET" and mode == "registry_after_intent":
                    async with sessions.begin() as db:
                        attempt = await db.scalar(select(AssignmentPlanUpload))
                        if attempt:
                            (await db.get(MaximoConnection, connection.id)).timezone = "UTC"
                if request.method == "POST":
                    writes.append(request)
                    async with sessions() as db:
                        attempt = await db.scalar(select(AssignmentPlanUpload))
                        assert attempt.state == "unknown"
                        rows = list((await db.scalars(select(Allocation))).unique())
                        assert all(x.sync_state == "unknown" for x in rows)
                    if mode == "revoke_after_intent":
                        async with sessions.begin() as db:
                            await db.execute(delete(PlannerPermission))
                    if mode in {"cancel", "deadline"}:
                        cancel_entered.set()
                        await network_pause.wait()
                    if mode not in {"failed_unchanged", "conflict"}:
                        remote = confirmed_target(remote)
                        for row in remote["assignments"]:
                            if row["status"] == "ASSIGNED":
                                row["laborcode"] = "L0"
                        remote["assignment"] = remote["assignments"][0]
                        if mode in {"partial", "failed_partial", "reconcile_revoke"}:
                            remote["assignments"].pop()
                    if mode == "changed_segment":
                        async with sessions.begin() as db:
                            (await db.get(Allocation, items[1].id)).version += 1
                    if mode == "timeout":
                        raise httpx.ReadTimeout("Synthetic response lost")
                    if mode.startswith("failed"):
                        return httpx.Response(403)
                    if mode == "conflict":
                        return httpx.Response(412)
                    return httpx.Response(204)
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            record(bdpocdiscipline="OTHER" if mode == "wo_moved" else "MECH")
                        ]
                    },
                )

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(transport)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://test.example",
                cookies={SESSION_COOKIE: token},
            ) as client:
                headers = {"X-CSRF-Token": csrf}
                base = f"/api/assignment-plans/{plan.id}"
                client.cookies.clear()
                assert (await client.get(base + "/upload-preview")).status_code == 401
                assert (
                    await client.get(f"/api/assignment-plans/{uuid4()}/upload-preview")
                ).status_code == 401
                client.cookies.set(SESSION_COOKIE, token)
                if mode == "lock_order":
                    from app.assignments import plan_uploads

                    preflight_request = SimpleNamespace(
                        app=app,
                        cookies={SESSION_COOKIE: token},
                        headers=headers,
                        state=SimpleNamespace(),
                    )
                    scoped = await plan_uploads.scoped_plan(
                        preflight_request, plan.id, write=True, eligible=True
                    )

                    async def cached_preflight(request, *args, **kwargs):
                        request.state.daily_connection_revisions = (
                            preflight_request.state.daily_connection_revisions
                        )
                        return scoped

                    # Freeze only the already-authorized preflight at the race window.
                    monkeypatch.setattr(plan_uploads, "scoped_plan", cached_preflight)
                    original_recheck = plan_uploads.recheck
                    entering = asyncio.Event()

                    async def hook(*args, **kwargs):
                        entering.set()
                        return await original_recheck(*args, **kwargs)

                    monkeypatch.setattr(plan_uploads, "recheck", hook)
                    async with sessions() as holder:
                        async with holder.begin():
                            await holder.scalar(
                                select(User.id).where(User.id == user.id).with_for_update()
                            )
                            pending = asyncio.create_task(client.get(base + "/upload-preview"))
                            await asyncio.wait_for(entering.wait(), 3)
                            # Same order as existing local edit: User is already held before pool.
                            await asyncio.wait_for(pool_lock(holder, pool.id, True), 3)
                            await load_lock(holder, connection.id)
                    assert (await asyncio.wait_for(pending, 5)).status_code == 200
                    assert not writes
                    return
                p = await client.get(base + "/upload-preview")
                assert p.headers["Cache-Control"] == "no-store"
                if mode in {"disabled", "wo_moved", "other_pool_capacity"}:
                    assert p.status_code in {409, 404, 502}
                    assert not writes
                    return
                assert p.status_code == 200, p.text
                body = {
                    "request_id": str(uuid4()),
                    "plan_version": p.json()["plan_version"],
                    "preview_token": p.json()["preview_token"],
                }
                if mode in {"preview_changed", "preview_expired", "planner_revoke", "rota_revoke"}:
                    async with sessions.begin() as db:
                        if mode == "preview_changed":
                            (await db.get(Allocation, items[0].id)).version += 1
                        if mode == "preview_expired":
                            (
                                await db.get(AssignmentPlanPreview, body["preview_token"])
                            ).expires_at = datetime.now(UTC) - timedelta(seconds=1)
                        if mode == "planner_revoke":
                            await db.execute(delete(PlannerPermission))
                        if mode == "rota_revoke":
                            (await db.get(ResourcePool, pool.id)).enabled = False
                if mode in {"cancel", "deadline"}:
                    running = asyncio.create_task(
                        client.post(base + "/upload", json=body, headers=headers)
                    )
                    await asyncio.wait_for(cancel_entered.wait(), 5)
                    if mode == "cancel":
                        running.cancel()
                        with pytest.raises(asyncio.CancelledError):
                            await running
                    else:
                        assert (await running).status_code == 504
                    async with sessions() as db:
                        assert (await db.get(AssignmentPlan, plan.id)).sync_state == "unknown"
                        assert await db.scalar(
                            text("SELECT pg_try_advisory_lock(hashtextextended(:key,0))"),
                            {"key": "assignment-load:" + str(connection.id)},
                        )
                        await db.execute(
                            text("SELECT pg_advisory_unlock(hashtextextended(:key,0))"),
                            {"key": "assignment-load:" + str(connection.id)},
                        )
                    status = await client.get(base + "/upload-status")
                    assert status.status_code == 200 and status.json()["state"] == "unknown"
                    assert len(writes) == 1
                    return
                if mode == "concurrent_duplicate":
                    responses = await asyncio.gather(
                        *[
                            client.post(base + "/upload", json=body, headers=headers)
                            for _ in range(2)
                        ]
                    )
                    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
                    response = responses[0]
                else:
                    response = await client.post(base + "/upload", json=body, headers=headers)
                if mode in {"preview_changed", "preview_expired", "planner_revoke", "rota_revoke"}:
                    assert response.status_code in {404, 409}
                    assert response.json()["detail"]["outcome"] == "not_sent"
                    assert not writes
                    return
                if mode in {
                    "changed_segment",
                    "revoke_during_load",
                    "remote_capacity",
                    "revoke_after_intent",
                    "registry_environment",
                    "registry_timezone",
                    "registry_after_intent",
                    "person_moved_before_send",
                }:
                    assert response.status_code in {404, 409}, response.text
                    assert len(writes) == (
                        1 if mode in {"changed_segment", "revoke_after_intent"} else 0
                    )
                    if mode in {
                        "changed_segment",
                        "revoke_after_intent",
                        "registry_after_intent",
                        "person_moved_before_send",
                    }:
                        assert not isinstance(response.json()["detail"], dict)
                        async with sessions() as db:
                            assert (await db.get(AssignmentPlan, plan.id)).sync_state == "unknown"
                            assert (await db.scalar(select(AssignmentPlanUpload))).mapping is None
                    return
                assert response.status_code == 200, response.text
                state = response.json()["state"]
                assert state == (
                    "unknown"
                    if mode in {"partial", "failed_partial", "reconcile_revoke"}
                    else "failed"
                    if mode == "failed_unchanged"
                    else "conflict"
                    if mode == "conflict"
                    else "confirmed"
                )
                if mode == "duplicate":
                    assert (await client.post(base + "/upload", json=body, headers=headers)).json()[
                        "attempt_id"
                    ] == response.json()["attempt_id"]
                if mode in {"partial", "failed_partial", "reconcile_revoke"}:
                    if mode == "reconcile_revoke":
                        async with sessions.begin() as db:
                            await db.execute(delete(PlannerPermission))
                    r = await client.post(
                        "/api/assignment-plan-uploads/"
                        + response.json()["attempt_id"]
                        + "/reconcile",
                        headers=headers,
                    )
                    if mode == "reconcile_revoke":
                        assert r.status_code == 404
                    else:
                        assert r.status_code == 200 and r.json()["state"] == "unknown"
                receipt = await client.get(
                    "/api/assignment-plan-upload-submissions/" + body["request_id"]
                )
                assert receipt.status_code == 200
                assert receipt.headers["Cache-Control"] == "no-store"
                async with sessions() as db:
                    rows = list((await db.scalars(select(Allocation))).unique())
                    assert {r.assignment_id for r in rows} == {"1"}
                    if state == "confirmed":
                        assert {r.remote_assignment_id for r in rows} == {"1", "3"} and all(
                            r.sync_state == "synced" for r in rows
                        )
                    if state == "unknown":
                        assert all(r.sync_state == "unknown" for r in rows)
                assert len(writes) == 1

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
