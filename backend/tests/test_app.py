from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from app.config import Settings
from app.main import create_app


def settings():
    return Settings(
        _env_file=None,
        environment="test",
        database_url="postgresql+psycopg://test:test@localhost/test",
    )


def test_config_requires_postgres():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="test", database_url="sqlite:///test.db")


def test_missing_configuration_fails(monkeypatch):
    monkeypatch.delenv("WOS_ENVIRONMENT", raising=False)
    monkeypatch.delenv("WOS_DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_invalid_database_config_does_not_expose_secret():
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, environment="test", database_url="private-invalid-secret")
    assert "private-invalid-secret" not in str(error.value)


def test_live_and_session_have_no_identity_bypass():
    with TestClient(create_app(settings())) as client:
        assert client.get("/api/health/live").json() == {"status": "ok"}
        assert client.get("/api/auth/session").status_code == 401
        assert client.get("/api/work-orders").status_code == 422


@pytest.mark.parametrize("revision,expected", [("0003_login_flow", 200), ("old", 503)])
def test_readiness_checks_schema(revision, expected):
    app = create_app(settings())
    with TestClient(app) as client:
        connection = AsyncMock()
        connection.scalar.return_value = revision
        engine = MagicMock()
        engine.connect.return_value.__aenter__ = AsyncMock(return_value=connection)
        engine.connect.return_value.__aexit__ = AsyncMock(return_value=False)
        app.state.engine = engine
        assert client.get("/api/health/ready").status_code == expected


def test_readiness_hides_database_errors():
    app = create_app(settings())
    with TestClient(app) as client:
        engine = MagicMock()
        engine.connect.side_effect = OperationalError("secret database details", {}, Exception())
        app.state.engine = engine
        response = client.get("/api/health/ready")
        assert response.status_code == 503
        assert "secret" not in response.text
