import asyncio
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
        "assignedtechname": "TEST-PIC",
        "estdur": 8,
        **overrides,
    }


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
        {"lochierarchy": [{"systemid": "A"}, {"systemid": "B"}]},
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
