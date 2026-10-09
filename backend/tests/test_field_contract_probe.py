import asyncio
import json
from datetime import datetime

import httpx
import pytest
from test_write_contract_probe import FakeProbe, evidence

from app.maximo.field_contract_probe import FieldContractProbe, field_payload, recovery_payload
from app.maximo.reader import MaximoReadError


class FakeFieldProbe(FieldContractProbe, FakeProbe):
    def __init__(self, client):
        FakeProbe.__init__(self, client)
        self.token_source = "rowstamp_body_candidate"
        self.field_mode = True
        self.field_plan = ()
        dates = {
            field: datetime.fromisoformat("2026-10-01T18:06:00+07:00")
            for field in ("schedstart", "schedfinish", "targstartdate", "targcompdate")
        }
        self.current = evidence().model_copy(
            update={
                "rowstamp_candidate": "100",
                "resource_etag": "0",
                "baseline": evidence().baseline.model_copy(update=dates),
            }
        )

    async def crew(self):
        return frozenset({"VALID"})


def run_case(mode="normal", worktype="CM", null_schedule=False, original_pic=None):
    async def main():
        sent = []
        probe = None

        def handler(request):
            payload = json.loads(request.content)
            sent.append(payload)
            assert "if-match" not in request.headers
            if payload["_rowstamp"] != probe.current.rowstamp_candidate:
                return httpx.Response(412, json={"Error": {"reasonCode": "BMXAA8229W"}})
            fields = {field: value for field, value in payload.items() if field != "_rowstamp"}
            label = probe.events[-1][1]["label"]
            if mode == "null_rejected" and label == "original_null_pic_noop":
                return httpx.Response(400)
            if mode == "schedule_null_rejected" and label == "original_null_schedule_noop":
                return httpx.Response(400)
            if mode == "original_pic_rejected" and label == "original_pic_noop":
                return httpx.Response(400)
            if mode == "unrelated" and label == "fractional_duration":
                fields["assignedtechname"] = "VALID"
            if mode == "timeout" and "schedstart" in fields:
                raise httpx.ReadTimeout("private")
            if mode == "round" and fields.get("estdur") == 2.25:
                fields["estdur"] = 2
            if mode == "schedule_recalc" and label in {"schedule_dates", "schedule_dates_restore"}:
                fields["estdur"] = 21
            if mode == "null_schedule_recalc" and label == "original_null_schedule_noop":
                fields["estdur"] = 21
            if mode == "schedule_unrelated" and label == "schedule_dates":
                fields["assignedtechname"] = "VALID"
            if (
                mode == "schedule_duration_restore_mismatch"
                and label == "schedule_duration_restore"
            ):
                fields["estdur"] = 21
            from app.scheduling.changes import WorkOrderBaseline

            after = WorkOrderBaseline.model_validate(
                {**probe.current.baseline.model_dump(), **fields}
            )
            probe.current = probe.current.model_copy(
                update={
                    "baseline": after,
                    "rowstamp_candidate": str(int(probe.current.rowstamp_candidate) + 1),
                }
            )
            return httpx.Response(204)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            probe = FakeFieldProbe(client)
            probe.operator_worktype = worktype
            updates = {"worktype": worktype, "assignedtechname": original_pic}
            if null_schedule:
                updates.update(schedstart=None, schedfinish=None)
            probe.current = probe.current.model_copy(
                update={
                    "worktype": worktype,
                    "baseline": probe.current.baseline.model_copy(update=updates),
                }
            )
            original = probe.current.baseline
            if mode in {"null_rejected", "schedule_null_rejected", "original_pic_rejected"}:
                result = await probe.run()
                assert not result["verified"] and result["restored"]
                assert probe.current.baseline == original
                assert probe.states == ["failed"]
            elif mode in {
                "timeout",
                "unrelated",
                "null_schedule_recalc",
                "schedule_unrelated",
                "schedule_duration_restore_mismatch",
            }:
                with pytest.raises(MaximoReadError):
                    await probe.run()
                assert probe.states == ["unknown"]
            else:
                result = await probe.run()
                assert result["restored"] and probe.current.baseline == original
                assert result["verified"] == (mode in {"normal", "schedule_recalc"})
                assert probe.states == (
                    ["confirmed"] if mode in {"normal", "schedule_recalc"} else ["failed"]
                )
                if worktype == "CM" and not null_schedule and original_pic is None:
                    assert len(sent) == 12
                    assert sent[2]["assignedtechname"] is None
                    assert sent[8]["assignedtechname"] == "VALID"
                    assert sent[9]["assignedtechname"] is None
            return probe, sent

    return asyncio.run(main())


