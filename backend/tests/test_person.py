import asyncio

import httpx
import pytest
from test_maximo import config

from app.maximo.person import person_id_from_login, read_person_discipline
from app.maximo.reader import MaximoReadError


@pytest.mark.parametrize(
    "login,expected",
    [
        ("nhatnh@biendongpoc.vn", "nhatnh"),
        ("NHATNH@BIENDONGPOC.VN", "nhatnh"),
        ("nhatnh@other.vn", None),
        ("guest_other.vn#EXT#@biendongpoc.vn", None),
        ("nhatnh", None),
        ('x" or personid="nhatnh@biendongpoc.vn', None),
        (None, None),
    ],
)
def test_person_locator_requires_verified_company_login(login, expected):
    assert person_id_from_login(login, "biendongpoc.vn") == expected


@pytest.mark.parametrize(
    "case",
    [
        "valid",
        "null",
        "empty",
        "missing-person",
        "wrong-person",
        "duplicate",
        "paging",
        "missing-key",
        "multiple-disciplines",
        "invalid-type",
        "status",
        "redirect",
        "oversized",
        "invalid-json",
        "timeout",
    ],
)
def test_person_reader_rejects_ambiguous_or_untrusted_profiles(case):
    async def scenario():
        body = {"member": [{"personid": "NHATNH", "ct_discipline": "E&I"}]}
        if case == "null":
            body["member"][0]["ct_discipline"] = None
        if case == "empty":
            body["member"][0]["ct_discipline"] = ""
        if case == "missing-person":
            body["member"] = []
        if case == "wrong-person":
            body["member"][0]["personid"] = "OTHER"
        if case == "duplicate":
            body["member"] *= 2
        if case == "paging":
            body["responseInfo"] = {"nextPage": "https://evil.invalid/"}
        if case == "missing-key":
            del body["member"][0]["personid"]
        if case == "multiple-disciplines":
            body["member"][0]["ct_discipline"] = "MECH,E&I"
        if case == "invalid-type":
            body["member"][0]["ct_discipline"] = ["MECH"]
        calls = []

        def upstream(request):
            calls.append(request)
            assert request.url.path == "/maximo/oslc/os/mxperson"
            assert request.url.params["oslc.select"] == "personid,ct_discipline"
            assert request.url.params["oslc.where"] == 'personid="nhatnh"'
            assert "apikey" not in str(request.url)
            if case == "timeout":
                raise httpx.ReadTimeout("private-upstream-error")
            if case in {"status", "redirect"}:
                return httpx.Response(403 if case == "status" else 302)
            if case == "oversized":
                return httpx.Response(200, content=b"x" * 64001)
            if case == "invalid-json":
                return httpx.Response(200, content=b"private-upstream-error")
            return httpx.Response(200, json=body)

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            if case in {"valid", "null", "empty", "missing-person"}:
                result = await read_person_discipline(client, config(), "nhatnh")
                assert result == ("E&I" if case == "valid" else None)
            else:
                with pytest.raises(MaximoReadError) as error:
                    await read_person_discipline(client, config(), "nhatnh")
                assert "private" not in str(error.value)
        assert len(calls) == 1

    asyncio.run(scenario())
