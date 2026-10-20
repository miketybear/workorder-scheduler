import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from test_maximo import config, record

from app.maximo.detail import read_detail, read_pic_names, read_pics
from app.maximo.reader import MaximoReadError
from app.scheduling.drafts import WorkOrderKey


@pytest.mark.parametrize("fault", [None, "site", "discipline", "duplicate", "missing"])
def test_detail_identity_and_missing_work_order(fault):
    async def scenario():
        row = record()
        if fault == "site":
            row["siteid"] = "OTHER"
        if fault == "discipline":
            row["bdpocdiscipline"] = "OTHER"
        rows = [] if fault == "missing" else [row, row] if fault == "duplicate" else [row]

        def handler(request):
            assert 'siteid="TEST"' in request.url.params["oslc.where"]
            assert "workorderid=100" in request.url.params["oslc.where"]
            return httpx.Response(200, json={"member": rows})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await read_detail(
                client, config(), WorkOrderKey(uuid4(), "TEST", "100"), "E&I"
            )
            assert (result is None) == (fault == "missing")

    if fault in {"site", "discipline", "duplicate"}:
        with pytest.raises(MaximoReadError):
            asyncio.run(scenario())
    else:
        asyncio.run(scenario())


@pytest.mark.parametrize(
    "fault", [None, "path", "userinfo", "query", "traversal", "child", "paging"]
)
def test_crew_relation_stays_on_configured_origin_and_reads_all_pages(fault):
    async def scenario():
        settings = config(crew_groups={"E&I": "CREW-EI"})
        parent = "https://advertised.invalid/maximo/oslc/os/mxpersongroup/_CREW"
        relation = parent + "/allpersongroupteam"
        if fault == "path":
            relation = parent + "/otherteam"
        elif fault == "userinfo":
            relation = relation.replace("advertised.invalid", "user@advertised.invalid")
        elif fault == "query":
            relation += "?savedQuery=all"
        elif fault == "traversal":
            parent = parent.replace("_CREW", "..")
            relation = parent + "/allpersongroupteam"
        calls = []

        def handler(request):
            calls.append(request)
            assert request.url.host == "maximo.invalid"
            assert request.headers["apikey"] == "synthetic-test-key"
            if request.url.path.endswith("/mxpersongroup"):
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            {
                                "persongroup": "CREW-EI",
                                "href": parent,
                                "persongroupteam": [{"respparty": "INCOMPLETE-INLINE"}],
                                "persongroupteam_collectionref": relation,
                            }
                        ]
                    },
                )
            page = request.url.params.get("pageno", "1")
            localref = parent + "/allpersongroupteam/" + page
            if fault == "child":
                localref = parent + "/otherteam/1"
            info = {} if page == "2" else {"nextPage": "?pageno=2"}
            if fault == "paging":
                info = {
                    "nextPage": "https://evil.invalid/maximo/oslc/os/mxpersongroup/_CREW/allpersongroupteam?pageno=2"
                }
            return httpx.Response(
                200,
                json={
                    "member": [
                        {"respparty": "TECH" + page, "localref": localref, "href": "#fragment"}
                    ],
                    "responseInfo": info,
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await read_pics(client, settings, "E&I")
            assert result == frozenset({"TECH1", "TECH2"})
            assert len(calls) == 3

    if fault:
        with pytest.raises(MaximoReadError):
            asyncio.run(scenario())
    else:
        asyncio.run(scenario())


@pytest.mark.parametrize(
    "fault", [None, "group", "missing-team", "truncated", "member", "unconfigured"]
)
def test_crew_group_is_server_configured_and_response_checked(fault):
    async def scenario():
        settings = config(crew_groups={} if fault == "unconfigured" else {"E&I": "CREW-EI"})
        row = {"persongroup": "CREW-EI", "persongroupteam": [{"respparty": "TECH"}]}
        if fault == "group":
            row["persongroup"] = "OTHER"
        if fault == "missing-team":
            del row["persongroupteam"]
        if fault == "truncated":
            row["persongroupteam_collectionref"] = "https://other.invalid"
        if fault == "member":
            row["persongroupteam"] = [{}]

        def handler(request):
            assert request.url.path.endswith("/mxpersongroup")
            assert request.url.params["oslc.where"] == 'persongroup="CREW-EI"'
            return httpx.Response(200, json={"member": [row]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert await read_pics(client, settings, "E&I") == frozenset({"TECH"})

    if fault:
        with pytest.raises(MaximoReadError):
            asyncio.run(scenario())
    else:
        asyncio.run(scenario())


def person_handler(people, seen):
    def handler(request):
        assert request.method == "GET"
        assert request.url.path.endswith("/mxperson")
        seen.append(request.url.params["oslc.where"])
        return httpx.Response(200, json={"member": people})

    return handler


def test_pic_names_use_display_name_then_name_parts_and_omit_unknown():
    async def scenario():
        seen = []
        people = [
            {"personid": "HAIDQ", "displayname": "Dao Quang Hai", "firstname": "X"},
            {"personid": "BANPV", "displayname": "  ", "firstname": "Ban", "lastname": "Pham Van"},
            {"personid": "NONAME", "displayname": "", "firstname": None},
            {"personid": "NOTASKED", "displayname": "Nobody"},
        ]
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(person_handler(people, seen))
        ) as client:
            names = await read_pic_names(
                client, config(), ["HAIDQ", "BANPV", "NONAME", "MISSING", "bad;code", "", None]
            )
        assert names == {"HAIDQ": "Dao Quang Hai", "BANPV": "Pham Van Ban"}
        assert seen == ['personid in ["BANPV","HAIDQ","MISSING","NONAME"]']

    asyncio.run(scenario())


def test_pic_names_chunk_at_100_and_skip_request_without_codes():
    async def scenario():
        seen = []
        codes = [f"P{number:03}" for number in range(150)]
        people = [{"personid": value, "displayname": value} for value in codes]

        def handler(request):
            wanted = request.url.params["oslc.where"][len("personid in [") : -1].split(",")
            seen.append(len(wanted))
            return httpx.Response(
                200,
                json={"member": [p for p in people if json.dumps(p["personid"]) in wanted]},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert len(await read_pic_names(client, config(), codes)) == 150
            assert seen == [100, 50]
            assert await read_pic_names(client, config(), [None, "bad;code"]) == {}
            assert seen == [100, 50]

    asyncio.run(scenario())


@pytest.mark.parametrize("fault", ["status", "no-id", "garbage"])
def test_pic_name_failures_degrade_to_no_names(fault):
    async def scenario():
        def handler(request):
            if fault == "status":
                return httpx.Response(500)
            if fault == "garbage":
                return httpx.Response(200, json={"member": "x"})
            return httpx.Response(200, json={"member": [{"displayname": "No id"}]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert await read_pic_names(client, config(), ["HAIDQ"]) == {}

    asyncio.run(scenario())
