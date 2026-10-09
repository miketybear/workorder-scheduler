import asyncio
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from test_maximo import config

from app.maximo.contract_probe import ContractEvidence, rowstamp_candidate
from app.maximo.reader import MaximoReadError
from app.maximo.write_contract_probe import (
    WriteContractProbe,
    duration_value,
    ibm_conflict_object,
    ibm_reason_code,
)
from app.scheduling.changes import WorkOrderBaseline


def evidence():
    return ContractEvidence(
        resource_path="/maximo/oslc/os/oslcmxwodetail/_TEST",
        resource_id="_TEST",
        advertised_origin_changed=False,
        site_id="TEST",
        workorder_id="100",
        wonum="W100",
        orgid="ORG",
        discipline="E&I",
        status="APPR",
        collection_etag_status="numeric_candidate",
        resource_etag_status="numeric_candidate",
        resource_etag="100",
        baseline=WorkOrderBaseline(worktype="CM", estdur=Decimal("2")),
    )


class FakeProbe(WriteContractProbe):
    def __init__(self, client):
        super().__init__(None, None, client, uuid4(), uuid4(), "E&I", "TEST", "100")
        self.config = config()
        self.current = evidence()
        self.events = []
        self.states = []

    async def authorize(self):
        return None

    async def read(self):
        return self.current.model_copy(deep=True)

    async def reserve(self, source):
        self.item_id = uuid4()

    async def event(self, name, details):
        self.events.append((name, details))

    async def finish(self, state):
        self.states.append(state)


def scenario(mode="normal", operator_worktype="CM"):
    async def execute():
        probe = None
        sent = []

        def handler(request):
            import json

            sent.append(request)
            label = probe.events[-1][1]["label"]
            assert probe.events[-1][0] == "contract_intent"
            assert request.method == "POST"
            assert request.headers["x-method-override"] == "PATCH"
            if mode == "timeout" and label == "fresh_token":
                raise httpx.ReadTimeout("hidden upstream detail")
            if mode in {"sentinel400", "body400"} and label == "wrong_token":
                return httpx.Response(
                    400,
                    json={
                        "Error": {"reasonCode": "BMXAA4198E", "message": "secret unrelated text"}
                    },
                )
            if (
                mode == "rowstamp_reject" and label == "candidate_support_noop"
            ) or mode == "diagnostic":
                return httpx.Response(
                    412,
                    json={
                        "Error": {
                            "reasonCode": "BMXAA8229W",
                            "message": "BMXAA8229W - Record WORKORDER : private-content",
                        }
                    },
                )
            bypass = (mode == "wrong_accepted" and label == "wrong_token") or (
                mode == "stale_accepted" and label == "stale_token"
            )
            current_token = (
                probe.current.rowstamp_candidate
                if probe.token_source != "advertised_etag"
                else probe.current.resource_etag
            )
            body_mode = probe.token_source == "rowstamp_body_candidate"
            payload = json.loads(request.content)
            if body_mode:
                assert "if-match" not in request.headers
                assert set(payload) == {"estdur", "_rowstamp"}
            supplied_token = payload["_rowstamp"] if body_mode else request.headers["if-match"]
            if supplied_token != current_token and not bypass:
                if body_mode:
                    return httpx.Response(
                        412
                        if mode in {"body_missing_mbo", "body_child"}
                        else (409 if mode == "body409" else 400),
                        json={
                            "Error": {
                                "reasonCode": "BMXAA8229W",
                                "message": (
                                    "Precondition failed"
                                    if mode == "body_missing_mbo"
                                    else "Record INVRESERVE : confidential"
                                    if mode == "body_child"
                                    else "Record WORKORDER : confidential"
                                ),
                            }
                        },
                    )
                return httpx.Response(412)
            if mode in {"reject", "strong_reject"} and label == "fresh_token":
                return httpx.Response(403)
            if mode != "bad_readback":
                value = Decimal(str(json.loads(request.content)["estdur"]))
                if mode == "paired_wrong_value" and label == "same_token_a":
                    value += Decimal("1")
                probe.current = probe.current.model_copy(
                    update={
                        "baseline": probe.current.baseline.model_copy(update={"estdur": value}),
                        (
                            "rowstamp_candidate"
                            if probe.token_source != "advertised_etag"
                            else "resource_etag"
                        ): str(int(current_token) + 1),
                    }
                )
            return httpx.Response(204)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            probe = FakeProbe(client)
            probe.operator_worktype = operator_worktype
            probe.current = probe.current.model_copy(
                update={
                    "worktype": operator_worktype,
                    "baseline": probe.current.baseline.model_copy(
                        update={"worktype": operator_worktype}
                    ),
                }
            )
            if mode == "diagnostic":
                probe.diagnostic_only = True
            if mode in {
                "rowstamp",
                "rowstamp_reject",
                "body",
                "body409",
                "body400",
                "body_missing_mbo",
                "body_child",
            }:
                probe.token_source = (
                    "rowstamp_body_candidate" if mode.startswith("body") else "rowstamp_candidate"
                )
                probe.current = probe.current.model_copy(
                    update={"rowstamp_candidate": "100", "resource_etag": "0"}
                )
            if mode == "strong_reject":
                probe.current = probe.current.model_copy(
                    update={
                        "resource_etag_status": "strong",
                        "resource_etag": '"100"',
                        "strong_etag": '"100"',
                    }
                )
            try:
                result = await probe.run()
            except MaximoReadError as error:
                result = str(error)
        return probe, sent, result

    return asyncio.run(execute())


