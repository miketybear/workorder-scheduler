import asyncio
from uuid import uuid4

import httpx
import pytest
from test_maximo import config, record

from app.maximo.contract_probe import (
    authorize_probe,
    canonical_resource,
    etag_evidence,
    probe_contract,
)
from app.maximo.reader import MaximoReadError

PATH = "/maximo/oslc/os/oslcmxwodetail/_T1BBUVVF"
ADVERTISED = "https://production.example" + PATH


def raw(**overrides):
    return record(**{"href": ADVERTISED, "orgid": "ORG", **overrides})


def run_probe(handler, settings=None):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await probe_contract(client, settings or config(), "TEST", "100", "E&I")

    return asyncio.run(scenario())


@pytest.mark.parametrize(
    "etag,status,token",
    [
        (None, "missing", None),
        ('"123-opaque"', "strong", '"123-opaque"'),
        ('""', "strong", '""'),
        ('W/"123"', "weak", None),
        ("1234567", "numeric_candidate", "1234567"),
        ("-1269179891", "numeric_candidate", "-1269179891"),
        ("*", "invalid", None),
        ('"a", "b"', "invalid", None),
        ("W/123", "invalid", None),
        ('"line\r\nbreak"', "invalid", None),
        (' "123" ', "invalid", None),
        ('"' + "x" * 500 + '"', "invalid", None),
        ("opaque", "invalid", None),
        ('"\\opaque"', "strong", '"\\opaque"'),
    ],
)
def test_etag_preserves_only_safe_opaque_or_documented_numeric_token(etag, status, token):
    headers = httpx.Headers({} if etag is None else {"ETag": etag})
    assert etag_evidence(headers) == (status, token)


def test_duplicate_etag_headers_invalid():
    assert etag_evidence(httpx.Headers([("ETag", '"one"'), ("ETag", '"two"')])) == ("invalid", None)


@pytest.mark.parametrize(
    "href",
    [
        "https://evil.example/other/_T1BBUVVF",
        "//evil.example" + PATH,
        "https://user:secret@evil.example" + PATH,
        ADVERTISED + "?apikey=secret",
        ADVERTISED + "#fragment",
        ADVERTISED + "/child",
        ADVERTISED + "/",
        "https://evil.example" + PATH.replace("_T1BBUVVF", ".."),
        "https://evil.example" + PATH.replace("_T1BBUVVF", "%2e%2e"),
        "https://evil.example" + PATH.replace("_T1BBUVVF", "id%2fchild"),
        "https://evil.example" + PATH.replace("_T1BBUVVF", "id\\child"),
        "file://evil.example" + PATH,
        "https://[invalid" + PATH,
        "https://evil.example:invalid" + PATH,
        ADVERTISED + "\n",
        "_T1BBUVVF",
        "/maximo/oslc/os/oslcmxwodetail",
        None,
        "https:///" + PATH,
    ],
)
def test_resource_path_guards(href):
    with pytest.raises(MaximoReadError):
        canonical_resource(href, config())


@pytest.mark.parametrize(
    "href,changed", [(ADVERTISED, True), (PATH, False), ("https://maximo.invalid" + PATH, False)]
)
def test_resource_path_canonical_origin(href, changed):
    assert canonical_resource(href, config()) == (
        "https://maximo.invalid" + PATH,
        "_T1BBUVVF",
        changed,
    )


@pytest.mark.parametrize(
    "resource_etag,status,expected",
    [
        ('"record-token"', "strong", '"record-token"'),
        (None, "missing", None),
        ('W/"weak"', "weak", None),
        ("-12345", "numeric_candidate", "-12345"),
        ("*", "invalid", None),
    ],
)
def test_probe_gets_exact_resource_and_never_uses_collection_etag(resource_etag, status, expected):
    calls = []

    def handler(request):
        calls.append(request)
        assert request.method == "GET"
        assert request.url.host == "maximo.invalid"
        assert request.headers["apikey"] == "synthetic-test-key"
        assert request.url.params["lean"] == "1"
        assert "orgid" in request.url.params["oslc.select"]
        if len(calls) == 1:
            where = request.url.params["oslc.where"]
            assert 'siteid="TEST"' in where and "workorderid=100" in where
            assert 'bdpocdiscipline="E&I"' in where and 'worktype="CM"' in where
            assert "istask=0" in where and 'parent!="*"' in where
            assert 'status in ["APPR","SCHED","WMATL"]' in where
            assert '["APPR", "SCHED"' not in where
            return httpx.Response(200, json={"member": [raw()]}, headers={"ETag": '"collection"'})
        assert request.url.path == PATH
        assert "oslc.where" not in request.url.params
        return httpx.Response(
            200,
            json=raw(),
            headers={}
            if resource_etag is None
            else {"ETag": resource_etag, "Set-Cookie": "secret", "Server": "internal-service"},
        )

    result = run_probe(handler)
    assert len(calls) == 2
    assert result.resource_path == PATH and result.orgid == "ORG"
    assert result.advertised_origin_changed
    assert result.collection_etag_status == "strong"
    assert result.resource_etag_status == status and result.resource_etag == expected
    assert result.strong_etag == (expected if status == "strong" else None)
    assert result.baseline.estdur == 8
    output = result.model_dump_json()
    assert "production.example" not in output and "secret" not in output
    assert "Set-Cookie" not in output and "internal-service" not in output


