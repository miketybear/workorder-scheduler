import asyncio
from uuid import uuid4

import httpx
import pytest
from test_maximo import config

from app.maximo.labor import read_labor
from app.maximo.reader import MaximoReadError


def record(**changes):
    return {
        "orgid": "BDPOC",
        "status": "ACTIVE",
        "laborcode": "LAB1",
        "personid": "P1",
        "person": [{"displayname": "Synthetic Person"}],
        "laborcraftrate": [
            {"craft": "RES", "defaultcraft": True},
            {"craft": "RES", "defaultcraft": 1},
        ],
        **changes,
    }


def run(body):
    async def scenario():
        def handle(request):
            assert request.method == "GET"
            assert request.url.path.endswith("/mxlabor")
            assert 'orgid="BDPOC"' in request.url.params["oslc.where"]
            assert "person{displayname,title}" in request.url.params["oslc.select"]
            return httpx.Response(200, json=body)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            return await read_labor(client, config(), uuid4(), "BDPOC")

    return asyncio.run(scenario())


def test_default_craft_deduplicated():
    rows = run({"member": [record()]})
    assert rows[0]["default_crafts"] == ["RES"]


@pytest.mark.parametrize("title", [None, "", "  Production Technician  ", "Material Controller"])
def test_person_title_preserved(title):
    rows = run({"member": [record(person=[{"displayname": "Synthetic", "title": title}])]})
    assert rows[0]["title"] == title


@pytest.mark.parametrize("title", [5, False, [], {}, "x" * 201])
def test_malformed_person_title_rejected(title):
    with pytest.raises(MaximoReadError, match="title"):
        run({"member": [record(person=[{"displayname": "Synthetic", "title": title}])]})


@pytest.mark.parametrize(
    "change",
    [
        {"orgid": "OTHER"},
        {"status": "INACTIVE"},
        {"person": []},
        {"laborcraftrate": [{"craft": "RES", "defaultcraft": "false"}]},
    ],
)
def test_scope_and_relationships_fail_closed(change):
    with pytest.raises(MaximoReadError):
        run({"member": [record(**change)]})


def test_foreign_paging_never_followed():
    with pytest.raises(MaximoReadError, match="Unsafe paging"):
        run({"member": [record()], "responseInfo": {"nextPage": "https://other.invalid/mxlabor"}})


def test_partial_collection_count_is_not_accepted():
    with pytest.raises(MaximoReadError, match="Incomplete LABOR"):
        run({"member": [record()], "responseInfo": {"totalCount": 2}})


def test_duplicate_labor_identity_is_not_accepted():
    with pytest.raises(MaximoReadError, match="Duplicate LABOR"):
        run({"member": [record(), record()]})