@pytest.mark.parametrize("null_schedule", [False, True])
def test_schedule_recalculation_recorded_and_separate_duration_original_restored(null_schedule):
    probe, sent = run_case("schedule_recalc", worktype="PM", null_schedule=null_schedule)
    assert probe.current.baseline.estdur == 2
    assert probe.states == ["confirmed"]
    readbacks = [details for name, details in probe.events if name == "field_contract_readback"]
    for label in ("schedule_dates", "schedule_dates_restore"):
        readback = next(details for details in readbacks if details["label"] == label)
        assert readback["schedule_dates_exact"] and readback["actual"]["estdur"] == "21"
    restored = next(
        details for details in readbacks if details["label"] == "schedule_duration_restore"
    )
    assert restored["exact"] and float(restored["actual"]["estdur"]) == 2
    assert any(payload.get("estdur") == 2 for payload in sent)


@pytest.mark.parametrize(
    "mode", ["null_schedule_recalc", "schedule_unrelated", "schedule_duration_restore_mismatch"]
)
def test_schedule_tolerance_never_accepts_noop_drift_unrelated_fields_or_failed_final_restore(mode):
    probe, sent = run_case(mode, worktype="PM", null_schedule=mode == "null_schedule_recalc")
    assert probe.states == ["unknown"]
    labels = [details["label"] for name, details in probe.events if name == "contract_intent"]
    assert "crew_pic" not in labels
    if mode == "null_schedule_recalc":
        assert len(sent) == 4 and "fractional_duration" not in labels
    elif mode == "schedule_unrelated":
        assert len(sent) == 6 and "schedule_dates_restore" not in labels
    else:
        assert "schedule_duration_restore" in labels and probe.current.baseline.estdur == 21


@pytest.mark.parametrize("worktype", ["PM", "CFT", "REC", "OVERHAUL", "MoD", "General", "Routine"])
@pytest.mark.parametrize("null_schedule", [False, True])
def test_typed_field_plan_exact_restore_and_forbidden_target_omission(worktype, null_schedule):
    probe, sent = run_case(worktype=worktype, null_schedule=null_schedule)
    assert probe.states == ["confirmed"]
    assert probe.current.baseline.worktype == worktype
    assert probe.current.baseline.assignedtechname is None
    if worktype in {"PM", "CFT"}:
        assert not any({"targstartdate", "targcompdate"} & payload.keys() for payload in sent)
    if null_schedule:
        assert probe.current.baseline.schedstart is probe.current.baseline.schedfinish is None
        assert sent[3]["schedstart"] is sent[3]["schedfinish"] is None
        assert any(payload.get("schedstart") is not None for payload in sent)


def test_original_outside_crew_pic_noop_then_exact_original_restore_only():
    probe, sent = run_case(worktype="MoD", null_schedule=True, original_pic="SONNA")
    assert sent[2]["assignedtechname"] == "SONNA"
    assert probe.current.baseline.assignedtechname == "SONNA"
    assert sum(payload.get("assignedtechname") == "SONNA" for payload in sent) == 2


@pytest.mark.parametrize(
    "mode,count", [("schedule_null_rejected", 4), ("original_pic_rejected", 3)]
)
def test_restore_support_rejection_stops_before_positive_changes(mode, count):
    probe, sent = run_case(
        mode,
        worktype="MoD",
        null_schedule=True,
        original_pic="SONNA" if mode == "original_pic_rejected" else None,
    )
    assert len(sent) == count
    assert not any(payload.get("estdur") == 2.25 for payload in sent)
    assert probe.current.baseline.schedstart is None


