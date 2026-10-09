import asyncio
import json
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from test_maximo import record
from test_write_contract_probe import evidence
from test_write_contract_probe_postgres import setup

from app.db.models import AuditEvent, UploadBatch, UploadItem, User
from app.maximo.field_contract_probe import FieldContractProbe
from app.maximo.reader import MaximoReadError

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "mode",
    [
        "exact",
        "foreign",
        "wrong_mode",
        "fresh_drift",
        "target_drift",
        "original_tamper",
        "status_drift",
        "token_drift",
        "etag_drift",
        "response_unknown",
        "readback_mismatch",
        "response_unsettled",
        "phase_exact",
        "phase_unrelated",
        "phase_timeout",
        "phase_missing",
        "phase_badstatus",
    ],
)
def test_scoped_recovery_is_one_audited_exact_original_request_or_no_send(mode):
    async def main():
        async with setup() as (sessions, settings, user, connection):
            start = datetime.fromisoformat("2026-10-30T06:30:00+07:00")
            finish = datetime.fromisoformat("2026-10-31T17:30:00+07:00")
            original = evidence().model_copy(
                update={
                    "worktype": "PM",
                    "discipline": "MECH",
                    "rowstamp_candidate": "100",
                    "resource_etag": "0",
                    "baseline": evidence().baseline.model_copy(
                        update={
                            "worktype": "PM",
                            "estdur": Decimal("25"),
                            "schedstart": start,
                            "schedfinish": finish,
                            "targstartdate": start,
                            "targcompdate": finish,
                        }
                    ),
                }
            )
            observed = original.model_copy(
                update={
                    "rowstamp_candidate": "102",
                    "baseline": original.baseline.model_copy(
                        update={
                            "schedstart": start + timedelta(hours=1),
                            "schedfinish": finish + timedelta(hours=1),
                            "estdur": Decimal("21"),
                        }
                    ),
                }
            )
            current = observed.model_copy(deep=True)
            posts = []
            recovery = None

            async def handler(request):
                nonlocal current
                if request.method == "GET":
                    if request.url.path.endswith("mxperson"):
                        return httpx.Response(
                            200, json={"member": [{"personid": "probe", "ct_discipline": "MECH"}]}
                        )
                    if request.url.path.endswith("mxpersongroup"):
                        return httpx.Response(
                            200,
                            json={
                                "member": [
                                    {
                                        "persongroup": "CREW",
                                        "persongroupteam": [{"respparty": "VALID"}],
                                    }
                                ]
                            },
                        )
                    raw = record(
                        **{
                            **current.baseline.model_dump(mode="json"),
                            "siteid": "TEST",
                            "workorderid": "100",
                            "wonum": "W100",
                            "bdpocdiscipline": "MECH",
                            "status": current.status,
                            "orgid": "ORG",
                            "href": "https://maximo.invalid" + original.resource_path,
                            "_rowstamp": current.rowstamp_candidate,
                        }
                    )
                    body = raw if request.url.path.endswith("_TEST") else {"member": [raw]}
                    return httpx.Response(
                        200, json=body, headers={"ETag": "999" if mode == "etag_drift" else "0"}
                    )
                payload = json.loads(request.content)
                is_duration = set(payload) == {"estdur", "_rowstamp"}
                expected = (
                    {"estdur": 25.0, "_rowstamp": "103"}
                    if is_duration
                    else {
                        "schedstart": start.isoformat(),
                        "schedfinish": finish.isoformat(),
                        "estdur": 25.0,
                        "_rowstamp": "102",
                    }
                )
                assert payload == expected
                assert "If-Match" not in request.headers
                async with sessions() as db:
                    events = list(
                        await db.scalars(
                            select(AuditEvent).where(AuditEvent.upload_item_id == recovery.item_id)
                        )
                    )
                    plan = next(
                        a
                        for a in events
                        if a.event
                        == (
                            "field_duration_recovery_plan" if is_duration else "field_recovery_plan"
                        )
                    )
                    intent = next(
                        a
                        for a in events
                        if a.event == "contract_intent"
                        and a.details.get("label")
                        == (
                            "field_original_duration_restore"
                            if is_duration
                            else "field_exact_original_restore"
                        )
                    )
                    assert plan.details["changes"] == {
                        key: value for key, value in payload.items() if key != "_rowstamp"
                    }
                    assert intent.details["attempt"] == request.headers["transactionid"]
                    assert intent.details["precondition"]["value"] == (
                        "103" if is_duration else "102"
                    )
                    assert (await db.get(UploadItem, recovery.item_id)).state == "unknown"
                posts.append(request)
                if mode == "response_unknown" or (mode == "phase_timeout" and is_duration):
                    raise httpx.ReadTimeout("private")
                if mode.startswith("phase_") and not is_duration:
                    baseline = original.baseline.model_copy(update={"estdur": Decimal("21")})
                    if mode == "phase_unrelated":
                        baseline = baseline.model_copy(update={"assignedtechname": "VALID"})
                    current = original.model_copy(
                        update={"rowstamp_candidate": "103", "baseline": baseline}
                    )
                elif mode != "readback_mismatch":
                    current = original.model_copy(
                        update={"rowstamp_candidate": "104" if is_duration else "103"}
                    )
                return httpx.Response(400 if mode == "phase_badstatus" and not is_duration else 204)

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                seed_probe = FieldContractProbe(
                    sessions,
                    settings,
                    client,
                    user.id,
                    connection.id,
                    "MECH",
                    "TEST",
                    "100",
                    operator_worktype="PM",
                )
                seed_probe.field_plan = (
                    (
                        "schedule_dates",
                        json.dumps(
                            {
                                "schedstart": observed.baseline.schedstart.isoformat(),
                                "schedfinish": observed.baseline.schedfinish.isoformat(),
                            },
                            sort_keys=True,
                        ),
                    ),
                )
                await seed_probe.reserve(original)
                attempt = str(uuid4())
                await seed_probe.event(
                    "contract_intent", {"attempt": attempt, "label": "schedule_dates"}
                )
                await seed_probe.event(
                    "contract_result",
                    {
                        "attempt": attempt,
                        "label": "schedule_dates",
                        "status": None if mode == "response_unsettled" else 204,
                    },
                )
                if mode == "target_drift":
                    observed = observed.model_copy(
                        update={
                            "baseline": observed.baseline.model_copy(
                                update={"targcompdate": finish + timedelta(days=1)}
                            )
                        }
                    )
                    current = observed.model_copy(deep=True)
                await seed_probe.event(
                    "contract_observation", {"evidence": observed.model_dump(mode="json")}
                )
                await seed_probe.finish("unknown")
                async with sessions.begin() as db:
                    if mode in {"foreign", "wrong_mode"}:
                        marker = await db.scalar(
                            select(AuditEvent).where(
                                AuditEvent.upload_item_id == seed_probe.item_id,
                                AuditEvent.event == "contract_probe",
                            )
                        )
                        if mode == "wrong_mode":
                            marker.details = {**marker.details, "field_mode": False}
                        else:
                            batch = await db.get(
                                UploadBatch, (await db.get(UploadItem, seed_probe.item_id)).batch_id
                            )
                            batch.actor_id = await db.scalar(
                                select(User.id).where(User.id != user.id)
                            )
                    if mode == "original_tamper":
                        stored = await db.get(UploadItem, seed_probe.item_id)
                        stored.before = {**stored.before, "estdur": "26"}
                if mode == "fresh_drift":
                    current = current.model_copy(
                        update={
                            "baseline": current.baseline.model_copy(
                                update={"estdur": Decimal("22")}
                            )
                        }
                    )
                if mode == "status_drift":
                    current = current.model_copy(update={"status": "WMATL"})
                if mode == "token_drift":
                    current = current.model_copy(update={"rowstamp_candidate": "104"})
                recovery = FieldContractProbe(
                    sessions,
                    settings,
                    client,
                    user.id,
                    connection.id,
                    "MECH",
                    "TEST",
                    "100",
                    operator_worktype="PM",
                )
                if mode.startswith("phase_"):
                    if mode != "phase_missing":
                        with pytest.raises(MaximoReadError):
                            await recovery.restore_field_item(seed_probe.item_id)
                        assert len(posts) == 1
                    second = FieldContractProbe(
                        sessions,
                        settings,
                        client,
                        user.id,
                        connection.id,
                        "MECH",
                        "TEST",
                        "100",
                        operator_worktype="PM",
                    )
                    if mode == "phase_exact":
                        result = await second.restore_field_item(
                            seed_probe.item_id, duration_phase=True
                        )
                        assert result["recovery_status"] == 204 and result["reservation_released"]
                        assert len(posts) == 2
                    else:
                        with pytest.raises(MaximoReadError):
                            await second.restore_field_item(seed_probe.item_id, duration_phase=True)
                        assert len(posts) == (
                            0 if mode == "phase_missing" else 2 if mode == "phase_timeout" else 1
                        )
                    if mode in {"phase_exact", "phase_timeout"}:
                        with pytest.raises(MaximoReadError):
                            await second.restore_field_item(seed_probe.item_id, duration_phase=True)
                        assert len(posts) == 2
                else:
                    if mode in {"exact", "etag_drift"}:
                        result = await recovery.restore_field_item(seed_probe.item_id)
                        assert (
                            result["recovery_status"] == 204
                            and result["original_state_exact"]
                            and result["reservation_released"]
                        )
                    else:
                        with pytest.raises(MaximoReadError):
                            await recovery.restore_field_item(seed_probe.item_id)
                    expected_post = mode in {
                        "exact",
                        "etag_drift",
                        "response_unknown",
                        "readback_mismatch",
                    }
                    assert len(posts) == int(expected_post)
                    if expected_post:
                        with pytest.raises(MaximoReadError):
                            await recovery.restore_field_item(seed_probe.item_id)
                        assert len(posts) == 1
                async with sessions() as db:
                    item = await db.get(UploadItem, seed_probe.item_id)
                    assert item.state == (
                        "failed" if mode in {"exact", "etag_drift", "phase_exact"} else "unknown"
                    )

    asyncio.run(main(), loop_factory=asyncio.SelectorEventLoop)