@pytest.mark.parametrize("worktype", ["PM", "CFT", "REC", "OVERHAUL", "MoD", "General", "Routine"])
def test_explicit_typed_duration_contract_restores_and_never_sends_other_fields(worktype):
    import json

    probe, sent, result = scenario("body", worktype)
    assert result["verified"] and result["restored"]
    assert len(sent) == 7
    assert probe.current.baseline.worktype == worktype
    assert probe.current.baseline.estdur == Decimal("2")
    assert probe.states == ["confirmed"]
    assert all(set(json.loads(req.content)) == {"estdur", "_rowstamp"} for req in sent)
    intents = [details for name, details in probe.events if name == "contract_intent"]
    assert all(details["operator_worktype"] == worktype for details in intents)


@pytest.mark.parametrize("worktype", ["PM", "CFT"])
def test_pm_cft_targets_rejected_before_audit_or_outbound(worktype):
    async def execute():
        sent = []
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda req: sent.append(req))
        ) as client:
            probe = FakeProbe(client)
            probe.operator_worktype = worktype
            source = evidence().model_copy(
                update={
                    "worktype": worktype,
                    "baseline": evidence().baseline.model_copy(update={"worktype": worktype}),
                }
            )
            with pytest.raises(MaximoReadError, match="Target dates"):
                await probe.post_fields(
                    source, "100", {"targcompdate": "2026-10-31T00:00:00+07:00"}, "forbidden"
                )
            assert not sent and not probe.events

    asyncio.run(execute())


def test_typed_probe_requires_known_case_preserved_type_and_native_body():
    for worktype, token in [
        ("UNKNOWN", "rowstamp_body_candidate"),
        ("MOD", "rowstamp_body_candidate"),
        ("PM", "advertised_etag"),
    ]:
        with pytest.raises(MaximoReadError):
            WriteContractProbe(
                None,
                None,
                None,
                uuid4(),
                uuid4(),
                "E&I",
                "TEST",
                "100",
                token_source=token,
                operator_worktype=worktype,
            )


@pytest.mark.parametrize(
    "value",
    [None, True, False, -1, "not-number", "NaN", "Infinity", "1e1000", "1.0000000000000000001"],
)
def test_duration_validation_is_sanitized_finite_bounded_and_exact(value):
    with pytest.raises(MaximoReadError):
        duration_value(value)


@pytest.mark.parametrize("value", [1, 1.5, 1.25])
def test_exact_json_duration_values_remain_supported(value):
    assert duration_value(value) == value


