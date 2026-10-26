from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from test_maximo import config

from app.maximo.connections import configured_connection
from app.maximo.reader import MaximoReadError, next_page_url
from app.maximo.sender import write_enabled


def test_bdsched_structure_uses_same_configured_connection_and_explicit_write_contract():
    identity = uuid4()
    settings = config(
        collection_url="https://maximo.invalid/maximo/oslc/os/BDSCHED_WO",
        conditional_write_contract="native_rowstamp_test",
    )
    app = SimpleNamespace(maximo={identity: settings}, environment="test")
    connection = SimpleNamespace(
        id=identity,
        base_url="https://maximo.invalid/maximo",
        enabled=True,
        system="onshore",
        environment="test",
    )
    assert configured_connection(app, connection) is settings
    assert write_enabled(app, connection)
    app.environment = "staging"
    assert not write_enabled(app, connection)
    app.environment = "test"
    connection.environment = "production"
    assert not write_enabled(app, connection)
    connection.environment = "test"
    connection.system = "offshore"
    assert not write_enabled(app, connection)
    connection.system = "onshore"
    app.maximo[identity] = config(collection_url=settings.collection_url)
    assert not write_enabled(app, connection)
    connection.base_url = "https://other.invalid/maximo"
    with pytest.raises(HTTPException):
        configured_connection(app, connection)


def test_bdsched_paging_cannot_cross_into_old_structure():
    settings = config(collection_url="https://maximo.invalid/maximo/oslc/os/BDSCHED_WO")
    with pytest.raises(MaximoReadError):
        next_page_url(
            "https://maximo.invalid/maximo/oslc/os/oslcmxwodetail?pageno=2", settings, {"lean": "1"}
        )
    assert "/BDSCHED_WO?" in next_page_url("?pageno=2", settings, {"lean": "1"})


@pytest.mark.parametrize("name", ["MXWO", "BDSCHED_WO/evil", "BDSCHED_WO?apikey=secret"])
def test_only_explicit_structure_paths_are_allowed(name):
    with pytest.raises(ValidationError):
        config(collection_url="https://maximo.invalid/maximo/oslc/os/" + name)


def test_explicit_paging_alias_is_canonicalized_without_changing_scope_or_transport():
    settings = config(
        collection_url="https://maximo.invalid/maximo/oslc/os/BDSCHED_WO",
        paging_origin_aliases=["https://internal.invalid:9443"],
    )
    result = next_page_url(
        "https://internal.invalid:9443/maximo/oslc/os/BDSCHED_WO?pageno=2",
        settings,
        {"lean": "1", "oslc.where": 'siteid="BD1"'},
    )
    assert result.startswith("https://maximo.invalid/maximo/oslc/os/BDSCHED_WO?")
    with pytest.raises(MaximoReadError):
        next_page_url(
            "https://internal.invalid:9443/maximo/oslc/os/BDSCHED_WO?oslc.where=evil",
            settings,
            {"oslc.where": 'siteid="BD1"'},
        )
    with pytest.raises(MaximoReadError):
        next_page_url(
            "https://unlisted.invalid/maximo/oslc/os/BDSCHED_WO?pageno=2", settings, {"lean": "1"}
        )


@pytest.mark.parametrize(
    "origin",
    [
        "https://user:secret@internal.invalid",
        "https://internal.invalid/path",
        "https://internal.invalid?token=secret",
    ],
)
def test_paging_aliases_reject_credentials_and_non_origins(origin):
    with pytest.raises(ValidationError):
        config(paging_origin_aliases=[origin])


def test_bdsched_resource_href_with_other_object_case_resolves_on_configured_path():
    from app.maximo.contract_probe import canonical_resource

    settings = config(collection_url="https://maximo.invalid/maximo/oslc/os/BDSCHED_WO")
    url, resource_id, changed = canonical_resource(
        "https://public.invalid/maximo/oslc/os/bdsched_wo/_T1BBUVVF", settings
    )
    assert url == "https://maximo.invalid/maximo/oslc/os/BDSCHED_WO/_T1BBUVVF"
    assert (resource_id, changed) == ("_T1BBUVVF", True)
    with pytest.raises(MaximoReadError):
        canonical_resource("https://maximo.invalid/maximo/oslc/os/oslcmxwodetail/_T1", settings)


def test_workflow_route_accounts_are_secret_scoped_and_test_only(monkeypatch):
    import json

    from app.config import Settings

    identity = uuid4()
    base = {
        "collection_url": "https://maximo.invalid/maximo/oslc/os/BDSCHED_WO",
        "api_key": "synthetic-test-key",
        "open_statuses": ["APPR"],
    }
    monkeypatch.setenv("WOS_ENVIRONMENT", "test")
    monkeypatch.setenv("WOS_DATABASE_URL", "postgresql+psycopg://u:p@localhost/db")
    monkeypatch.setenv("WOS_MAXIMO", json.dumps({str(identity): base}))
    monkeypatch.setenv(
        f"WOS_MAXIMO__{identity}__WORKFLOW_ROUTE_ACCOUNTS",
        '{"E&I": {"personid": "ENISUP", "api_key": "synthetic-route-key"}}',
    )
    account = Settings(_env_file=None).maximo[identity].workflow_route_accounts["E&I"]
    assert account.personid == "ENISUP"
    assert "synthetic-route-key" not in repr(account)
    assert account.api_key.get_secret_value() == "synthetic-route-key"

    monkeypatch.setenv("WOS_ENVIRONMENT", "staging")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    "accounts",
    [
        {"E&I;DROP": {"personid": "ENISUP", "api_key": "k"}},
        {"E&I": {"personid": "enisup", "api_key": "k"}},
        {"E&I": {"personid": "ENISUP", "api_key": " "}},
        {"E&I": {"personid": "ENISUP", "api_key": "k", "password": "x"}},
    ],
)
def test_workflow_route_accounts_reject_unsafe_values(accounts):
    with pytest.raises(ValidationError):
        config(workflow_route_accounts=accounts)
