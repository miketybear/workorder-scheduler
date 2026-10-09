import asyncio
import json
import re
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete, select
from test_maximo import record
from test_write_contract_probe_postgres import setup

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.db.models import (
    AuditEvent,
    Draft,
    DraftItem,
    MaximoConnection,
    PlannerPermission,
    UploadItem,
    User,
)
from app.main import create_app
from app.maximo.contract_probe import OPERATOR_WORKTYPES
from app.maximo.detail import current_snapshot
from app.maximo.reader import WorkOrder
from app.scheduling.changes import ScheduleChanges
from app.scheduling.drafts import WorkOrderKey, create_draft
from app.scheduling.routes import snapshot_token

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("worktype", sorted(OPERATOR_WORKTYPES))
@pytest.mark.parametrize("explicit_intent", [False, True])
@pytest.mark.parametrize("target_field", ["targstartdate", "targcompdate"])
def test_native_api_target_rule_groups_require_intent_and_forbid_pm_cft(
    worktype, explicit_intent, target_field
):
    async def main():
        async with setup() as (sessions, settings, user, connection):
            settings.maximo[connection.id].conditional_write_contract = "native_rowstamp_test"
            raw = record(
                bdpocdiscipline="MECH",
                worktype=worktype,
                estdur=2,
                assignedtechname=None,
                href="https://maximo.invalid/maximo/oslc/os/oslcmxwodetail/_TEST100",
                _rowstamp="100",
                targstartdate="2026-10-01T00:00:00+07:00",
                targcompdate="2026-10-03T00:00:00+07:00",
            )
            original = current_snapshot(
                WorkOrderKey(connection.id, "TEST", "100"),
                WorkOrder.model_validate(raw),
                frozenset({"VALID"}),
            )
            async with sessions.begin() as db:
                token, csrf = await issue_session(db, user)
            writes = []

            async def upstream(request):
                if request.method == "POST":
                    payload = json.loads(request.content)
                    assert set(payload) == {target_field, "_rowstamp"}
                    assert worktype not in {"PM", "CFT"} and explicit_intent
                    async with sessions() as db:
                        item = await db.get(UploadItem, UUID(request.headers["transactionid"]))
                        assert item.state == "sending"
                        assert await db.scalar(
                            select(AuditEvent.id).where(
                                AuditEvent.upload_item_id == item.id, AuditEvent.event == "intent"
                            )
                        )
                        prepared = await db.scalar(
                            select(AuditEvent).where(
                                AuditEvent.upload_item_id == item.id, AuditEvent.event == "prepared"
                            )
                        )
                        assert prepared.details["proposal"]["change_target"] is True
                    writes.append(request)
                    raw.update({target_field: payload[target_field], "_rowstamp": "101"})
                    return httpx.Response(204)
                if request.url.path.endswith("mxperson"):
                    return httpx.Response(
                        200, json={"member": [{"personid": "probe", "ct_discipline": "MECH"}]}
                    )
                if request.url.path.endswith("mxpersongroup"):
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {"persongroup": "CREW", "persongroupteam": [{"respparty": "VALID"}]}
                            ]
                        },
                    )
                return httpx.Response(
                    200, json=raw if "_TEST100" in request.url.path else {"member": [raw]}
                )

            app = create_app(settings)
            app.state.sessions = sessions
            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"X-CSRF-Token": csrf}
                created = await client.post(
                    "/api/drafts",
                    headers=headers,
                    json={
                        "connection_id": str(connection.id),
                        "site_id": "TEST",
                        "workorder_id": "100",
                        "discipline": "MECH",
                        "baseline_token": snapshot_token(original),
                        "request_id": str(uuid4()),
                        "changes": {
                            target_field: (
                                "2026-10-02T00:00:00+07:00"
                                if target_field == "targstartdate"
                                else "2026-10-04T00:00:00+07:00"
                            ),
                            "change_target": explicit_intent,
                        },
                    },
                )
                if not explicit_intent or worktype in {"PM", "CFT"}:
                    assert created.status_code == 422, created.text
                    assert not writes
                    return
                assert created.status_code == 201, created.text
                draft_id = created.json()["draft_id"]
                selection = {"version": 1, "items": [{"site_id": "TEST", "workorder_id": "100"}]}
                preview = await client.post(
                    f"/api/drafts/{draft_id}/upload-preview", json=selection, headers=headers
                )
                assert preview.status_code == 200 and preview.json()["send_enabled"], preview.text
                payload = {
                    **selection,
                    "request_id": str(uuid4()),
                    "preview_hash": preview.json()["preview_hash"],
                }
                sent = await client.post(
                    f"/api/drafts/{draft_id}/uploads", json=payload, headers=headers
                )
                assert sent.status_code == 200, sent.text
                assert sent.json()["counts"] == {"confirmed": 1} and sent.json()["source_finalized"]
                assert sent.json()["items"][0]["restore_source"] is None
                duplicate = await client.post(
                    f"/api/drafts/{draft_id}/uploads", json=payload, headers=headers
                )
                assert duplicate.json() == sent.json() and len(writes) == 1

    asyncio.run(main(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.parametrize(
    "mode",
    [
        "success",
        "conflict",
        "timeout-before",
        "timeout-after",
        "preview-race",
        "eleven",
        "default_gate",
        "connection_production",
        "no_planner",
        "person_changed",
        "moved",
        "token_send_race",
        "planner_after_crew",
        "connection_after_person",
        "simultaneous",
        "pm_dates",
        "pm_explicit",
        "pm_pic",
        "CM",
        "PM",
        "CFT",
        "REC",
        "OVERHAUL",
        "MoD",
        "General",
        "Routine",
        "UNKNOWN",
        *[f"{worktype}:timeout-after" for worktype in sorted(OPERATOR_WORKTYPES)],
        *[f"{worktype}:conflict" for worktype in sorted(OPERATOR_WORKTYPES)],
    ],
)
def test_verified_test_sender_native_condition_durable_intent_receipt_and_recovery(mode):
    contract_worktype = mode.split(":")[0] if ":" in mode else None
    mode = mode.split(":")[-1]

    async def main():
        async with setup() as (sessions, settings, user, connection):
            settings.maximo[connection.id].conditional_write_contract = "native_rowstamp_test"
            raws = {
                str(i): record(
                    workorderid=i,
                    wonum=f"WO{i}",
                    bdpocdiscipline="MECH",
                    estdur=2,
                    assignedtechname=None,
                    href=f"https://maximo.invalid/maximo/oslc/os/oslcmxwodetail/_TEST{i}",
                    _rowstamp="100",
                )
                for i in range(100, 111 if mode == "eleven" else 101)
            }
            pm = mode in {"pm_dates", "pm_explicit", "pm_pic"}
            successful = mode in OPERATOR_WORKTYPES or mode in {
                "success",
                "simultaneous",
                "pm_dates",
                "pm_pic",
            }
            if pm or mode in OPERATOR_WORKTYPES or mode == "UNKNOWN" or contract_worktype:
                raws["100"]["worktype"] = contract_worktype or ("PM" if pm else mode)
            if pm:
                raws["100"].update(
                    schedstart="2026-10-30T06:30:00+07:00",
                    schedfinish="2026-10-31T17:30:00+07:00",
                    estdur=25,
                )
            async with sessions.begin() as db:
                token, csrf = await issue_session(db, user)
                snapshot = current_snapshot(
                    WorkOrderKey(connection.id, "TEST", "100"),
                    WorkOrder.model_validate(raws["100"]),
                    frozenset({"VALID"}),
                )
                proposal = (
                    ScheduleChanges(
                        schedstart="2026-10-30T07:37:13+07:00", assignedtechname="VALID"
                    )
                    if mode == "pm_pic"
                    else ScheduleChanges(schedstart="2026-10-30T07:37:13+07:00", estdur=26)
                    if mode == "pm_explicit"
                    else ScheduleChanges(schedstart="2026-10-30T07:37:13+07:00")
                    if pm
                    else ScheduleChanges(estdur=3)
                )
                draft = await create_draft(db, user.id, snapshot, proposal)
                for number in list(raws)[1:]:
                    db.add(
                        DraftItem(
                            draft_id=draft.id,
                            site_id="TEST",
                            workorder_id=number,
                            wonum=f"WO{number}",
                            discipline="MECH",
                            upstream_revision=None,
                            baseline=snapshot.baseline.model_dump(mode="json"),
                            changes={"estdur": "3"},
                        )
                    )
            if mode == "default_gate":
                settings.maximo[connection.id].conditional_write_contract = None
            if mode in {"connection_production", "no_planner"}:
                async with sessions.begin() as db:
                    if mode == "connection_production":
                        (await db.get(MaximoConnection, connection.id)).environment = "production"
                    else:
                        await db.execute(
                            delete(PlannerPermission).where(PlannerPermission.user_id == user.id)
                        )
            if mode == "moved":
                raws["100"]["bdpocdiscipline"] = "OTHER"
            writes = []

            async def upstream(request):
                if request.method == "POST":
                    payload = json.loads(request.content)
                    assert (
                        set(payload)
                        == (
                            {"schedstart", "assignedtechname", "_rowstamp"}
                            if mode == "pm_pic"
                            else {"schedstart", "estdur", "_rowstamp"}
                            if mode == "pm_explicit"
                            else {"schedstart", "_rowstamp"}
                            if pm
                            else {"estdur", "_rowstamp"}
                        )
                        and "if-match" not in request.headers
                    )
                    assert request.headers["x-method-override"] == "PATCH"
                    # A different connection must see committed exact native intent first.
                    async with sessions() as db:
                        item = await db.get(UploadItem, UUID(request.headers["transactionid"]))
                        intent = await db.scalar(
                            select(AuditEvent).where(
                                AuditEvent.upload_item_id == item.id,
                                AuditEvent.event == "conditional_request",
                            )
                        )
                        assert item.state == "sending" and intent.details["transaction_id"] == str(
                            item.id
                        )
                        assert intent.details["precondition"]["value"] == payload["_rowstamp"]
                    writes.append(request)
                    raw = raws[request.url.path.rsplit("_TEST", 1)[1]]
                    if mode in {"conflict", "token_send_race"}:
                        return httpx.Response(412, json={"Error": {"reasonCode": "BMXAA8229W"}})
                    if mode == "timeout-before":
                        raise httpx.ReadTimeout("private")
                    raw.update({k: v for k, v in payload.items() if k != "_rowstamp"})
                    raw["_rowstamp"] = "101"
                    if pm:
                        raw["estdur"] = 21
                    if mode == "timeout-after":
                        raise httpx.ReadTimeout("private")
                    return httpx.Response(204)
                if request.url.path.endswith("mxperson"):
                    if mode == "connection_after_person":
                        async with sessions.begin() as db:
                            sending = await db.scalar(
                                select(UploadItem.id).where(UploadItem.state == "sending")
                            )
                            if sending:
                                (await db.get(MaximoConnection, connection.id)).enabled = False
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {
                                    "personid": "probe",
                                    "ct_discipline": "OTHER"
                                    if mode == "person_changed"
                                    else "MECH",
                                }
                            ]
                        },
                    )
                if request.url.path.endswith("mxpersongroup"):
                    if mode == "planner_after_crew":
                        async with sessions.begin() as db:
                            sending = await db.scalar(
                                select(UploadItem.id).where(UploadItem.state == "sending")
                            )
                            if sending:
                                await db.execute(
                                    delete(PlannerPermission).where(
                                        PlannerPermission.user_id == user.id
                                    )
                                )
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {"persongroup": "CREW", "persongroupteam": [{"respparty": "VALID"}]}
                            ]
                        },
                    )
                if "_TEST" in request.url.path:
                    return httpx.Response(
                        200,
                        json=raws[request.url.path.rsplit("_TEST", 1)[1]],
                        headers={"ETag": "0"},
                    )
                number = re.search(r"workorderid=(\d+)", request.url.params["oslc.where"])[1]
                return httpx.Response(200, json={"member": [raws[number]]})

            app = create_app(settings)
            app.state.sessions = sessions
            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"X-CSRF-Token": csrf}
                url = f"/api/drafts/{draft.id}"
                selection = {
                    "version": 1,
                    "items": [{"site_id": "TEST", "workorder_id": number} for number in raws],
                }
                preview = await client.post(
                    url + "/upload-preview", json=selection, headers=headers
                )
                if mode in {"no_planner", "person_changed", "moved"}:
                    assert preview.status_code in {404, 409}, preview.text
                    assert not writes
                    return
                assert preview.status_code == 200, preview.text
                if mode in {"default_gate", "connection_production", "UNKNOWN"}:
                    assert not preview.json()["send_enabled"]
                    rejected = await client.post(
                        url + "/uploads",
                        json={
                            **selection,
                            "request_id": str(uuid4()),
                            "preview_hash": preview.json()["preview_hash"],
                        },
                        headers=headers,
                    )
                    assert rejected.status_code == 409 and not writes
                    return
                assert preview.json()["send_enabled"] and preview.json()["gate"] is None
                payload = {
                    **selection,
                    "request_id": str(uuid4()),
                    "preview_hash": preview.json()["preview_hash"],
                }
                if mode == "preview-race":
                    raws["100"]["_rowstamp"] = "101"
                    rejected = await client.post(url + "/uploads", json=payload, headers=headers)
                    assert rejected.status_code == 409 and not writes
                    return
                missing = await client.get(f"/api/uploads/by-request/{payload['request_id']}")
                assert (
                    missing.status_code == 404
                    and missing.json()["detail"] == {"code": "receipt_not_found"}
                    and not writes
                )
                no_csrf = await client.post(url + "/uploads", json=payload)
                assert no_csrf.status_code == 403 and not writes
                if mode == "simultaneous":
                    responses = await asyncio.gather(
                        *(
                            client.post(url + "/uploads", json=payload, headers=headers)
                            for _ in range(2)
                        )
                    )
                    assert all(response.status_code == 200 for response in responses)
                    assert responses[0].json()["batch_id"] == responses[1].json()["batch_id"]
                    sent = await client.get(f"/api/uploads/{responses[0].json()['batch_id']}")
                else:
                    sent = await client.post(url + "/uploads", json=payload, headers=headers)
                if mode in {"planner_after_crew", "connection_after_person"}:
                    assert sent.status_code in {200, 404}
                    assert not writes
                    async with sessions() as db:
                        assert await db.scalar(select(UploadItem.state)) == "failed"
                    return
                assert sent.status_code == 200, sent.text
                result = sent.json()
                if mode == "planner_after_crew":
                    # POST authority disappears during the final crew GET. The sender
                    # records a known failure, then status refuses revoked write data.
                    assert not writes
                    async with sessions() as db:
                        assert await db.scalar(select(UploadItem.state)) == "failed"
                    return
                assert len(writes) == (10 if mode == "eleven" else 1)
                assert result["counts"] == (
                    {"confirmed": 10, "pending": 1}
                    if mode == "eleven"
                    else {
                        "confirmed"
                        if successful
                        else "conflict"
                        if mode in {"conflict", "token_send_race"}
                        else "unknown": 1
                    }
                )
                assert result["source_finalized"] == (successful)
                if pm:
                    duration_result = result["items"][0]["duration_result"]
                    assert duration_result["code"] == (
                        "pm_duration_mismatch"
                        if mode == "pm_explicit"
                        else "pm_duration_recalculated"
                    )
                assert result["items"][0]["restore_source"] == (
                    {"before": snapshot.baseline.model_dump(mode="json")}
                    if mode == "pm_dates"
                    else None
                )
                receipt = await client.post(url + "/uploads", json=payload, headers=headers)
                assert receipt.status_code == 200 and receipt.json() == result
                assert len(writes) == (10 if mode == "eleven" else 1)
                altered = await client.post(
                    url + "/uploads", json={**payload, "version": 2}, headers=headers
                )
                assert altered.status_code == 409
                batch = result["batch_id"]
                before_lookup = len(writes)
                lookup = await client.get(f"/api/uploads/by-request/{payload['request_id']}")
                assert lookup.status_code == 200 and lookup.json() == result
                assert (
                    lookup.headers["Cache-Control"] == "no-store" and len(writes) == before_lookup
                )
                if mode == "pm_dates":
                    # Mutable storage is never accepted as an alternative original.
                    async with sessions.begin() as db:
                        persisted = await db.scalar(select(UploadItem))
                        original_before = persisted.before
                        persisted.before = {**original_before, "estdur": "999"}
                    tampered = await client.get(f"/api/uploads/by-request/{payload['request_id']}")
                    assert tampered.status_code == 409
                    async with sessions.begin() as db:
                        (await db.scalar(select(UploadItem))).before = original_before
                async with sessions.begin() as db:
                    other = await db.scalar(select(User).where(User.id != user.id))
                    foreign_token, foreign_csrf = await issue_session(db, other)
                client.cookies.set(SESSION_COOKIE, foreign_token)
                before_foreign = len(writes)
                foreign_lookup = await client.get(
                    f"/api/uploads/by-request/{payload['request_id']}"
                )
                assert foreign_lookup.status_code == 404 and foreign_lookup.json()["detail"] == {
                    "code": "receipt_not_found"
                }
                assert len(writes) == before_foreign
                for action in ("continue", "reconcile"):
                    denied = await client.post(
                        f"/api/uploads/{batch}/{action}",
                        json={},
                        headers={"X-CSRF-Token": foreign_csrf},
                    )
                    assert denied.status_code == 404 and len(writes) == before_foreign
                client.cookies.set(SESSION_COOKIE, token)
                command = await client.post(
                    f"/api/uploads/{batch}/continue", json={}, headers=headers
                )
                assert command.status_code == 200
                assert len(writes) == (11 if mode == "eleven" else 1)
                reconciled = await client.post(
                    f"/api/uploads/{batch}/reconcile", json={}, headers=headers
                )
                assert reconciled.status_code == 200
                assert len(writes) == (11 if mode == "eleven" else 1)
                expected_finalized = mode in OPERATOR_WORKTYPES or mode in {
                    "success",
                    "timeout-after",
                    "eleven",
                    "simultaneous",
                    "pm_dates",
                    "pm_pic",
                    "CFT",
                }
                assert reconciled.json()["source_finalized"] == expected_finalized
                async with sessions() as db:
                    assert (await db.get(Draft, draft.id) is None) == expected_finalized
                    sources = list(
                        (
                            await db.scalars(
                                select(AuditEvent).where(AuditEvent.event == "prepared")
                            )
                        ).all()
                    )
                    assert all(
                        source.details["source_revision"] is None
                        and source.details["revision"] == "100"
                        for source in sources
                    )

    asyncio.run(main(), loop_factory=asyncio.SelectorEventLoop)