def test_null_restore_cannot_clear_nonnull_partial_schedule_or_targets():
    original = evidence().baseline
    for payload in (
        {"schedstart": None},
        {"targstartdate": None, "targcompdate": None},
        {"schedstart": None, "schedfinish": "2026-10-31T00:00:00+07:00"},
    ):
        with pytest.raises(MaximoReadError):
            field_payload(original, payload, {"VALID"}, original=original)
    nonnull = original.model_copy(update={"assignedtechname": "ORIGINAL"})
    with pytest.raises(MaximoReadError):
        field_payload(nonnull, {"assignedtechname": None}, {"VALID"}, original=nonnull)
    with pytest.raises(ValueError, match="PIC"):
        field_payload(nonnull, {"assignedtechname": "ARBITRARY"}, {"VALID"}, original=nonnull)


def test_field_mode_without_exact_immutable_plan_denies_before_outbound():
    async def main():
        probe = FakeFieldProbe(None)
        with pytest.raises(MaximoReadError, match="immutable"):
            await probe.post_fields(probe.current, "100", {"estdur": 3}, "unplanned")
        assert not probe.events

    asyncio.run(main())


def test_diagnostic_field_contract_denied_before_plan_or_reservation():
    from uuid import uuid4

    with pytest.raises(MaximoReadError, match="diagnostic-only"):
        FieldContractProbe(
            None, None, None, uuid4(), uuid4(), "E&I", "BD1", "100", diagnostic_only=True
        )

    async def main():
        probe = FakeFieldProbe(None)
        probe.diagnostic_only = True
        with pytest.raises(MaximoReadError, match="diagnostic-only"):
            await probe.run()
        assert not probe.events and not probe.states and probe.item_id is None

    asyncio.run(main())


def test_cli_diagnostic_field_combination_stops_before_async_runner(monkeypatch):
    import probe_write_contract

    monkeypatch.setattr(
        "sys.argv",
        [
            "probe_write_contract.py",
            "--user",
            "00000000-0000-0000-0000-000000000001",
            "--connection",
            "00000000-0000-0000-0000-000000000002",
            "--discipline",
            "E&I",
            "--site",
            "BD1",
            "--workorder-id",
            "100",
            "--field-contract",
            "--diagnostic-only",
        ],
    )
    monkeypatch.setattr(
        probe_write_contract.asyncio,
        "Runner",
        lambda **kwargs: pytest.fail("No network or reservation may start"),
    )
    with pytest.raises(SystemExit) as error:
        probe_write_contract.main()
    assert error.value.code == 2


@pytest.mark.parametrize(
    "extra",
    [
        [],
        ["--field-contract", "--diagnostic-only"],
        ["--field-contract", "--reconcile-item", "00000000-0000-0000-0000-000000000004"],
    ],
)
def test_cli_recovery_requires_explicit_exclusive_field_mode_before_runner(monkeypatch, extra):
    import probe_write_contract

    monkeypatch.setattr(
        "sys.argv",
        [
            "probe_write_contract.py",
            "--user",
            "00000000-0000-0000-0000-000000000001",
            "--connection",
            "00000000-0000-0000-0000-000000000002",
            "--discipline",
            "E&I",
            "--site",
            "BD1",
            "--workorder-id",
            "100",
            "--restore-field-item",
            "00000000-0000-0000-0000-000000000003",
            *extra,
        ],
    )
    monkeypatch.setattr(
        probe_write_contract.asyncio,
        "Runner",
        lambda **kwargs: pytest.fail("No recovery network or reservation may start"),
    )
    with pytest.raises(SystemExit) as error:
        probe_write_contract.main()
    assert error.value.code == 2


def test_recovery_null_schedule_includes_exact_original_duration_and_no_targets():
    from decimal import Decimal

    original = evidence().baseline.model_copy(update={"worktype": "PM", "estdur": Decimal("25")})
    current = original.model_copy(
        update={
            "schedstart": datetime.fromisoformat("2026-10-01T07:00:00+07:00"),
            "schedfinish": datetime.fromisoformat("2026-10-02T07:00:00+07:00"),
            "estdur": Decimal("21"),
        }
    )
    assert recovery_payload(original, current, set()) == {
        "schedstart": None,
        "schedfinish": None,
        "estdur": 25.0,
    }
    drift = current.model_copy(
        update={"targcompdate": datetime.fromisoformat("2026-10-31T00:00:00+07:00")}
    )
    with pytest.raises(MaximoReadError, match="target drift"):
        recovery_payload(original, drift, set())