@pytest.mark.parametrize("field_mode", [False, True])
@pytest.mark.parametrize(
    "value",
    [None, -1, True, False, 100001, float("nan"), float("inf"), "1.0000000000000000001", "2.25"],
)
def test_low_level_duration_guard_precedes_intent_and_network(value, field_mode):
    import json

    async def main():
        probe = FakeProbe(None)
        probe.field_mode = field_mode
        probe.field_plan = (("invalid", json.dumps({"estdur": value}, sort_keys=True)),)
        with pytest.raises(MaximoReadError):
            await probe.post_fields(evidence(), "100", {"estdur": value}, "invalid")
        assert not probe.events

    asyncio.run(main())


def test_probe_commits_each_intent_and_restores_original_with_fresh_token():
    probe, sent, result = scenario()
    assert result["verified"] and result["restored"]
    assert len(sent) == 6
    assert [r.headers["if-match"] for r in sent] == [
        "9223372036854775807",
        "100",
        "100",
        "101",
        "101",
        "102",
    ]
    assert probe.current.baseline == evidence().baseline
    assert probe.states == ["confirmed"]
    assert len({r.headers["transactionid"] for r in sent}) == len(sent)


@pytest.mark.parametrize(
    "mode,expected", [("timeout", "unknown"), ("bad_readback", "unknown"), ("reject", "failed")]
)
def test_probe_stops_without_retry_or_restore_on_unknown_or_rejected_write(mode, expected):
    probe, sent, result = scenario(mode)
    assert len(sent) == 2
    assert probe.states == [expected]
    assert not isinstance(result, dict) or not result["verified"]


def test_audit_failure_prevents_network_send():
    async def execute():
        sent = []
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda req: sent.append(req))
        ) as client:
            probe = FakeProbe(client)

            async def fail(name, details):
                raise RuntimeError("audit unavailable")

            probe.event = fail
            with pytest.raises(RuntimeError):
                await probe.post(evidence(), "100", Decimal("2.25"), "fresh")
        assert not sent

    asyncio.run(execute())


@pytest.mark.parametrize("mode,count", [("wrong_accepted", 1), ("stale_accepted", 4)])
def test_negative_noop_probes_do_not_leave_modified_data(mode, count):
    probe, sent, result = scenario(mode)
    assert len(sent) == count
    assert probe.states == ["failed"]
    assert not result["verified"]
    assert probe.current.baseline == evidence().baseline


def test_paired_readback_must_match_the_successful_request_not_other_candidate():
    probe, sent, result = scenario("paired_wrong_value")
    assert len(sent) == 5
    assert probe.states == ["unknown"]
    assert "successful request" in result
    failure = [details for name, details in probe.events if name == "contract_failure"]
    assert failure and "successful request" in failure[0]["reason"]


def test_sentinel_parser400_is_not_conditional_proof_and_logs_only_ibm_code():
    probe, sent, result = scenario("sentinel400")
    assert len(sent) == 1 and not result["verified"]
    assert probe.states == ["failed"]
    assert result["trace"][0]["ibm_reason_code"] == "BMXAA4198E"
    assert "secret" not in str(result) and "secret" not in str(probe.events)
    assert ibm_reason_code(b'{"Error":{"reasonCode":"secret string"}}') is None


def test_strong_etag_preserves_quoted_negative_token_candidate():
    probe, sent, result = scenario("strong_reject")
    assert [request.headers["if-match"] for request in sent] == [
        '"wos-deliberately-stale"',
        '"100"',
    ]
    assert not result["verified"] and probe.states == ["failed"]


def test_explicit_rowstamp_candidate_has_noop_support_check_then_full_conditional_proof():
    probe, sent, result = scenario("rowstamp")
    assert result["verified"] and result["restored"]
    assert [request.headers["if-match"] for request in sent] == [
        "9223372036854775807",
        "100",
        "101",
        "101",
        "102",
        "102",
        "103",
    ]
    assert probe.current.resource_etag == "0"
    assert probe.current.baseline == evidence().baseline
    assert all(
        details["token_source"] == "rowstamp_candidate"
        for name, details in probe.events
        if name == "contract_intent"
    )


def test_rejected_rowstamp_noop_support_check_stops_before_positive_duration_mutation():
    probe, sent, result = scenario("rowstamp_reject")
    assert len(sent) == 2 and result["reason"] == "rowstamp_support_rejected"
    assert probe.states == ["failed"] and probe.current.baseline == evidence().baseline


