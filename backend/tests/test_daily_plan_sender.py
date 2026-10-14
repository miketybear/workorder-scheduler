import asyncio
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app.maximo.daily_plan_sender import (
    PROTECTED,
    build_daily_intent,
    read_daily_target,
    reconcile_daily_intent,
    send_daily_intent,
)
from app.maximo.reader import MaximoReadError
from tests.test_maximo import config


def fixture():
    source = {k: None for k in PROTECTED}
    source.update(
        assignmentid=1,
        craft="E&I",
        skilllevel="TECH",
        wplaborid="P1",
        orgid="ORG",
        parentassignid=0,
        status="WAITASGN",
        laborhrs=5,
        _rowstamp="10",
    )
    sibling = {**source, "assignmentid": 2, "wplaborid": "0", "skilllevel": None, "_rowstamp": "20"}
    target = {"resource_id": "_TEST", "root_revision": "30", "assignments": [source, sibling]}
    segments = [
        dict(
            date="2026-10-03",
            scheduled_start="2026-10-03T06:30:00+07:00",
            minutes=150,
            laborcode="LAB",
        ),
        dict(
            date="2026-10-04",
            scheduled_start="2026-10-04T06:30:00+07:00",
            minutes=150,
            laborcode="LAB",
        ),
    ]
    return target, segments


def confirmed_target(target):
    source = {
        **target["assignments"][0],
        "laborcode": "LAB",
        "status": "ASSIGNED",
        "laborhrs": 2.5,
        "scheduledate": "2026-10-03T06:30:00+07:00",
        "finishdate": "2026-10-03T09:00:00+07:00",
        "_rowstamp": "100",
    }
    child = {
        **source,
        "assignmentid": 3,
        "scheduledate": "2026-10-04T06:30:00+07:00",
        "finishdate": "2026-10-04T09:00:00+07:00",
        "_rowstamp": "101",
    }
    return {
        **target,
        "root_revision": "102",
        "assignments": [source, target["assignments"][1], child],
    }


def test_first_id_is_retained_later_rows_only_add_and_no_parent_grouping():
    target, segments = fixture()
    intent = build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")
    first, second = intent["payload"]["assignment"]
    assert first["assignmentid"] == 1 and first["_rowstamp"] == "10"
    assert (
        second["_action"] == "Add"
        and "assignmentid" not in second
        and "parentassignid" not in second
    )
    assert all(row.get("assignmentid") != 2 for row in intent["payload"]["assignment"])
    assert first["laborhrs"] + second["laborhrs"] == 5


def test_one_day_plan_retains_source_without_creating_any_child():
    target, segments = fixture()
    segments = [{**segments[0], "minutes": 300}]
    intent = build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")
    assert len(intent["payload"]["assignment"]) == 1
    assert intent["payload"]["assignment"][0]["assignmentid"] == 1
    after = confirmed_target(target)
    after["assignments"].pop()
    after["assignments"][0].update(laborhrs=5, finishdate="2026-10-03T11:30:00+07:00")
    assert reconcile_daily_intent(intent, after)["mapping"] == [
        {"date": "2026-10-03", "assignment_id": "1"}
    ]


@pytest.mark.parametrize("fault", ["midnight", "long_window"])
def test_business_date_boundaries(fault):
    target, segments = fixture()
    if fault == "midnight":
        segments[0]["scheduled_start"] = "2026-10-03T23:00:00+07:00"
    else:
        segments[1].update(date="2027-10-04", scheduled_start="2027-10-04T06:30:00+07:00")
    with pytest.raises(ValueError):
        build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")


def test_rounded_non_hour_minutes_readback_remains_unknown():
    target, segments = fixture()
    segments[0]["minutes"], segments[1]["minutes"] = 151, 149
    intent = build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")
    after = confirmed_target(target)
    after["assignments"][0].update(laborhrs=2.5167, finishdate="2026-10-03T09:01:00+07:00")
    after["assignments"][-1].update(laborhrs=2.4833, finishdate="2026-10-04T08:59:00+07:00")
    assert reconcile_daily_intent(intent, after)["state"] == "unknown"


@pytest.mark.parametrize(
    "fault", [None, "revision", "missing_required", "partial_relation", "moved"]
)
def test_full_reader_normalizes_only_explicitly_selected_nullable_fields(monkeypatch, fault):
    target, _ = fixture()
    target["assignment"] = target["assignments"][0]
    raw = {
        "siteid": "SITE",
        "workorderid": 123,
        "_rowstamp": "30",
        "assignment": [
            {k: v for k, v in row.items() if v is not None} for row in target["assignments"]
        ],
    }
    if fault == "revision":
        raw["_rowstamp"] = True
    if fault == "missing_required":
        del raw["assignment"][0]["orgid"]
    if fault == "partial_relation":
        raw["assignment_collectionref"] = "unread"
    if fault == "moved":
        raw["siteid"] = "OTHER"

    async def fake_target(*args):
        return deepcopy(target)

    async def fake_collection(client, settings, params, validate):
        assert all(k in params["oslc.select"] for k in PROTECTED)
        assert params["_dropnulls"] == "0"
        normalized, _ = validate(raw)
        return [normalized]

    monkeypatch.setattr("app.maximo.daily_plan_sender.read_target", fake_target)
    monkeypatch.setattr("app.maximo.daily_plan_sender.read_collection", fake_collection)
    if fault:
        with pytest.raises(MaximoReadError):
            asyncio.run(read_daily_target(None, None, "SITE", "123", "1", "E&I"))
    else:
        assert (
            asyncio.run(read_daily_target(None, None, "SITE", "123", "1", "E&I"))["assignments"]
            == target["assignments"]
        )