@pytest.mark.parametrize(
    "field,value",
    [
        ("siteid", "OTHER"),
        ("workorderid", 101),
        ("bdpocdiscipline", "MECH"),
        ("worktype", "PM"),
        ("worktype", "CFT"),
        ("status", "CLOSE"),
        ("istask", True),
        ("parent", "PARENT"),
        ("orgid", ""),
        ("orgid", "ORG\nSECRET"),
    ],
)
@pytest.mark.parametrize("stage", ["collection", "resource"])
def test_identity_and_scope_checked_on_both_responses(field, value, stage):
    calls = []

    def handler(request):
        calls.append(request)
        changed = raw(**{field: value})
        if len(calls) == 1:
            return httpx.Response(
                200, json={"member": [changed if stage == "collection" else raw()]}
            )
        return httpx.Response(200, json=changed)

    with pytest.raises(MaximoReadError):
        run_probe(handler)
    assert len(calls) == (1 if stage == "collection" else 2)


@pytest.mark.parametrize(
    "resource",
    [raw(orgid="OTHER"), raw(wonum="OTHER"), raw(href=ADVERTISED + "changed"), {"member": [raw()]}],
)
def test_exact_record_identity_and_shape(resource):
    def handler(request):
        return httpx.Response(
            200, json={"member": [raw()]} if request.url.path != PATH else resource
        )

    with pytest.raises(MaximoReadError):
        run_probe(handler)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"member": []},
        {"member": [raw(), raw()]},
        {"member": [raw()], "responseInfo": {"nextPage": "https://evil.example"}},
        {"member": [raw()], "responseInfo": []},
        {"member": [None]},
        [],
    ],
)
def test_ambiguous_collection_fail_closed(body):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=body)

    with pytest.raises(MaximoReadError):
        run_probe(handler)
    assert len(calls) == 1


@pytest.mark.parametrize(
    "case", ["redirect", "upstream-error", "invalid-json", "too-large", "timeout"]
)
def test_failures_bounded_sanitized_and_no_redirect(case):
    calls = []

    def handler(request):
        calls.append(request)
        if case == "timeout":
            raise httpx.ReadTimeout("secret upstream URL", request=request)
        if case == "redirect":
            return httpx.Response(302, headers={"Location": "https://production.example?secret"})
        if case == "upstream-error":
            return httpx.Response(500, content=b"secret failure credential")
        if case == "invalid-json":
            return httpx.Response(200, content=b"secret invalid response")
        return httpx.Response(200, content=b"x" * 2048)

    with pytest.raises(MaximoReadError) as error:
        run_probe(handler, config(max_page_bytes=1024))
    assert "secret" not in str(error.value) and "production.example" not in str(error.value)
    assert len(calls) == 1


@pytest.mark.integration
@pytest.mark.parametrize(
    "case",
    [
        "read",
        "planner",
        "inactive",
        "disabled",
        "missing-binding",
        "binding-changed",
        "no-grant",
        "wrong-object",
        "wrong-tenant",
        "wrong-user",
        "unconfigured",
        "production-connection",
        "production-app",
        "staging-app",
        "missing-crew",
        "different-scope",
    ],
)
def test_probe_authority_requires_existing_test_person_scope(case):
    from sqlalchemy import delete, select
    from test_entra import entra_settings
    from test_postgres import database, seed

    from app.config import integration_settings
    from app.db.models import (
        AccessGrant,
        MaximoConnection,
        MaximoPersonBinding,
        PlannerPermission,
        User,
    )

    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            connection = connections[0]
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {
                connection.id: config(
                    person_login_domain="example.invalid",
                    crew_groups={"E&I": "CREW", "MECH": "MECH"},
                )
            }
            async with sessions.begin() as db:
                stored = await db.get(User, user.id)
                stored.login_name = "probe@example.invalid"
                stored.active = case != "inactive"
                stored_connection = await db.get(MaximoConnection, connection.id)
                stored_connection.base_url = "https://maximo.invalid/maximo"
                stored_connection.enabled = case != "disabled"
                if case == "production-connection":
                    stored_connection.environment = "production"
                if case != "missing-binding":
                    db.add(
                        MaximoPersonBinding(
                            user_id=user.id,
                            connection_id=connection.id,
                            person_id="other" if case == "binding-changed" else "probe",
                        )
                    )
                if case == "no-grant":
                    await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
                if case == "planner":
                    db.add(
                        PlannerPermission(
                            user_id=user.id, connection_id=connection.id, discipline="MECH"
                        )
                    )
                else:
                    grant = await db.scalar(
                        select(AccessGrant).where(AccessGrant.user_id == user.id)
                    )
                    if grant:
                        grant.capability = "read"
            if case == "production-app":
                settings.environment = "production"
            if case == "staging-app":
                settings.environment = "staging"
            if case == "unconfigured":
                settings.maximo = {}
            if case == "missing-crew":
                settings.maximo[connection.id].crew_groups = {}
            async with sessions() as db:
                args = (
                    db,
                    settings,
                    uuid4() if case == "wrong-user" else user.id,
                    connection.id,
                    "E&I" if case == "different-scope" else "MECH",
                    uuid4() if case == "wrong-tenant" else user.tenant_id,
                    uuid4() if case == "wrong-object" else user.object_id,
                )
                if case in {"read", "planner"}:
                    _, authority = await authorize_probe(*args)
                    assert authority.explicit_planner == (case == "planner")
                    assert authority.person_id == "probe"
                else:
                    with pytest.raises(MaximoReadError):
                        await authorize_probe(*args)

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
