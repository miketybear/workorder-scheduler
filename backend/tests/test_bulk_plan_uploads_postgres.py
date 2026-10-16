import asyncio
import json
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from test_assignment_plans_postgres import concurrent_plan_database
from test_assignments_postgres import discipline_fixture
from test_daily_plan_sender import PROTECTED
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import seed

from app.assignments.models import (
    Allocation,
    AssignmentPlan,
    AssignmentPlanUploadBatch,
    AssignmentPlanUploadBatchItem,
)
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, MaximoConnection, PlannerPermission
from app.main import create_app
from app.maximo.reader import MaximoReadError
from app.maximo.tasks import Task, TaskAssignment
from app.rota.activation import materialize, proposed_days
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
        "normal",
        "duplicate",
        "concurrent_continue",
        "many",
        "moved",
        "expired",
        "changed",
        "failed",
        "unknown",
        "claimed",
        "disabled",
        "legacy",
        "locked",
        "uuid_scope",
        "other_actor",
        "csrf",
        "revoked",
        "deadline",
        "limit",
        "capacity",
        "external_source",
        "database_preflight",
        "database_after_send",
    ],
)
def test_month_bulk_discovery_and_safe_steps(monkeypatch, mode):
    for module in [
        "app.scheduling.routes",
        "app.assignments.routes",
        "app.assignments.bulk_uploads",
    ]:
        monkeypatch.setattr(module + ".sync_person_access", AsyncMock())
    monkeypatch.setattr(
        "app.assignments.plan_uploads.verified_person_scope",
        AsyncMock(return_value=("MECH", "synthetic", False)),
    )

    async def scenario():
        async with concurrent_plan_database() as sessions:
            user, other, connections = await seed(sessions)
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
            quantity = 21 if mode == "many" else 2
            plans = []
            source_rows = []
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
                other_token, _ = await issue_session(db, other)
                db.add(
                    PlannerPermission(
                        user_id=user.id, connection_id=connection.id, discipline="MECH"
                    )
                )
                pool = ResourcePool(
                    connection_id=connection.id, label="Bulk test", orgid="ORG", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                data = discipline_fixture(pool)
                data["source"]["coverage_before"] = "2026-11-02"
                for r in data["source"]["rows"]:
                    r["days"].extend(
                        [
                            {"date": f"2026-10-{d:02d}", "code": "1", "capacity_hours": 10.5}
                            for d in range(3, 32)
                        ]
                        + [{"date": "2026-11-01", "code": "1", "capacity_hours": 10.5}]
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
                for n in range(1, quantity + 2):
                    plan = AssignmentPlan(
                        actor_id=user.id,
                        pool_id=pool.id,
                        connection_id=connection.id,
                        assignment_id=str(n),
                        person_id=person.id,
                        laborcode="L0",
                        demand_minutes=300,
                        state="reserved",
                    )
                    db.add(plan)
                    await db.flush()
                    plans.append(plan)
                    for day in (
                        [date(2026, 9, 1), date(2026, 9, 2)]
                        if n == quantity + 1
                        else [date(2026, 10, 31), date(2026, 11, 1)]
                    ):
                        db.add(
                            Allocation(
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
                                assignment_id=str(n),
                                upstream_baseline={"revision": str(n * 10)},
                            )
                        )
                    row = {k: None for k in PROTECTED}
                    row.update(
                        assignmentid=n,
                        craft="MECH",
                        orgid="ORG",
                        parentassignid=0,
                        status="WAITASGN",
                        laborhrs=5,
                        wplaborid="P1",
                        skilllevel="TECH",
                        _rowstamp=str(n * 10),
                    )
                    source_rows.append(row)
                if mode == "limit":
                    db.add_all(
                        [
                            Allocation(
                                pool_id=pool.id,
                                person_id=person.id,
                                connection_id=connection.id,
                                site_id="TEST",
                                workorder_id="100",
                                discipline="MECH",
                                craft="MECH",
                                role="TECH",
                                laborcode="L0",
                                date=date(2026, 10, 30),
                                minutes=1,
                            )
                            for _ in range(999)
                        ]
                    )
                if mode == "legacy":
                    db.add(
                        Allocation(
                            pool_id=pool.id,
                            person_id=person.id,
                            connection_id=connection.id,
                            site_id="TEST",
                            workorder_id="100",
                            discipline="MECH",
                            craft="MECH",
                            role="TECH",
                            laborcode="L0",
                            date=date(2026, 10, 30),
                            minutes=30,
                        )
                    )
                if mode == "locked":
                    plans[0].sync_state = "unknown"
            if mode == "deadline":
                settings.read_draft_request_timeout_seconds = 1
            app = create_app(settings)
            app.state.sessions = sessions
            writes = []
            moved = False
            unreadable_source = None
            pause = asyncio.Event()
            entered = asyncio.Event()
            remote = {"resource_id": "_TASK", "root_revision": "1000", "assignments": source_rows}

            async def target(client, cfg, site, task, source, discipline):
                if unreadable_source == source:
                    raise MaximoReadError("Synthetic readback unavailable")
                return {
                    **deepcopy(remote),
                    "assignment": deepcopy(
                        next(r for r in remote["assignments"] if str(r["assignmentid"]) == source)
                    ),
                }

            async def tasks(*args):
                return [
                    Task(
                        task_workorder_id="200",
                        task_id=10,
                        description="Prepare",
                        planned_labor=[],
                        assignments=[
                            TaskAssignment(
                                assignment_id=str(r["assignmentid"]),
                                task_id=10,
                                craft=r["craft"],
                                labor_hours=Decimal(str(r["laborhrs"])),
                                status=r["status"],
                                laborcode=r["laborcode"],
                                scheduledate=r["scheduledate"],
                                revision=r["_rowstamp"],
                            )
                            for r in remote["assignments"]
                        ],
                    )
                ]

            monkeypatch.setattr("app.assignments.plan_uploads.read_daily_target", target)
            monkeypatch.setattr("app.assignments.plan_uploads.read_tasks", tasks)
            monkeypatch.setattr(
                "app.assignments.plan_uploads.read_load", AsyncMock(return_value={})
            )

            async def transport(request):
                nonlocal unreadable_source
                if request.method == "POST":
                    writes.append(request)
                    if mode in {"claimed", "deadline"}:
                        entered.set()
                        await pause.wait()
                    if mode == "failed" and len(writes) == 1:
                        return httpx.Response(403)
                    body = json.loads(request.content)
                    source = next(
                        r
                        for r in remote["assignments"]
                        if r["assignmentid"] == body["assignment"][0]["assignmentid"]
                    )
                    for payload in body["assignment"]:
                        if payload["_action"] == "Add":
                            child = {
                                **source,
                                "assignmentid": 100 + len(writes),
                                "_rowstamp": str(9000 + len(writes)),
                            }
                            remote["assignments"].append(child)
                        else:
                            child = source
                        start = datetime.fromisoformat(payload["scheduledate"])
                        minutes = int(Decimal(str(payload["laborhrs"])) * 60)
                        child.update(
                            laborcode=payload["laborcode"],
                            laborhrs=payload["laborhrs"],
                            scheduledate=start.isoformat(),
                            finishdate=(start + timedelta(minutes=minutes)).isoformat(),
                            status="ASSIGNED",
                            _rowstamp=str(5000 + len(writes)),
                        )
                    remote["root_revision"] = str(int(remote["root_revision"]) + 1)
                    if mode == "unknown" and len(writes) == 1:
                        unreadable_source = str(source["assignmentid"])
                        raise httpx.ReadTimeout("Synthetic lostresponse")
                    return httpx.Response(204)
                return httpx.Response(
                    200, json={"member": [record(bdpocdiscipline="OTHER" if moved else "MECH")]}
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
                url = f"/api/resource-pools/{pool.id}/plan-upload-batches"
                create_body = {
                    "request_id": str(uuid4()),
                    "month": "2026-10",
                    "start_time": "06:30",
                }
                if mode == "csrf":
                    assert (await client.post(url, json=create_body)).status_code == 403
                response = await client.post(url, json=create_body, headers=headers)
                if mode == "limit":
                    assert response.status_code == 409 and "1000" in response.text
                    async with sessions() as db:
                        assert await db.scalar(select(AssignmentPlanUploadBatch)) is None
                    assert not writes
                    return
                assert response.status_code == 200, response.text
                batch = response.json()
                batch_id = batch["batch_id"]
                base = "/api/plan-upload-batches/" + batch_id
                assert batch["counts"]["total"] == quantity + (mode == "legacy")
                assert (
                    sum(v for k, v in batch["counts"].items() if k != "total")
                    == batch["counts"]["total"]
                )
                if mode == "other_actor":
                    client.cookies.set(SESSION_COOKIE, other_token)
                    assert (await client.get(base)).status_code == 404
                    assert (
                        await client.get(
                            "/api/plan-upload-batch-submissions/" + create_body["request_id"]
                        )
                    ).status_code == 404
                    return
                if mode == "uuid_scope":
                    assert (
                        await client.post(
                            url, json={**create_body, "month": "2026-11"}, headers=headers
                        )
                    ).status_code == 409
                if mode == "duplicate":
                    assert (await client.post(url, json=create_body, headers=headers)).json()[
                        "batch_id"
                    ] == batch_id
                if mode == "many":
                    page = (await client.get(base)).json()
                    assert (
                        len(page["items"]) == 20
                        and page["has_more"]
                        and page["next_cursor"] == "20"
                    )
                    second = (await client.get(base + "?cursor=20")).json()
                    assert len(second["items"]) == 1 and not second["has_more"]
                    assert len({i["item_id"] for i in page["items"] + second["items"]}) == 21
                if mode == "csrf":
                    assert (await client.post(base + "/prepare-next")).status_code == 403
                while batch["state"] == "previewing":
                    r = await client.post(base + "/prepare-next", headers=headers)
                    assert r.status_code == 200, r.text
                    batch = r.json()
                    assert batch["changed_item"] is not None
                    if batch["changed_item"].get("plan_id"):
                        assert {s["date"] for s in batch["changed_item"]["segments"]} == {
                            "2026-10-31",
                            "2026-11-01",
                        }
                assert batch["state"] == "ready" and not writes
                if mode == "many":
                    assert batch["counts"]["ready"] == 21
                    return
                if mode == "disabled":
                    assert batch["counts"]["blocked"] == 2
                    return
                if mode == "legacy":
                    assert batch["counts"]["blocked"] == 1
                    return
                if mode == "locked":
                    assert batch["counts"]["blocked"] == 1
                    return
                if mode == "moved":
                    moved = True
                    page = (await client.get(base)).json()
                    assert all(
                        set(i) == {"item_id", "kind", "state", "reason"}
                        and i["reason"] == "scope_unavailable"
                        for i in page["items"]
                    )
                    return
                if mode == "expired":
                    async with sessions.begin() as db:
                        (await db.get(AssignmentPlanUploadBatch, UUID(batch_id))).expires_at = (
                            datetime.now(UTC) - timedelta(seconds=1)
                        )
                    assert (
                        await client.post(
                            base + "/confirm", json={"request_id": str(uuid4())}, headers=headers
                        )
                    ).status_code == 409
                    assert not writes
                    return
                confirmation = {"request_id": str(uuid4())}
                if mode == "csrf":
                    assert (
                        await client.post(base + "/confirm", json=confirmation)
                    ).status_code == 403
                r = await client.post(base + "/confirm", json=confirmation, headers=headers)
                assert r.status_code == 200, r.text
                batch = r.json()
                if mode == "duplicate":
                    assert (
                        await client.post(base + "/confirm", json=confirmation, headers=headers)
                    ).json()["confirmation_request_id"] == confirmation["request_id"]
                receipt = await client.get(
                    "/api/plan-upload-batch-submissions/" + confirmation["request_id"]
                )
                assert receipt.status_code == 200
                if mode == "csrf":
                    assert (
                        await client.post(
                            base + "/continue", json={"item_id": batch["next_item_id"]}
                        )
                    ).status_code == 403
                if mode == "revoked":
                    async with sessions.begin() as db:
                        await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
                    assert (
                        await client.post(
                            base + "/continue",
                            json={"item_id": batch["next_item_id"]},
                            headers=headers,
                        )
                    ).status_code == 404
                    assert (await client.get(base)).status_code == 404
                    assert not writes
                    return
                if mode == "capacity":
                    monkeypatch.setattr(
                        "app.assignments.plan_uploads.read_load",
                        AsyncMock(
                            return_value={
                                "999": {
                                    "laborcode": "L0",
                                    "date": date(2026, 10, 31),
                                    "minutes": 600,
                                }
                            }
                        ),
                    )
                if mode == "external_source":
                    async with sessions() as db:
                        item = await db.get(
                            AssignmentPlanUploadBatchItem, UUID(batch["next_item_id"])
                        )
                    source = next(
                        r
                        for r in remote["assignments"]
                        if str(r["assignmentid"]) == item.proposal["source_assignment_id"]
                    )
                    source["_rowstamp"] = "99999"
                    remote["root_revision"] = "9000"
                if mode == "changed":
                    async with sessions.begin() as db:
                        item = await db.scalar(
                            select(Allocation).where(Allocation.plan_id == plans[0].id)
                        )
                        item.version += 1
                if mode in {"claimed", "deadline"}:
                    running = asyncio.create_task(
                        client.post(
                            base + "/continue",
                            json={"item_id": batch["next_item_id"]},
                            headers=headers,
                        )
                    )
                    await asyncio.wait_for(entered.wait(), 5)
                    if mode == "claimed":
                        running.cancel()
                        with pytest.raises(asyncio.CancelledError):
                            await running
                    else:
                        assert (await running).status_code == 504
                    current = (await client.get(base)).json()
                    assert current["counts"]["sending"] == 1 and current["next_item_id"] is None
                    async with sessions.begin() as db:
                        item = await db.scalar(
                            select(AssignmentPlanUploadBatchItem).where(
                                AssignmentPlanUploadBatchItem.state == "sending"
                            )
                        )
                        item.claimed_until = datetime.now(UTC) - timedelta(seconds=1)
                    current = (await client.get(base)).json()
                    assert current["counts"]["unknown"] == 1
                    lost = next(i for i in current["items"] if i["state"] == "unknown")
                    assert (
                        await client.post(
                            base + "/continue", json={"item_id": lost["item_id"]}, headers=headers
                        )
                    ).status_code == 200
                    assert len(writes) == 1
                    return
                if mode == "database_preflight":
                    from app.assignments import plan_uploads

                    original_preview = plan_uploads.preview
                    calls = 0

                    async def failed_first_preview(*args, **kwargs):
                        nonlocal calls
                        calls += 1
                        if calls == 1:
                            raise SQLAlchemyError("synthetic preflight lock timeout")
                        return await original_preview(*args, **kwargs)

                    monkeypatch.setattr(plan_uploads, "preview", failed_first_preview)
                if mode == "database_after_send":
                    from app.assignments import plan_uploads

                    original_submit = plan_uploads.submit

                    async def response_lost_after_commit(*args, **kwargs):
                        await original_submit(*args, **kwargs)
                        raise SQLAlchemyError("synthetic receipt response failure")

                    monkeypatch.setattr(plan_uploads, "submit", response_lost_after_commit)
                while batch["state"] == "running":
                    body = {"item_id": batch["next_item_id"]}
                    if mode == "concurrent_continue":
                        responses = await asyncio.gather(
                            *[
                                client.post(base + "/continue", json=body, headers=headers)
                                for _ in range(2)
                            ]
                        )
                        assert all(r.status_code == 200 for r in responses), [
                            r.text for r in responses
                        ]
                        r = responses[0]
                    else:
                        r = await client.post(base + "/continue", json=body, headers=headers)
                    assert r.status_code == 200, r.text
                    batch = r.json()
                    if mode == "duplicate":
                        assert (
                            await client.post(base + "/continue", json=body, headers=headers)
                        ).status_code == 200
                assert batch["state"] == "completed"
                assert batch["counts"]["confirmed"] == (
                    0
                    if mode == "capacity"
                    else 1
                    if mode
                    in {"changed", "failed", "unknown", "external_source", "database_preflight"}
                    else 2
                ), batch
                if mode == "capacity":
                    assert batch["counts"]["blocked"] == 2 and not writes
                elif mode in {"changed", "external_source", "database_preflight"}:
                    assert batch["counts"]["blocked"] == 1 and len(writes) == 1
                    if mode == "database_preflight":
                        page = (await client.get(base)).json()
                        blocked = next(i for i in page["items"] if i["state"] == "blocked")
                        assert blocked["attempt_id"] is None
                        assert blocked["reason"] == "final_preflight_unavailable_no_send"
                elif mode == "failed":
                    assert batch["counts"]["failed"] == 1 and len(writes) == 2
                elif mode == "unknown":
                    assert batch["counts"]["unknown"] == 1 and len(writes) == 2
                else:
                    assert len(writes) == 2
                latest = await client.get(url + "?month=2026-10")
                assert latest.json()["batch_id"] == batch_id
                assert (await client.get(base + "?cursor=0&cursor=20")).status_code == 422
                assert (await client.get(base + "?x=1")).status_code == 422

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
