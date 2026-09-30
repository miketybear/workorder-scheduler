import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from msal import ConfidentialClientApplication
from pydantic import ValidationError

from app.auth import entra
from app.config import EntraSettings, Settings
from app.main import create_app


def entra_settings():
    return EntraSettings(
        tenant_id=uuid4(),
        client_id=uuid4(),
        client_secret="test-only",
        redirect_uri="https://test.example/api/auth/callback",
    )


@pytest.mark.parametrize(
    "override",
    [
        {"client_secret": ""},
        {"redirect_uri": "http://test.example/api/auth/callback"},
        {"redirect_uri": "https://test.example/api/auth/callback?next=evil"},
        {"tenant_id": "common"},
        {"timeout_seconds": 0},
    ],
)
def test_entra_config_rejects_unsafe_or_incomplete_settings(override):
    data = entra_settings().model_dump()
    data.update(override)
    with pytest.raises(ValidationError):
        EntraSettings(**data)


def test_disabled_login_and_production_fail_closed():
    data = dict(
        _env_file=None,
        environment="test",
        database_url="postgresql+psycopg://test:test@localhost/test",
    )
    with TestClient(create_app(Settings(**data))) as client:
        assert client.get("/api/auth/configuration").json() == {"login_available": False}
        assert client.get("/api/auth/login").status_code == 503
    data["environment"] = "production"
    with pytest.raises(ValidationError):
        Settings(**data)


@pytest.mark.parametrize("fault", [None, "aud", "iss", "exp", "signature", "missing"])
def test_signed_id_token_validation(monkeypatch, fault):
    settings = entra_settings()
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(datetime.now(UTC).timestamp())
    claims = dict(
        aud=str(settings.client_id),
        tid=str(settings.tenant_id),
        oid=str(uuid4()),
        iss=f"https://login.microsoftonline.com/{settings.tenant_id}/v2.0",
        sub="subject",
        nonce="nonce",
        iat=now,
        exp=now + 300,
    )
    if fault in {"aud", "iss"}:
        claims[fault] = "wrong"
    if fault == "exp":
        claims["exp"] = now - 10
    if fault == "missing":
        del claims["exp"]
    signer = (
        rsa.generate_private_key(public_exponent=65537, key_size=2048)
        if fault == "signature"
        else private
    )
    encoded = jwt.encode(claims, signer, algorithm="RS256", headers={"kid": "test"})
    keys = Mock()
    keys.get_signing_key_from_jwt.return_value = SimpleNamespace(key=private.public_key())
    monkeypatch.setattr(entra.jwt, "PyJWKClient", Mock(return_value=keys))
    if fault:
        with pytest.raises(jwt.InvalidTokenError):
            entra.validate_id_token(settings, encoded)
    else:
        assert entra.validate_id_token(settings, encoded)["oid"] == claims["oid"]


def test_msal_exchange_cannot_use_unvalidated_claims(monkeypatch):
    client = Mock()
    client.acquire_token_by_auth_code_flow.return_value = {"id_token_claims": {"oid": "forged"}}
    monkeypatch.setattr(entra, "msal_client", Mock(return_value=client))
    assert "id_token_claims" not in entra.redeem_flow(entra_settings(), {}, {})


def test_tenant_claim_is_required_even_after_jwt_validation():
    settings = entra_settings()
    with pytest.raises(ValueError):
        entra.identity_claims(
            {
                "id_token_claims": {
                    "tid": str(uuid4()),
                    "oid": str(uuid4()),
                    "aud": str(settings.client_id),
                }
            },
            settings,
        )


@pytest.mark.parametrize("fault", ["state", "nonce"])
def test_real_msal_rejects_state_and_nonce_without_network(monkeypatch, fault):
    settings = entra_settings()
    authority = f"https://login.microsoftonline.com/{settings.tenant_id}"
    http = Mock()
    metadata = {
        "authorization_endpoint": authority + "/oauth2/v2.0/authorize",
        "token_endpoint": authority + "/oauth2/v2.0/token",
        "issuer": authority + "/v2.0",
    }
    http.get.return_value = SimpleNamespace(status_code=200, text=json.dumps(metadata))
    client = ConfidentialClientApplication(
        str(settings.client_id),
        authority=authority,
        client_credential="test-only",
        http_client=http,
        instance_discovery=False,
    )
    monkeypatch.setattr(entra, "msal_client", Mock(return_value=client))
    flow = entra.begin_flow(settings)
    query = parse_qs(urlsplit(flow["auth_uri"]).query)
    assert query["code_challenge_method"] == ["S256"]
    assert "nonce" in query and "code_verifier" in flow
    # This synthetic unsigned token reaches only MSAL's nonce check; our JWT validator
    # is separately tested with RSA signatures and must never be reached on mismatch.
    token = jwt.encode(
        {"nonce": "wrong", "sub": "subject", "aud": str(settings.client_id)},
        key=None,
        algorithm="none",
    )
    http.post.return_value = SimpleNamespace(status_code=200, text=json.dumps({"id_token": token}))
    validator = Mock(side_effect=AssertionError("Invalid flow reached JWT validation"))
    monkeypatch.setattr(entra, "validate_id_token", validator)
    with pytest.raises((ValueError, RuntimeError)):
        entra.redeem_flow(
            settings,
            flow,
            {"state": "wrong" if fault == "state" else flow["state"], "code": "synthetic"},
        )
    validator.assert_not_called()
    if fault == "state":
        http.post.assert_not_called()
