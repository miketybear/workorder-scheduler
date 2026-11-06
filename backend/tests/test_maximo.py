import asyncio
import json
from datetime import datetime

import httpx
import pytest
from pydantic import ValidationError

from app.config import MaximoSettings
from app.maximo.reader import MaximoReadError, map_work_order, read_open_orders

START = datetime.fromisoformat("2026-09-01T00:00:00+07:00")
END = datetime.fromisoformat("2026-10-01T00:00:00+07:00")


def config(**overrides):
    return MaximoSettings(
        **{
            "collection_url": "https://maximo.invalid/maximo/oslc/os/oslcmxwodetail",
            "api_key": "synthetic-test-key",
            "open_statuses": ["APPR", "SCHED", "WMATL"],
            **overrides,
        }
    )


def record(**overrides):
    return {
        "siteid": "TEST",
        "workorderid": 100,
        "wonum": "DEMO-100",
        "bdpocdiscipline": "E&I",
        "worktype": "CM",
        "status": "APPR",
        "targcompdate": "2026-09-30T23:59:59+07:00",
        "istask": False,
        "parent": None,
        "wolo10": 25,
        "lochierarchy": {"systemid": "SYS"},
        "assignedto": "TEST-PIC",
        "estdur": 8,
        **overrides,
    }


def scheduled_record(**overrides):
    """A WO the schedule gate accepts on any date these fixtures use."""
    return record(
        **{
            "schedstart": "2020-01-01T08:00:00+07:00",
            "schedfinish": "2035-12-31T17:00:00+07:00",
            **overrides,
        }
    )


def run_reader(handler, settings=None, discipline="E&I"):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await read_open_orders(client, settings or config(), discipline, START, END)

    return asyncio.run(scenario())


def test_paging_maps_workbook_fields_and_reapplies_scope():
    calls = []

    def handler(request):
        calls.append(request)
        assert request.method == "GET"
        assert request.headers["apikey"] == "synthetic-test-key"
        assert "apikey" not in str(request.url)
        assert 'bdpocdiscipline="E&I"' in request.url.params["oslc.where"]
        assert 'parent!="*"' in request.url.params["oslc.where"]
        assert 'status in ["APPR","SCHED","WMATL"]' in request.url.params["oslc.where"]
        assert request.url.params["oslc.orderBy"] == "+siteid,+workorderid"
        if len(calls) == 1:
            return httpx.Response(
                200,
                json={
                    "member": [record()],
                    "responseInfo": {"nextPage": {"href": "?pageno=2"}, "totalCount": 99999},
                },
            )
        return httpx.Response(200, json={"member": [record(siteid="OTHER", description=None)]})

    orders = run_reader(handler)
    assert len(orders) == len(calls) == 2
    assert orders[0].systemid == "SYS" and orders[0].wolo10 == 25
    assert orders[0].workorderid == "100" and orders[1].siteid == "OTHER"
    assert orders[0].schedstart is None and orders[1].description is None


@pytest.mark.parametrize(
    "link",
    [
        "https://evil.invalid/maximo/oslc/os/oslcmxwodetail?pageno=2",
        "http://maximo.invalid/maximo/oslc/os/oslcmxwodetail?pageno=2",
        "/maximo/oslc/os/mxperson?pageno=2",
        "?oslc.where=bdpocdiscipline%3DOTHER",
        "?apikey=stolen",
        "?pageno=2&pageno=3",
        "?savedQuery=all",
        "?pageno=2#secret",
        "/maximo/oslc/os/%6fslcmxwodetail?pageno=2",
    ],
)
def test_unsafe_next_page_never_receives_credentials(link):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"member": [], "responseInfo": {"nextPage": link}})

    with pytest.raises(MaximoReadError):
        run_reader(handler)
    assert len(calls) == 1