@pytest.mark.parametrize(
    "value,expected",
    [
        ("3235810749", "3235810749"),
        (42, "42"),
        (True, None),
        (0, None),
        ("001", None),
        ("-1", None),
        ("*", None),
        ("9" * 31, None),
    ],
)
def test_rowstamp_is_preserved_as_bounded_numeric_candidate_only(value, expected):
    assert rowstamp_candidate({"_rowstamp": value}) == expected


def test_diagnostic_only_sends_one_negative_noop_and_records_safe_mbo_not_message():
    probe, sent, result = scenario("diagnostic")
    assert len(sent) == 1 and result["reason"] == "diagnostic_only"
    assert result["unchanged"] and probe.states == ["failed"]
    assert probe.current.baseline == evidence().baseline
    assert result["trace"][0]["ibm_conflict_object"] == "WORKORDER"
    assert "private-content" not in str(probe.events) and "private-content" not in str(result)


@pytest.mark.parametrize(
    "message,expected",
    [
        ("Record INVRESERVE : confidential", "INVRESERVE"),
        ("Record SECRETLEAK : confidential", None),
        ("WORKORDER password=confidential", None),
    ],
)
def test_conflict_mbo_capture_only_emits_known_object_names(message, expected):
    import json

    assert (
        ibm_conflict_object(json.dumps({"Error": {"reasonCode": "BMXAA8229W", "message": message}}))
        == expected
    )


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-0.25", "100001"])
def test_duration_guard(value):
    with pytest.raises(MaximoReadError):
        duration_value(value)


@pytest.mark.parametrize("mode", ["body", "body409", "body_missing_mbo"])
def test_body_rowstamp_requires_exact_conflict_then_current_noop_and_restores(mode):
    import json

    probe, sent, result = scenario(mode)
    assert result["verified"] and result["restored"] and len(sent) == 7
    assert [json.loads(request.content)["estdur"] for request in sent] == [2, 2, 3, 3, 4, 5, 2]
    assert [json.loads(request.content)["_rowstamp"] for request in sent] == [
        "9223372036854775807",
        "100",
        "101",
        "101",
        "102",
        "102",
        "103",
    ]
    assert probe.current.baseline == evidence().baseline and probe.current.resource_etag == "0"
    intents = [details for name, details in probe.events if name == "contract_intent"]
    assert all(details["if_match"] is None for details in intents)
    assert all(details["precondition"]["channel"] == "json_body" for details in intents)
    assert all(set(details["changes"]) == {"estdur"} for details in intents)


def test_body_generic400_is_not_a_conditional_conflict():
    probe, sent, result = scenario("body400")
    assert len(sent) == 1 and result["reason"] == "wrong_token_not_conflict"
    assert probe.current.baseline == evidence().baseline


@pytest.mark.parametrize(
    "status,code,mbo,expected",
    [
        (400, "BMXAA8229W", "WORKORDER", True),
        (409, "BMXAA8229W", "WORKORDER", True),
        (412, "BMXAA8229W", "WORKORDER", True),
        (400, "BMXAA4198E", "WORKORDER", False),
        (400, "BMXAA8229W", "INVRESERVE", False),
        (403, "BMXAA8229W", "WORKORDER", False),
        (412, "BMXAA8229W", None, True),
        (412, "BMXAA8229W", "INVRESERVE", False),
        (400, "BMXAA8229W", None, False),
        (409, "BMXAA8229W", None, False),
        (412, "BMXAA4198E", None, False),
    ],
)
def test_body_conflict_classification_is_bounded_to_exact_record(status, code, mbo, expected):
    probe = FakeProbe(None)
    probe.token_source = "rowstamp_body_candidate"
    probe.trace = [{"label": "wrong_token", "ibm_reason_code": code, "ibm_conflict_object": mbo}]
    assert probe.conflict(status, "wrong_token") is expected


def test_body_412_child_conflict_stops_before_current_noop_or_duration_change():
    probe, sent, result = scenario("body_child")
    assert len(sent) == 1 and result["reason"] == "wrong_token_not_conflict"
    assert probe.current.baseline == evidence().baseline
