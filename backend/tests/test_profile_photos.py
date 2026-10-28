import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from test_entra import entra_settings

from app.auth import entra, photos
from app.auth.sessions import SESSION_COOKIE, token_hash
from app.config import Settings
from app.main import create_app

TOKEN = "synthetic-graph-access-token-never-expose"
JPEG = b"\xff\xd8\xffsmall-photo"


def app_with_database(db):
    app = create_app(
        Settings(
            _env_file=None,
            environment="test",
            database_url="postgresql+psycopg://test:test@localhost/test",
            entra=entra_settings().model_copy(update={"profile_photo_enabled": True}),
        )
    )

    @asynccontextmanager
    async def session():
        yield db

    class Sessions:
        begin = staticmethod(session)
        __call__ = staticmethod(session)

    app.state.sessions = Sessions()
    return app


def mock_graph(monkeypatch, status=200, content=JPEG, content_type="image/jpeg", timeout=False):
    actual_client = httpx.AsyncClient
    calls = []

    def handle(request):
        calls.append(request)
        assert str(request.url) == photos.PHOTO_URL
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        if timeout:
            raise httpx.ReadTimeout(TOKEN, request=request)
        return httpx.Response(status, content=content, headers={"Content-Type": content_type})

    monkeypatch.setattr(
        photos.httpx,
        "AsyncClient",
        lambda **kwargs: actual_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    return calls


@pytest.mark.parametrize(
    "case", ["found", "not_found", "consent_missing", "oversized", "wrong_type", "timeout"]
)
def test_callback_graph_failures_never_break_login_or_expose_tokens(monkeypatch, caplog, case):
    caplog.set_level(logging.DEBUG)
    db = SimpleNamespace(execute=AsyncMock(return_value=Mock()), scalar=AsyncMock(), add=Mock())
    app = app_with_database(db)
    settings = app.state.settings.entra
    stored = SimpleNamespace(
        flow={"state": "valid", "photo_requested": True},
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    db.execute.return_value.one_or_none.return_value = stored
    db.scalar.return_value = SimpleNamespace(active=True)
    result = {
        "access_token": TOKEN,
        "id_token": "synthetic-id-token",
        "refresh_token": "synthetic-refresh-token",
        "id_token_claims": {
            "tid": str(settings.tenant_id),
            "oid": str(uuid4()),
            "aud": str(settings.client_id),
            "name": "Planner",
        },
    }
    monkeypatch.setattr(entra, "redeem_flow", Mock(return_value=result))
    monkeypatch.setattr(entra, "issue_session", AsyncMock(return_value=("s" * 43, "c" * 43)))
    calls = mock_graph(
        monkeypatch,
        status={"not_found": 404, "consent_missing": 403}.get(case, 200),
        content=b"x" * (photos.PHOTO_MAX_BYTES + 1) if case == "oversized" else JPEG,
        content_type="text/html" if case == "wrong_type" else "image/jpeg",
        timeout=case == "timeout",
    )
    with TestClient(app, base_url="https://test.example") as client:
        # TestClient lifespan installs the real DB factory; replace it after entering.
        app.state.sessions = app_with_database(db).state.sessions
        client.cookies.set(entra.FLOW_COOKIE, "f" * 43)
        response = client.get(
            "/api/auth/callback?state=valid&code=synthetic", follow_redirects=False
        )
        assert response.headers["location"] == "/"
        assert TOKEN not in response.text + str(response.headers)
    assert len(calls) == 1
    photo = app.state.profile_photos.get(token_hash("s" * 43))
    assert (photo.content if photo else None) == (JPEG if case == "found" else None)
    assert "access_token" not in result and "refresh_token" not in result
    assert TOKEN not in caplog.text


def test_photo_endpoint_checks_session_and_never_accepts_another_identity():
    db = SimpleNamespace(execute=AsyncMock(return_value=Mock()))
    app = app_with_database(db)
    own, other = "a" * 43, "b" * 43
    app.state.profile_photos.put(token_hash(own), photos.ProfilePhoto(JPEG, "image/jpeg"))
    identity = SimpleNamespace(id=uuid4(), display_name="Other", is_admin=False)
    db.execute.return_value.one_or_none.return_value = (
        SimpleNamespace(token_hash=token_hash(other), csrf_hash="csrf"),
        identity,
    )
    with TestClient(app, base_url="https://test.example") as client:
        app.state.sessions = app_with_database(db).state.sessions
        assert client.get("/api/auth/photo").status_code == 401
        client.cookies.set(SESSION_COOKIE, other)
        assert client.get(f"/api/auth/photo?user_id={identity.id}&session={own}").status_code == 404
        db.execute.return_value.one_or_none.return_value = (
            SimpleNamespace(token_hash=token_hash(own), csrf_hash="csrf"),
            identity,
        )
        client.cookies.set(SESSION_COOKIE, own)
        response = client.get("/api/auth/photo")
        assert response.status_code == 200 and response.content == JPEG
        assert response.headers["content-type"] == "image/jpeg"
        assert response.headers["cache-control"] == "private, max-age=0, must-revalidate"
        assert response.headers["vary"] == "Cookie"
        db.execute.return_value.one_or_none.return_value = None
        assert client.get("/api/auth/photo").status_code == 401


def test_photo_store_is_bounded_expires_and_drops_logout_data(monkeypatch):
    now = datetime.now(UTC)
    store = photos.PhotoStore(clock=lambda: now)
    monkeypatch.setattr(photos, "PHOTO_CACHE_ENTRIES", 2)
    photo = photos.ProfilePhoto(JPEG, "image/jpeg")
    for key in ("one", "two", "three"):
        store.put(key, photo)
    assert store.get("one") is None
    store.drop_session("two")
    assert store.get("two") is None
    now += timedelta(hours=8)
    assert store.get("three") is None


def test_photo_scope_is_optional_and_does_not_request_refresh_tokens(monkeypatch):
    client = Mock()
    client.initiate_auth_code_flow.side_effect = [{}, {}]
    monkeypatch.setattr(entra, "msal_client", Mock(return_value=client))
    # On by default; the setting still turns it off for a tenant that blocks User.Read.
    settings = entra_settings()
    assert settings.profile_photo_enabled is True
    off = settings.model_copy(update={"profile_photo_enabled": False})
    assert entra.begin_flow(off)["photo_requested"] is False
    assert client.initiate_auth_code_flow.call_args.kwargs["scopes"] == []
    assert entra.begin_flow(settings)["photo_requested"] is True
    assert client.initiate_auth_code_flow.call_args.kwargs["scopes"] == ["User.Read"]


@pytest.mark.parametrize("state", ["valid", "invalid", "already_retried"])
@pytest.mark.parametrize(
    "error",
    [
        {"error": "access_denied"},
        {"error": "invalid_grant", "suberror": "consent_required"},
        {"error": "invalid_grant", "error_codes": [65001]},
    ],
)
def test_denied_photo_consent_restarts_once_with_fresh_id_only_flow(monkeypatch, state, error):
    db = SimpleNamespace(execute=AsyncMock(return_value=Mock()), add=Mock())
    app = app_with_database(db)
    db.execute.return_value.one_or_none.return_value = SimpleNamespace(
        flow={"state": "valid", "photo_requested": state != "already_retried"},
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    monkeypatch.setattr(entra, "redeem_flow", Mock(return_value=error))
    begin = Mock(return_value={"auth_uri": "https://login.microsoftonline.com/id-only"})
    monkeypatch.setattr(entra, "begin_flow", begin)
    with TestClient(app, base_url="https://test.example") as client:
        app.state.sessions = app_with_database(db).state.sessions
        client.cookies.set(entra.FLOW_COOKIE, "f" * 43)
        response = client.get(
            f"/api/auth/callback?state={state}&error=access_denied", follow_redirects=False
        )
        assert response.headers["location"] == (
            "https://login.microsoftonline.com/id-only" if state == "valid" else "/?auth=failed"
        )
    if state == "valid":
        assert begin.call_args.args[0].profile_photo_enabled is False
        assert db.add.call_args.args[0].token_hash != token_hash("f" * 43)
    else:
        begin.assert_not_called()