@pytest.mark.parametrize(
    "overrides",
    [
        {"bdpocdiscipline": "ELEC"},
        {"status": "CLOSE"},
        {"istask": True},
        {"parent": "PARENT"},
        {"targcompdate": "2026-10-01T00:00:00+07:00"},
        {"targcompdate": "2026-09-01T00:00:00"},
        {"siteid": None},
        {"workorderid": True},
        {"wolo10": 101},
        {"estdur": "NaN"},
    ],
)
def test_invalid_or_out_of_scope_records_fail_whole_result(overrides):
    with pytest.raises(MaximoReadError):
        run_reader(lambda request: httpx.Response(200, json={"member": [record(**overrides)]}))


@pytest.mark.parametrize("status", [301, 302, 401, 403, 429, 500])
def test_upstream_errors_redacted_and_not_retried(status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status, text="private-secret", headers={"location": "https://evil.invalid"}
        )

    with pytest.raises(MaximoReadError) as error:
        run_reader(handler)
    assert "private" not in str(error.value) and len(calls) == 1


@pytest.mark.parametrize("kind", ["loop", "duplicate", "limit", "bytes", "json", "timeout"])
def test_incomplete_results_are_never_returned_as_success(kind):
    settings = config(max_pages=1) if kind == "limit" else config()

    def handler(request):
        if kind == "timeout":
            raise httpx.ReadTimeout("private-secret")
        if kind == "json":
            return httpx.Response(200, text="login page")
        if kind == "bytes":
            return httpx.Response(200, content=b"x" * (settings.max_page_bytes + 1))
        rows = [record(), record()] if kind == "duplicate" else []
        return httpx.Response(200, json={"member": rows, "responseInfo": {"nextPage": "?pageno=2"}})

    with pytest.raises(MaximoReadError):
        run_reader(handler, settings)


def test_empty_response_and_optional_relationship():
    assert run_reader(lambda request: httpx.Response(200, json={"member": []})) == []
    assert map_work_order(record(lochierarchy=[])).systemid is None
    several = [{"systemid": "B"}, {"systemid": "A"}, {"systemid": "A"}]
    assert map_work_order(record(lochierarchy=several)).systemid == "A, B"


def test_filter_injection_is_rejected_before_request():
    def handler(request):
        pytest.fail("Unexpected request")

    with pytest.raises(MaximoReadError):
        run_reader(handler, discipline='MECH" or status="APPR')


@pytest.mark.parametrize(
    "url",
    [
        "http://host/maximo/oslc/os/oslcmxwodetail",
        "https://user:secret@host/maximo/oslc/os/oslcmxwodetail",
        "https://host/arbitrary",
        "https://host/maximo/oslc/os/oslcmxwodetail?apikey=secret",
    ],
)
def test_connection_requires_explicit_safe_https_collection(url):
    with pytest.raises(ValidationError):
        config(collection_url=url)


def test_rejection_message_is_bounded_and_drops_urls():
    from app.maximo.sender import rejection_message

    body = {"Error": {"message": "BMXAA4589E Not allowed\nsee http://host/x " + "a" * 400}}
    message = rejection_message(json.dumps(body))
    assert message.startswith("BMXAA4589E Not allowed see a")
    assert "http" not in message and len(message) == 300
    assert rejection_message("not json") is None
    assert rejection_message('{"Error": {"reasonCode": "X"}}') is None