@pytest.mark.parametrize(
    "fault",
    [
        "over",
        "zero",
        "bool",
        "duplicate_day",
        "naive",
        "wrong_day",
        "total",
        "incomplete",
        "unsafe_root",
    ],
)
def test_invalid_daily_contract_is_rejected_before_sending(fault):
    target, segments = fixture()
    if fault == "over":
        segments[0]["minutes"] = 631
    if fault == "zero":
        segments[0]["minutes"] = 0
    if fault == "bool":
        segments[0]["minutes"] = True
    if fault == "duplicate_day":
        segments[1]["date"] = segments[0]["date"]
    if fault == "naive":
        segments[0]["scheduled_start"] = "2026-10-03T06:30:00"
    if fault == "wrong_day":
        segments[0]["scheduled_start"] = "2026-10-02T06:30:00+07:00"
    if fault == "total":
        segments[0]["minutes"] = 149
    if fault == "incomplete":
        del target["assignments"][1]["parentassignid"]
    if fault == "unsafe_root":
        target["resource_id"] = "../OTHER"
    with pytest.raises(ValueError):
        build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")


def test_exact_readonly_mapping_survives_response_loss_and_enforces_saved_ids():
    target, segments = fixture()
    intent = build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")
    after = confirmed_target(target)
    result = reconcile_daily_intent(intent, after)
    assert result == {
        "state": "confirmed",
        "reason": None,
        "mapping": [
            {"date": "2026-10-03", "assignment_id": "1"},
            {"date": "2026-10-04", "assignment_id": "3"},
        ],
    }
    assert reconcile_daily_intent(intent, after, result["mapping"])["state"] == "confirmed"
    after["assignments"][-1]["assignmentid"] = 4
    assert reconcile_daily_intent(intent, after, result["mapping"])["state"] == "unknown"


@pytest.mark.parametrize(
    "field",
    [
        "assignmentid",
        "parentassignid",
        "skilllevel",
        "wplaborid",
        "orgid",
        "laborhrs",
        "status",
        "_rowstamp",
    ],
)
def test_full_untouched_sibling_including_revision_must_not_change(field):
    target, segments = fixture()
    intent = build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")
    after = deepcopy(confirmed_target(target))
    after["assignments"][1][field] = 999
    assert reconcile_daily_intent(intent, after)["state"] == "unknown"


@pytest.mark.parametrize(
    "fault",
    ["missing_child", "extra_child", "missing_source", "wrong_child", "partial", "incomplete"],
)
def test_partial_or_ambiguous_results_stay_unknown_without_a_mapping(fault):
    target, segments = fixture()
    intent = build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")
    after = deepcopy(confirmed_target(target))
    if fault == "missing_child":
        after["assignments"].pop()
    if fault == "extra_child":
        after["assignments"].append({**after["assignments"][-1], "assignmentid": 4})
    if fault == "missing_source":
        after["assignments"].pop(0)
    if fault == "wrong_child":
        after["assignments"][-1]["laborhrs"] = 2.6
    if fault == "partial":
        after["assignments"][0] = target["assignments"][0]
    if fault == "incomplete":
        del after["assignments"][-1]["finishdate"]
    result = reconcile_daily_intent(intent, after)
    assert result["state"] == "unknown" and result["mapping"] is None


def test_transport_unknown_never_sends_a_second_request():
    async def scenario():
        target, segments = fixture()
        intent = build_daily_intent(target, 1, segments, "Asia/Ho_Chi_Minh")
        calls = []

        def transport(request):
            calls.append(request)
            raise httpx.ReadTimeout("Synthetic response loss")

        settings = config(
            collection_url="https://maximo.invalid/maximo/oslc/os/BDSCHED_WO",
            assignment_write_contract="native_assignment_rowstamp_test",
        )
        connection = SimpleNamespace(enabled=True, system="onshore", environment="test")
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            assert (
                await send_daily_intent(
                    client, settings, connection, intent, uuid4(), app_environment="test"
                )
                == "unknown"
            )
            assert len(calls) == 1
            result = reconcile_daily_intent(intent, confirmed_target(target))
            assert result["state"] == "confirmed" and len(calls) == 1
            with pytest.raises(ValueError):
                await send_daily_intent(
                    client, settings, connection, intent, uuid4(), app_environment="production"
                )
            assert len(calls) == 1

    asyncio.run(scenario())