@pytest.mark.parametrize(
    "payload",
    [
        {"assignedtechname": "VALID"},
        {"assignedtechname": None},
        {"schedstart": None, "schedfinish": None},
        {"schedstart": "2026-10-01T00:00:00+07:00"},
    ],
)
def test_cm_duration_mode_cannot_bypass_unplanned_field_boundary(payload):
    async def main():
        probe = FakeProbe(None)
        with pytest.raises(MaximoReadError, match="duration evidence only"):
            await probe.post_fields(evidence(), "100", payload, "unplanned")
        assert not probe.events

    asyncio.run(main())


@pytest.mark.parametrize("mode", ["normal", "round", "timeout", "null_rejected", "unrelated"])
def test_field_proof_records_normalization_restores_each_case_and_stops_unknown(mode):
    probe, sent = run_case(mode)
    assert len([event for event in probe.events if event[0] == "contract_intent"]) == len(sent)
    if mode == "timeout":
        assert len(sent) == 6
    if mode == "null_rejected":
        assert len(sent) == 3 and not any(p.get("assignedtechname") for p in sent)
    if mode == "unrelated":
        assert len(sent) == 4 and probe.current.baseline.assignedtechname == "VALID"
    if mode == "round":
        readback = next(
            details
            for name, details in probe.events
            if name == "field_contract_readback" and details["label"] == "fractional_duration"
        )
        assert readback["actual"]["estdur"] == "2" and not readback["exact"]


@pytest.mark.parametrize("worktype", ["PM", "CFT"])
def test_target_intent_denied_before_any_field_send_for_pm_cft(worktype):
    baseline = evidence().baseline.model_copy(update={"worktype": worktype})
    with pytest.raises(ValueError, match="PM or CFT"):
        field_payload(
            baseline,
            {
                "targstartdate": "2026-10-01T18:06:00+07:00",
                "targcompdate": "2026-10-02T18:06:00+07:00",
            },
            set(),
            target_intent=True,
        )


def test_field_boundary_denies_unscoped_pic_target_without_intent_and_null_without_original():
    baseline = evidence().baseline
    with pytest.raises(ValueError, match="PIC"):
        field_payload(baseline, {"assignedtechname": "OUTSIDE"}, {"VALID"})
    with pytest.raises(ValueError, match="explicit intent"):
        field_payload(baseline, {"targstartdate": "2026-10-01T18:06:00+07:00"}, set())
    with pytest.raises(MaximoReadError, match="original null"):
        field_payload(baseline, {"assignedtechname": None}, set())
    with pytest.raises(ValueError):
        field_payload(baseline, {"schedstart": "2026-10-01T18:06:00"}, set())
    with pytest.raises(ValueError):
        field_payload(baseline, {"status": "COMP"}, set())


def test_low_level_probe_six_field_allowlist_denies_before_auth_or_network():
    async def main():
        probe = FakeProbe(None)
        with pytest.raises(MaximoReadError, match="allowlist"):
            await probe.post_fields(evidence(), "100", {"status": "COMP"}, "invalid")
        assert probe.events == []

    asyncio.run(main())


@pytest.mark.parametrize("worktype", ["PM", "CFT"])
def test_pm_cft_target_outbound_pipeline_denies_before_intent_or_post(worktype):
    async def main():
        probe = FakeFieldProbe(None)
        probe.current = probe.current.model_copy(
            update={"baseline": probe.current.baseline.model_copy(update={"worktype": worktype})}
        )
        probe.original = probe.current
        with pytest.raises(ValueError, match="PM or CFT"):
            await probe.change(
                probe.current,
                {"targstartdate": datetime.fromisoformat("2026-10-01T19:00:00+07:00")},
                "invalid",
                target_intent=True,
            )
        assert probe.events == []

    asyncio.run(main())