def two_step_transport(monkeypatch, second=None, fresh_change=None):
    import uuid
    from types import SimpleNamespace

    from app.maximo import sender as module
    from app.scheduling.changes import WorkOrderBaseline
    from app.scheduling.drafts import WorkOrderKey

    baseline = WorkOrderBaseline(
        worktype="CM",
        estdur=15,
        assignedto="LAMTH",
        schedstart="2026-11-01T06:30:00+07:00",
        schedfinish="2026-11-02T16:00:00+07:00",
    )
    key = WorkOrderKey(uuid.uuid4(), "BD1", "1")
    transport = module.NativeTestTransport(None, None, key.connection_id, "E&I", None)
    transport.attempt_id = uuid.uuid4()
    transport.evidence[key] = SimpleNamespace(
        worktype="CM", baseline=baseline, rowstamp_candidate="10", resource_id="res"
    )
    sent = []

    async def authorize():
        return object()

    async def pics(*_):
        return frozenset()

    async def post(config, resource, body, transaction_id=None):
        sent.append((body, str(transaction_id or transport.attempt_id)))
        transport.outcome = {
            "transaction_id": sent[-1][1],
            "status": 204,
            "ibm_reason_code": None,
            "ibm_conflict_object": None,
        }
        if len(sent) == 2 and second:
            transport.outcome["status"] = 400
            raise second

    async def probe(*_, **__):
        held = baseline.model_copy(
            update={"schedfinish": datetime.fromisoformat(sent[0][0]["schedfinish"])}
        )
        return SimpleNamespace(
            baseline=held.model_copy(update=fresh_change or {}),
            rowstamp_candidate="11",
            resource_id="res",
        )

    transport.authorize, transport._post = authorize, post
    monkeypatch.setattr(module, "read_pics", pics)
    monkeypatch.setattr(module, "probe_contract", probe)
    return transport, key, sent


LATER = {
    "schedstart": "2026-11-03T06:30:00+07:00",
    "schedfinish": "2026-11-04T16:00:00+07:00",
}


def test_a_later_schedule_sends_finish_first_then_the_rest_on_the_fresh_rowstamp(monkeypatch):
    import asyncio

    transport, key, sent = two_step_transport(monkeypatch)
    asyncio.run(transport.write(key, "10", LATER))
    assert [sorted(body) for body, _ in sent] == [
        ["_rowstamp", "schedfinish"],
        ["_rowstamp", "schedstart"],
    ]
    assert [body["_rowstamp"] for body, _ in sent] == ["10", "11"]
    assert sent[0][1] != sent[1][1]
    assert [step["fields"] for step in transport.outcome["steps"]] == [
        ["schedfinish"],
        ["schedstart"],
    ]


def test_an_overlapping_schedule_stays_one_post(monkeypatch):
    import asyncio

    transport, key, sent = two_step_transport(monkeypatch)
    overlap = {**LATER, "schedstart": "2026-11-02T06:30:00+07:00"}
    asyncio.run(transport.write(key, "10", overlap))
    assert len(sent) == 1 and set(sent[0][0]) == {"schedstart", "schedfinish", "_rowstamp"}


def test_an_earlier_schedule_sends_start_first():
    from types import SimpleNamespace

    from app.maximo.sender import first_date_field

    held = SimpleNamespace(
        schedstart=datetime.fromisoformat("2026-11-10T06:30:00+07:00"),
        schedfinish=datetime.fromisoformat("2026-11-11T16:00:00+07:00"),
    )
    new_start = datetime.fromisoformat("2026-11-01T06:30:00+07:00")
    new_finish = datetime.fromisoformat("2026-11-02T16:00:00+07:00")
    assert first_date_field(held, new_start, new_finish) == "schedstart"


def test_a_rejected_second_post_returns_for_read_back_and_records_both_steps(monkeypatch):
    import asyncio

    from app.scheduling.upload_service import WriteRejected

    transport, key, sent = two_step_transport(monkeypatch, second=WriteRejected())
    asyncio.run(transport.write(key, "10", LATER))
    assert len(sent) == 2
    assert [step["status"] for step in transport.outcome["steps"]] == [204, 400]


def test_a_change_between_the_posts_stops_the_second(monkeypatch):
    import asyncio

    transport, key, sent = two_step_transport(monkeypatch, fresh_change={"assignedto": "OTHER"})
    asyncio.run(transport.write(key, "10", LATER))
    assert len(sent) == 1
    assert transport.outcome["status"] == 204
