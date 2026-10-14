import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import date
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from test_assignments_postgres import current_receipt, discipline_fixture
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import database, seed
from test_task_assignments import sample

from app.assignments.models import Allocation, AssignmentPlan
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, Base, MaximoConnection
from app.main import create_app
from app.rota.activation import materialize, proposed_days
from app.rota.models import (
    PersonDayCapacity,
    ResourcePerson,
    ResourcePool,
    ResourcePoolGrant,
    ResourcePoolState,
    RotaImport,
)

pytestmark = pytest.mark.integration


@asynccontextmanager
async def concurrent_plan_database():
    """Real independent transactions in an owned schema; the usual fixture shares a connection."""
    settings = integration_settings()
    schema = "plan_test_" + uuid4().hex
    engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    scoped = engine.execution_options(schema_translate_map={None: schema})
    try:
        async with engine.begin() as db:
            await db.execute(text(f'CREATE SCHEMA "{schema}"'))
        async with scoped.begin() as db:
            await db.run_sync(Base.metadata.create_all)
        yield async_sessionmaker(scoped, expire_on_commit=False)
    finally:
        assert schema.startswith("plan_test_") and len(schema) == 42
        async with engine.begin() as db:
            await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()


@pytest.mark.parametrize(
    "mode",
    [
        "batch_normal",
        "batch_aggregate",
        "batch_foreign_load",
        "batch_lower_capacity",
        "batch_pool_revoke",
        "batch_wo_revoke",
        "batch_source_reassigned_during_load",
        "batch_wo_closed_during_load",
        "batch_missing_source",
        "normal",
        "cross_month",
        "off",
        "foreign_load",
        "lower_capacity",
        "pool_revoke",
        "wo_revoke",
        "source_reassigned_during_load",
        "wo_closed_during_load",
        "concurrent_duplicate",
        "concurrent_source",
    ],
)
def test_local_plan_atomic_capacity_edit_release_and_source_ownership(monkeypatch, mode):
    batch_mode = mode.startswith("batch_")
    mode = mode.removeprefix("batch_") if batch_mode else mode
    for module in ["app.scheduling.routes", "app.assignments.routes", "app.rota.activation_routes"]:
        monkeypatch.setattr(module + ".sync_person_access", AsyncMock())

    async def scenario():
        context = concurrent_plan_database if mode.startswith("concurrent_") else database
        async with context() as sessions:
            user, _, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {
                connections[0].id: config(task_load_contract="bdsched_assignment_test")
            }
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
                pool = ResourcePool(
                    connection_id=connection.id, label="Plan test", orgid="ORG", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                data = discipline_fixture(pool)
                data["source"]["coverage_before"] = (
                    "2026-11-02" if mode == "cross_month" else "2026-10-05"
                )
                for row in data["source"]["rows"]:
                    row["days"].extend(
                        [
                            {"date": "2026-10-03", "code": "1", "capacity_hours": 10.5},
                            {"date": "2026-10-04", "code": "1", "capacity_hours": 10.5},
                        ]
                    )
                    if mode == "cross_month":
                        row["days"].extend(
                            [
                                {"date": f"2026-10-{day:02d}", "code": "", "capacity_hours": 0}
                                for day in range(5, 31)
                            ]
                        )
                        row["days"].extend(
                            [
                                {"date": "2026-10-31", "code": "1", "capacity_hours": 10.5},
                                {"date": "2026-11-01", "code": "1", "capacity_hours": 10.5},
                            ]
                        )
                stage = RotaImport(
                    pool_id=pool.id,
                    actor_id=user.id,
                    version=2,
                    file_name="fixture.ods",
                    sheet="ROTA_2026",
                    **data,
                )
                state = ResourcePoolState(pool_id=pool.id, version=0)
                db.add_all([stage, state])
                await db.flush()
                proposed, errors = proposed_days(stage, pool)
                assert not errors
                from types import SimpleNamespace

                await materialize(
                    db, stage, pool, state, SimpleNamespace(user_id=user.id), proposed
                )
                person = await db.scalar(
                    select(ResourcePerson).where(
                        ResourcePerson.pool_id == pool.id, ResourcePerson.person_key == "P0"
                    )
                )
                if mode == "lower_capacity":
                    day = await db.get(PersonDayCapacity, (pool.id, person.id, date(2026, 10, 3)))
                    day.capacity_hours = 5
            app = create_app(settings)
            app.state.sessions = sessions
            source_changed = False
            order_closed = False
            requests = []

            async def respond(request):
                nonlocal source_changed, order_closed
                requests.append(request)
                assert request.method == "GET", "Local plans must never write Maximo"
                where = request.url.params.get("oslc.where", "")
                if "assignment.laborcode=" in where:
                    if mode == "source_reassigned_during_load":
                        source_changed = True
                    if mode == "wo_closed_during_load":
                        order_closed = True
                    if mode in {"pool_revoke", "wo_revoke"}:
                        async with sessions.begin() as db:
                            table = ResourcePoolGrant if mode == "pool_revoke" else AccessGrant
                            await db.execute(delete(table).where(table.user_id == user.id))
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
                                                "laborcode": "L0",
                                                "craft": "E&I",
                                                "scheduledate": "2026-10-03T06:00:00+07:00",
                                                "laborhrs": 9,
                                                "status": "ASSIGNED",
                                            }
                                        ],
                                    }
                                ]
                            },
                        )
                    return httpx.Response(200, json={"member": []})
                if "WOACTIVITYTASK" in request.url.params.get("oslc.select", ""):
                    data = sample()
                    if batch_mode:
                        second_task = deepcopy(data["woactivitytask"][0])
                        second_task.update(workorderid=201, taskid=20)
                        second_task["showassignment"][0].update(assignmentid=301, taskid=20)
                        data["woactivitytask"].append(second_task)
                        data["assignment"].append({"assignmentid": 301, "_rowstamp": "124"})
                    if source_changed:
                        data["woactivitytask"][0]["showassignment"][0]["laborcode"] = "OTHER"
                    return httpx.Response(200, json={"member": [data]})
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            record(
                                bdpocdiscipline="MECH", status="COMP" if order_closed else "APPR"
                            )
                        ]
                    },
                )

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(respond)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"x-csrf-token": csrf}
                common = dict(
                    connection_id=str(connection.id),
                    site_id="TEST",
                    workorder_id="100",
                    discipline="MECH",
                    person_id=str(person.id),
                )
                body = {
                    **common,
                    "task_workorder_id": "200",
                    "task_id": 10,
                    "assignment_id": "300",
                    "total_minutes": 1200,
                    "request_id": str(uuid4()),
                    "segments": [
                        {"date": "2026-10-01", "minutes": 630},
                        {"date": "2026-10-02" if mode == "off" else "2026-10-03", "minutes": 570},
                    ],
                }
                url = f"/api/resource-pools/{pool.id}/task-plans"
                if batch_mode:
                    url = f"/api/resource-pools/{pool.id}/task-plan-batches"
                    body = {
                        **common,
                        "request_id": str(uuid4()),
                        "tasks": [
                            {
                                "task_workorder_id": "200",
                                "task_id": 10,
                                "assignment_id": "300",
                                "total_minutes": 600,
                                "segments": [{"date": "2026-10-01", "minutes": 600}],
                            },
                            {
                                "task_workorder_id": "201",
                                "task_id": 20,
                                "assignment_id": "301",
                                "total_minutes": 600,
                                "segments": [
                                    {"date": "2026-10-01", "minutes": 30},
                                    {"date": "2026-10-03", "minutes": 570},
                                ],
                            },
                        ],
                    }
                    if mode == "aggregate":
                        body["tasks"][1]["segments"] = [{"date": "2026-10-01", "minutes": 600}]
                    if mode == "missing_source":
                        body["tasks"][1]["assignment_id"] = "999"
                    assert (await client.post(url, json=body)).status_code == 403
                    created = await client.post(url, json=body, headers=headers)
                    if mode != "normal":
                        assert created.status_code in {403, 404, 409}, created.text
                        async with sessions() as db:
                            for table in [Allocation, AssignmentPlan]:
                                assert await db.scalar(select(func.count()).select_from(table)) == 0
                        return
                    assert created.status_code == 200, created.text
                    result = created.json()
                    assert len(result["plans"]) == 2
                    assert [p["assignment_id"] for p in result["plans"]] == ["300", "301"]
                    assert [len(p["items"]) for p in result["plans"]] == [1, 2]
                    assert (
                        await client.post(url, json=body, headers=headers)
                    ).json() == current_receipt(result)
                    assert (
                        await client.get(f"/api/assignment-submissions/{body['request_id']}")
                    ).json() == {"result": current_receipt(result)}
                    changed = deepcopy(body)
                    changed["tasks"][0]["segments"][0]["date"] = "2026-10-04"
                    assert (
                        await client.post(url, json=changed, headers=headers)
                    ).status_code == 409
                    assert (
                        await client.post(
                            url, json={**body, "request_id": str(uuid4())}, headers=headers
                        )
                    ).status_code == 409
                    async with sessions() as db:
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentPlan)) == 2
                        )
                        assert await db.scalar(select(func.count()).select_from(Allocation)) == 3
                    # Recovery is scoped to current authority, not an unguarded cached receipt.
                    async with sessions.begin() as db:
                        await db.execute(
                            delete(ResourcePoolGrant).where(ResourcePoolGrant.user_id == user.id)
                        )
                    assert (
                        await client.get(f"/api/assignment-submissions/{body['request_id']}")
                    ).status_code == 404
                    return
                if mode == "cross_month":
                    body["segments"] = [
                        {"date": "2026-10-31", "minutes": 630},
                        {"date": "2026-11-01", "minutes": 570},
                    ]
                assert (await client.post(url, json=body)).status_code == 403
                if mode in {"concurrent_duplicate", "concurrent_source"}:
                    competing = (
                        body
                        if mode == "concurrent_duplicate"
                        else {**body, "request_id": str(uuid4())}
                    )
                    responses = await asyncio.wait_for(
                        asyncio.gather(
                            client.post(url, json=body, headers=headers),
                            client.post(url, json=competing, headers=headers),
                        ),
                        timeout=20,
                    )
                    if mode == "concurrent_duplicate":
                        assert [r.status_code for r in responses] == [200, 200]
                        assert current_receipt(responses[0].json()) == current_receipt(
                            responses[1].json()
                        )
                        created = responses[0]
                    else:
                        assert sorted(r.status_code for r in responses) == [200, 409]
                        index = next(i for i, r in enumerate(responses) if r.status_code == 200)
                        created = responses[index]
                        body = [body, competing][index]
                    async with sessions() as db:
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentPlan)) == 1
                        )
                        assert await db.scalar(select(func.count()).select_from(Allocation)) == 2
                else:
                    created = await client.post(url, json=body, headers=headers)
                if mode not in {
                    "normal",
                    "cross_month",
                    "concurrent_duplicate",
                    "concurrent_source",
                }:
                    assert created.status_code in {403, 404, 409}, created.text
                    async with sessions() as db:
                        assert await db.scalar(select(func.count()).select_from(Allocation)) == 0
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentPlan)) == 0
                        )
                    return
                assert created.status_code == 200, created.text
                result = created.json()
                assert len(result["items"]) == 2
                assert len(result["allocation_updates"]) == 2
                assert result["previous_assignment_revision"] != result["assignment_revision"]
                assert result["work_order"]["workorder_id"] == "100"
                assert result["work_order"]["eligible"] is True
                assert sorted(d["allocated_minutes"] for d in result["affected_days"]) == [570, 630]
                assert all(d["load_complete"] for d in result["affected_days"])
                revision_url = f"/api/resource-pools/{pool.id}/assignment-revision"
                revision_params = {"connection_id": str(connection.id), "discipline": "MECH"}
                revision_response = await client.get(revision_url, params=revision_params)
                assert revision_response.status_code == 200, revision_response.text
                assert revision_response.json()["revision"] == result["assignment_revision"]
                assert (
                    await client.get(revision_url, params={**revision_params, "discipline": "E&I"})
                ).status_code == 404
                assert all(
                    x["plan_id"] == result["plan_id"] and x["plan_total_minutes"] == 1200
                    for x in result["items"]
                )
                assert (
                    await client.post(url, json=body, headers=headers)
                ).json() == current_receipt(result)
                assert (
                    await client.get(f"/api/assignment-submissions/{body['request_id']}")
                ).json() == {"result": current_receipt(result)}
                assert (
                    await client.post(
                        url, json={**body, "request_id": str(uuid4())}, headers=headers
                    )
                ).status_code == 409
                single = {
                    **common,
                    "date": "2026-10-04",
                    "request_id": str(uuid4()),
                    "tasks": [
                        {
                            "task_workorder_id": "200",
                            "task_id": 10,
                            "assignment_id": "300",
                            "minutes": 60,
                        }
                    ],
                }
                single_url = f"/api/resource-pools/{pool.id}/task-allocations"
                assert (
                    await client.post(single_url, json=single, headers=headers)
                ).status_code == 409
                # A different pool sharing labor affects this pool's global budget.
                async with sessions.begin() as db:
                    other_pool = ResourcePool(
                        connection_id=connection.id, label="Other pool", orgid="ORG", enabled=True
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
                            role="TECHNICIAN",
                            laborcode="L0",
                            date=date(2026, 10, 30),
                            minutes=1,
                            state="reserved",
                        )
                    )
                other_revision = (await client.get(revision_url, params=revision_params)).json()[
                    "revision"
                ]
                assert other_revision != result["assignment_revision"]
                async with sessions.begin() as db:
                    db.add(
                        Allocation(
                            pool_id=other_pool.id,
                            person_id=other_person.id,
                            connection_id=connection.id,
                            site_id="OTHER",
                            workorder_id="998",
                            discipline="E&I",
                            craft="E&I",
                            role="TECHNICIAN",
                            laborcode="L0",
                            date=date(2026, 10, 30),
                            minutes=1,
                            state="reserved",
                        )
                    )
                assert (await client.get(revision_url, params=revision_params)).json()[
                    "revision"
                ] == other_revision
                first, second = result["items"]

                async def edit(item, **changes):
                    return await client.patch(
                        f"/api/assignments/{item['id']}",
                        headers=headers,
                        json={
                            **common,
                            "date": item["date"],
                            "minutes": item["minutes"],
                            "version": item["version"],
                            "request_id": str(uuid4()),
                            **changes,
                        },
                    )

                assert (await edit(first, date=second["date"])).status_code == 409
                assert (await edit(first, person_id=str(uuid4()))).status_code == 422
                first = (await edit(first, minutes=600, date="2026-10-04")).json()
                assert first["plan_id"] == result["plan_id"]
                assert len(first["affected_days"]) == 2
                replay = await client.post(url, json=body, headers=headers)
                assert replay.status_code == 200, replay.text
                replay_result = replay.json()
                assert replay_result["items"] == result["items"]
                updates = {x["id"]: x for x in replay_result["allocation_updates"]}
                assert updates[first["id"]]["version"] == first["version"]
                assert updates[first["id"]]["date"] == "2026-10-04"
                assert replay_result["assignment_revision"] != result["assignment_revision"]
                refreshed_cells = {d["date"]: d for d in replay_result["affected_days"]}
                assert refreshed_cells[result["items"][0]["date"]]["allocated_minutes"] == 0
                assert refreshed_cells["2026-10-04"]["allocated_minutes"] == 600
                order_closed = True
                closed_receipt = await client.get(
                    f"/api/assignment-submissions/{body['request_id']}"
                )
                assert closed_receipt.status_code == 200, closed_receipt.text
                closed_result = closed_receipt.json()["result"]
                assert closed_result["work_order"]["eligible"] is False
                assert closed_result["work_order"]["status"] == "COMP"
                assert closed_result["items"] == result["items"]
                assert (
                    closed_result["previous_assignment_revision"]
                    == closed_result["assignment_revision"]
                )
                order_closed = False
                assert (await edit(second, minutes=601)).status_code == 409
                second = (await edit(second, minutes=600)).json()
                source_changed = True
                assert (await edit(second, minutes=590)).status_code == 409
                for item in [first, second]:
                    denied = await client.post(
                        f"/api/assignments/{item['id']}/upload",
                        headers=headers,
                        json={
                            "version": item["version"],
                            "request_id": str(uuid4()),
                            "scheduled_start": item["date"] + "T06:30:00+07:00",
                        },
                    )
                    assert denied.status_code == 409 and "local only" in denied.text
                    released = await client.request(
                        "DELETE",
                        f"/api/assignments/{item['id']}",
                        headers=headers,
                        json={"version": item["version"], "request_id": str(uuid4())},
                    )
                    assert released.status_code == 200, released.text
                    assert released.json()["plan_id"] == result["plan_id"]
                async with sessions() as db:
                    header = await db.get(AssignmentPlan, UUID(result["plan_id"]))
                    assert header.state == "released" and header.demand_minutes == 1200
                source_changed = False
                single["request_id"] = str(uuid4())
                assert (
                    await client.post(single_url, json=single, headers=headers)
                ).status_code == 200
                assert (
                    await client.post(
                        url, json={**body, "request_id": str(uuid4())}, headers=headers
                    )
                ).status_code == 409

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
