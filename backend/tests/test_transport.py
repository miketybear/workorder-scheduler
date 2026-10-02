from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from test_maximo import config

from app.config import Settings
from app.maximo.reader import MaximoReadError, next_page_url
from app.maximo.routes import configured_connection

HTTP_URL = "http://maximo.invalid/maximo/oslc/os/oslcmxwodetail"


def test_http_requires_explicit_boolean_opt_in():
    for flag in [False, "true", 1]:
        with pytest.raises(ValidationError):
            config(collection_url=HTTP_URL, allow_http_for_test=flag)
    assert config(collection_url=HTTP_URL, allow_http_for_test=True).allow_http_for_test


def test_production_settings_reject_http_at_startup_without_exposing_key():
    with pytest.raises(ValidationError) as error:
        Settings(
            _env_file=None,
            environment="production",
            database_url="postgresql+psycopg://test:test@localhost/test",
            entra={
                "tenant_id": uuid4(),
                "client_id": uuid4(),
                "client_secret": "synthetic-entra",
                "redirect_uri": "https://app.invalid/api/auth/callback",
            },
            maximo={uuid4(): config(collection_url=HTTP_URL, allow_http_for_test=True)},
        )
    assert "require HTTPS" in str(error.value)
    assert "synthetic-test-key" not in str(error.value)


@pytest.mark.parametrize(
    "app_environment,connection_environment,allowed",
    [
        ("development", "test", True),
        ("test", "test", True),
        ("staging", "test", True),
        ("production", "test", False),
        ("test", "production", False),
    ],
)
def test_http_policy_uses_server_side_connection_environment(
    app_environment, connection_environment, allowed
):
    connection = SimpleNamespace(
        id=uuid4(), base_url="http://maximo.invalid/maximo", environment=connection_environment
    )
    settings = config(collection_url=HTTP_URL, allow_http_for_test=True)
    app_settings = SimpleNamespace(environment=app_environment, maximo={connection.id: settings})
    if allowed:
        assert configured_connection(app_settings, connection) is settings
    else:
        with pytest.raises(HTTPException) as error:
            configured_connection(app_settings, connection)
        assert error.value.status_code == 503


def test_https_production_connection_still_allowed():
    connection = SimpleNamespace(
        id=uuid4(), base_url="https://maximo.invalid/maximo", environment="production"
    )
    settings = config()
    app_settings = SimpleNamespace(environment="production", maximo={connection.id: settings})
    assert configured_connection(app_settings, connection) is settings


@pytest.mark.parametrize(
    "target",
    [
        "http://other.invalid/maximo/oslc/os/oslcmxwodetail?pageno=2",
        "https://maximo.invalid/maximo/oslc/os/oslcmxwodetail?pageno=2",
    ],
)
def test_http_paging_cannot_change_origin_or_scheme(target):
    settings = config(collection_url=HTTP_URL, allow_http_for_test=True)
    with pytest.raises(MaximoReadError):
        next_page_url(target, settings, {"lean": "1"})
