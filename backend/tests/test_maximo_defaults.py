import json
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.config import Settings

DATABASE_URL = "postgresql+psycopg://user:secret@db.invalid:5432/scheduler"


def settings(monkeypatch, maximo, defaults=None):
    monkeypatch.setenv("WOS_ENVIRONMENT", "test")
    monkeypatch.setenv("WOS_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("WOS_MAXIMO", json.dumps(maximo))
    if defaults is not None:
        monkeypatch.setenv("WOS_MAXIMO_DEFAULTS", json.dumps(defaults))
    return Settings(_env_file=None)


def connection(**overrides):
    return {
        "collection_url": "https://maximo.invalid/maximo/oslc/os/oslcmxwodetail",
        "api_key": "synthetic-test-key",
        **overrides,
    }


def test_shared_defaults_fill_every_connection_and_connection_values_win(monkeypatch):
    onshore, offshore = uuid4(), uuid4()
    result = settings(
        monkeypatch,
        {
            str(onshore): connection(),
            str(offshore): connection(open_statuses=["INPRG"]),
        },
        {
            "open_statuses": ["APPR", "SCHED"],
            "crew_groups": {"E&I": "EICREW"},
            "person_login_domain": "example.invalid",
        },
    )
    assert result.maximo[onshore].open_statuses == ["APPR", "SCHED"]
    assert result.maximo[onshore].crew_groups == {"E&I": "EICREW"}
    assert result.maximo[onshore].person_login_domain == "example.invalid"
    assert result.maximo[offshore].open_statuses == ["INPRG"]
    assert result.maximo[offshore].crew_groups == {"E&I": "EICREW"}


def test_connection_without_statuses_still_fails_when_no_default(monkeypatch):
    with pytest.raises(ValidationError):
        settings(monkeypatch, {str(uuid4()): connection()})


@pytest.mark.parametrize(
    "defaults",
    [
        {"api_key": "shared-key"},
        {"collection_url": "https://maximo.invalid/maximo/oslc/os/oslcmxwodetail"},
        {"conditional_write_contract": "native_rowstamp_test"},
    ],
)
def test_defaults_cannot_carry_endpoints_keys_or_write_contracts(monkeypatch, defaults):
    with pytest.raises(ValidationError):
        settings(monkeypatch, {str(uuid4()): connection(open_statuses=["APPR"])}, defaults)
