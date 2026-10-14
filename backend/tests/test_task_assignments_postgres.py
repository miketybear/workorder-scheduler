import asyncio
import json
from copy import deepcopy
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete, func, select
from test_assignments_postgres import current_receipt, discipline_fixture
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import database, seed
from test_task_assignments import sample

from app.assignments.models import (
    Allocation,
    AssignmentEvent,
    AssignmentSubmission,
    AssignmentUpload,
)
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import MaximoConnection
from app.main import create_app
from app.rota.activation import materialize, proposed_days
from app.rota.models import (
    ResourcePerson,
    ResourcePool,
    ResourcePoolGrant,
    ResourcePoolState,
    RotaImport,
)
from app.scheduling.routes import digest

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "mode",
    [
        "normal",
        "load_failure",
        "foreign_load",
        "upload_confirmed",
        "upload_timeout",
        "upload_sibling_preserved",
        "upload_sibling_deleted",
        "edit_overlap",
        "release_overlap",
        "upload_revoke_load",
        "upload_revoke_final",
        "upload_duplicate_revoke",
    ],
)
def test_atomic_task_batch_scope_capacity_and_receipts(monkeypatch, mode):
    for module in ["app.scheduling.routes", "app.assignments.routes", "app.rota.activation_routes"]:
        monkeypatch.setattr(module + ".sync_person_access", AsyncMock())

    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {
                connections[0].id: config(
                    task_load_contract="bdsched_assignment_test",
                    collection_url="https://maximo.invalid/maximo/oslc/os/BDSCHED_WO",
                    assignment_write_contract="native_assignment_rowstamp_test"
                    if mode.startswith("upload")
                    else None,
                )
            }
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
                pool = ResourcePool(
                    connection_id=connection.id, label="Test", orgid="ORG", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                stage = RotaImport(
                    pool_id=pool.id,
                    actor_id=user.id,
                    version=2,
                    file_name="fixture.ods",
                    sheet="ROTA_2026",
                    **discipline_fixture(pool),
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
            app = create_app(settings)
            app.state.sessions = sessions

            remote_assignment = {
                "assignmentid": 300,
                "craft": "MECH",
                "_rowstamp": "123",
                "status": "WAITASGN",
                "laborhrs": 0.5,
            }
            writes = []
            remote_siblings = (
                [
                    {
                        "assignmentid": 302,
                        "craft": "MECH",
                        "_rowstamp": "124",
                        "status": "WAITASGN",
                        "laborhrs": 5,
                    }
                ]
                if mode.startswith("upload_sibling")
                else []
            )
            overlap_allocation = None
            upload_started = False

            async def respond(request):
                if request.method == "POST":
                    assert request.headers["patchtype"] == "MERGE"
                    writes.append(request)
                    async with sessions() as db:
                        attempt = await db.scalar(select(AssignmentUpload))
                        assert attempt is not None and attempt.state == "unknown"
                        assert (
                            await db.scalar(
                                select(func.count())
                                .select_from(AssignmentEvent)
                                .where(AssignmentEvent.event == "upload_intent")
                            )
                            == 1
                        )
                    change = json.loads(request.content)["assignment"][0]
                    remote_assignment.update(
                        {k: change[k] for k in ("laborcode", "laborhrs", "scheduledate")}
                    )
                    remote_assignment.update(status="ASSIGNED", _rowstamp="125")
                    if mode == "upload_sibling_deleted":
                        remote_siblings.clear()
                    if mode == "upload_timeout":
                        raise httpx.ReadTimeout("sent then lost response")
                    return httpx.Response(204)
                where = request.url.params.get("oslc.where", "")
                if "assignment.laborcode=" in where:
                    if upload_started and mode == "upload_revoke_load":
                        async with sessions.begin() as db:
                            await db.execute(
                                delete(ResourcePoolGrant).where(
                                    ResourcePoolGrant.pool_id == pool.id
                                )
                            )
                    if mode == "load_failure":
                        raise httpx.ReadTimeout("synthetic")
                    rows = []
                    if mode == "foreign_load":
                        rows = [
                            {
                                "siteid": "OTHER",
                                "workorderid": 999,
                                "assignment": [
                                    {
                                        "assignmentid": 999,
                                        "laborcode": "L0",
                                        "craft": "E&I",
                                        "scheduledate": "2026-10-01T06:00:00+07:00",
                                        "laborhrs": 10,
                                        "status": "ASSIGNED",
                                    }
                                ],
                            }
                        ]
                    return httpx.Response(200, json={"member": rows})
                if "workorderid=200" in where:
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {
                                    "siteid": "TEST",
                                    "workorderid": 200,
                                    "_rowstamp": "500",
                                    "href": "https://advertised.invalid/maximo/oslc/os/bdsched_wo/_Task--",
                                    "assignment": [remote_assignment, *remote_siblings],
                                }
                            ]
                        },
                    )
                if "WOACTIVITYTASK" in request.url.params.get("oslc.select", ""):
                    if upload_started and mode == "upload_duplicate_revoke":
                        async with sessions.begin() as db:
                            # Another request with the same UUID committed after this one's
                            # initial receipt lookup; authority disappears before its lock.
                            db.add(
                                AssignmentUpload(
                                    actor_id=user.id,
                                    request_id=UUID(upload_body["request_id"]),
                                    allocation_id=UUID(allocation["id"]),
                                    version=1,
                                    state="unknown",
                                    request_hash=digest(
                                        {"allocation_id": allocation["id"], "body": upload_body}
                                    ),
                                    intent={"payload": {}, "target": {}, "baseline": {}},
                                )
                            )
                            await db.execute(
                                delete(ResourcePoolGrant).where(
                                    ResourcePoolGrant.pool_id == pool.id
                                )
                            )
                    if overlap_allocation is not None:
                        async with sessions.begin() as db:
                            uploading = await db.get(Allocation, UUID(overlap_allocation))
                            uploading.sync_state = "unknown"
                    data = sample()
                    second = deepcopy(data["woactivitytask"][0])
                    second.update(workorderid=201, taskid=20)
                    second["showassignment"][0].update(assignmentid=301, taskid=20)
                    data["woactivitytask"].append(second)
                    data["assignment"].append({"assignmentid": 301, "_rowstamp": "124"})
                    return httpx.Response(200, json={"member": [data]})
                if upload_started and mode == "upload_revoke_final":
                    async with sessions.begin() as db:
                        if await db.scalar(select(func.count()).select_from(AssignmentUpload)):
                            await db.execute(
                                delete(ResourcePoolGrant).where(
                                    ResourcePoolGrant.pool_id == pool.id
                                )
                            )
                return httpx.Response(200, json={"member": [record(bdpocdiscipline="MECH")]})

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(respond)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"x-csrf-token": csrf}
                body = {
                    "connection_id": str(connection.id),
                    "site_id": "TEST",
                    "workorder_id": "100",
                    "discipline": "MECH",
                    "person_id": str(person.id),
                    "date": "2026-10-01",
                    "request_id": str(uuid4()),
                    "tasks": [
                        {
                            "task_workorder_id": "200",
                            "task_id": 10,
                            "assignment_id": "300",
                            "minutes": 360,
                        },
                        {
                            "task_workorder_id": "201",
                            "task_id": 20,
                            "assignment_id": "301",
                            "minutes": 271,
                        },
                    ],
                }
                url = f"/api/resource-pools/{pool.id}/task-allocations"
                assert (await client.post(url, json=body)).status_code == 403
                assert (await client.post(url, json=body, headers=headers)).status_code == 409
                async with sessions() as db:
                    assert await db.scalar(select(func.count()).select_from(Allocation)) == 0
                body["tasks"][1]["minutes"] = 270
                result = await client.post(url, json=body, headers=headers)
                if mode in {"load_failure", "foreign_load"}:
                    assert result.status_code in {409, 502, 503, 504}, result.text
                    async with sessions() as db:
                        assert await db.scalar(select(func.count()).select_from(Allocation)) == 0
                    return
                assert result.status_code == 200, result.text
                assert len(result.json()["items"]) == 2
                assert (
                    await client.post(url, json=body, headers=headers)
                ).json() == current_receipt(result.json())
                receipt = await client.get(f"/api/assignment-submissions/{body['request_id']}")
                assert receipt.json() == {"result": current_receipt(result.json())}
                changed = {**body, "request_id": str(uuid4())}
                assert (await client.post(url, json=changed, headers=headers)).status_code == 409
                guessed = deepcopy(changed)
                guessed["tasks"][0]["assignment_id"] = "999"
                assert (await client.post(url, json=guessed, headers=headers)).status_code == 404
                allocation = result.json()["items"][0]
                if mode.endswith("overlap"):
                    overlap_allocation = allocation["id"]
                    if mode == "release_overlap":
                        result = await client.request(
                            "DELETE",
                            f"/api/assignments/{allocation['id']}",
                            json={"version": 1, "request_id": str(uuid4())},
                            headers=headers,
                        )
                    else:
                        edit_body = {
                            k: body[k]
                            for k in (
                                "connection_id",
                                "site_id",
                                "workorder_id",
                                "discipline",
                                "person_id",
                                "date",
                            )
                        }
                        result = await client.patch(
                            f"/api/assignments/{allocation['id']}",
                            json={
                                **edit_body,
                                "minutes": 30,
                                "version": 1,
                                "request_id": str(uuid4()),
                            },
                            headers=headers,
                        )
                    assert result.status_code == 409, result.text
                    async with sessions() as db:
                        unchanged = await db.get(Allocation, UUID(allocation["id"]))
                        assert unchanged.minutes == 360 and unchanged.state == "reserved"
                        assert unchanged.version == 1 and unchanged.sync_state == "unknown"
                        assert (
                            await db.scalar(select(func.count()).select_from(AssignmentSubmission))
                            == 1
                        )
                    return
                if mode.startswith("upload"):
                    upload_body = {
                        "version": 1,
                        "request_id": str(uuid4()),
                        "scheduled_start": "2026-10-01T06:30:00+07:00",
                    }
                    upload_url = f"/api/assignments/{allocation['id']}/upload"
                    upload_started = True
                    uploaded = await client.post(upload_url, json=upload_body, headers=headers)
                    if mode == "upload_duplicate_revoke":
                        assert uploaded.status_code in {403, 404}, uploaded.text
                        assert "not_sent" not in uploaded.text
                        assert "attempt_id" not in uploaded.text
                        assert writes == []
                        async with sessions() as db:
                            attempts = (await db.scalars(select(AssignmentUpload))).all()
                            assert len(attempts) == 1 and attempts[0].state == "unknown"
                        return
                    if mode.startswith("upload_revoke"):
                        assert uploaded.status_code in {403, 404}, uploaded.text
                        assert writes == []
                        async with sessions() as db:
                            attempts = (await db.scalars(select(AssignmentUpload))).all()
                            assert len(attempts) == (1 if mode == "upload_revoke_final" else 0)
                            if attempts:
                                assert attempts[0].state == "unknown"
                        return
                    assert uploaded.status_code == 200, uploaded.text
                    assert uploaded.json()["state"] == (
                        "unknown"
                        if mode in {"upload_timeout", "upload_sibling_deleted"}
                        else "confirmed"
                    )
                    assert (
                        await client.post(upload_url, json=upload_body, headers=headers)
                    ).json() == uploaded.json()
                    assert len(writes) == 1
                    receipt = await client.get(
                        f"/api/assignment-upload-submissions/{upload_body['request_id']}"
                    )
                    assert receipt.json() == uploaded.json()
                    recovered = await client.post(
                        f"/api/assignment-uploads/{uploaded.json()['attempt_id']}/reconcile",
                        json={},
                        headers=headers,
                    )
                    assert recovered.status_code == 200 and recovered.json()["state"] == (
                        "unknown" if mode == "upload_sibling_deleted" else "confirmed"
                    ), recovered.text
                    assert len(writes) == 1
                    release = await client.request(
                        "DELETE",
                        f"/api/assignments/{allocation['id']}",
                        json={"version": 1, "request_id": str(uuid4())},
                        headers=headers,
                    )
                    assert release.status_code == 409
                    async with sessions() as db:
                        item = await db.get(Allocation, UUID(allocation["id"]))
                        assert item.sync_state == (
                            "unknown" if mode == "upload_sibling_deleted" else "synced"
                        )
                    return
                release = await client.request(
                    "DELETE",
                    f"/api/assignments/{allocation['id']}",
                    json={"version": 1, "request_id": str(uuid4())},
                    headers=headers,
                )
                assert release.status_code == 200, release.text
                async with sessions() as db:
                    assert await db.scalar(select(func.count()).select_from(AssignmentEvent)) == 3
                    assert (
                        await db.scalar(select(func.count()).select_from(AssignmentSubmission)) == 2
                    )

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
