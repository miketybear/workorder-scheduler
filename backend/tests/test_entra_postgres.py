import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from test_entra import entra_settings
from test_postgres import database, seed

from app.auth import entra
from app.auth.sessions import SESSION_COOKIE, issue_session, token_hash
from app.config import integration_settings
from app.db.models import LoginFlow, LoginSession, User
from app.main import create_app

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "outcome",
    ["success", "new", "state", "nonce", "tenant", "disabled", "expired", "browser", "duplicate"],
)
def test_login_callback_scope_and_replay(monkeypatch, outcome):
    async def scenario():
        async with database() as sessions:
            user, _, _ = await seed(sessions)
            settings = integration_settings()
            config = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.entra = config
            app = create_app(settings)
            app.state.sessions = sessions
            begin = Mock(
                return_value={
                    "auth_uri": "https://login.microsoftonline.com/test",
                    "state": "correct",
                    "nonce": "private-nonce",
                }
            )
            result = {
                "id_token_claims": {
                    "tid": str(user.tenant_id),
                    "oid": str(user.object_id),
                    "aud": str(config.client_id),
                    "name": "Verified user",
                }
            }
            if outcome == "tenant":
                result["id_token_claims"]["tid"] = str(uuid4())
            if outcome == "new":
                result["id_token_claims"]["oid"] = str(uuid4())
                result["id_token_claims"]["roles"] = ["Admin"]
            redeem = Mock(return_value=result)
            if outcome in {"state", "nonce"}:
                redeem.side_effect = (
                    ValueError("private-state")
                    if outcome == "state"
                    else RuntimeError("private-nonce")
                )
            monkeypatch.setattr(entra, "begin_flow", begin)
            monkeypatch.setattr(entra, "redeem_flow", redeem)
            async with sessions.begin() as db:
                old, _ = await issue_session(db, user)
                if outcome == "disabled":
                    (await db.get(User, user.id)).active = False
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, old, domain="test.example", path="/")
                start = await client.get("/api/auth/login")
                assert start.status_code == 303
                assert (
                    "Secure" in start.headers["set-cookie"]
                    and "HttpOnly" in start.headers["set-cookie"]
                )
                browser = client.cookies.get(entra.FLOW_COOKIE)
                if outcome == "expired":
                    async with sessions.begin() as db:
                        flow = await db.get(LoginFlow, token_hash(browser))
                        flow.expires_at = datetime.now(UTC) - timedelta(seconds=1)
                if outcome == "browser":
                    client.cookies.delete(entra.FLOW_COOKIE)
                query = "?state=correct&code=private-code"
                if outcome == "duplicate":
                    query += "&state=other"
                response = await client.get("/api/auth/callback" + query)
                assert response.status_code == 303
                assert "private" not in response.text
                assert response.headers["location"] == (
                    "/" if outcome in {"success", "new"} else "/?auth=failed"
                )
                if outcome in {"success", "new"}:
                    assert client.cookies.get(SESSION_COOKIE) != old
                    info = (await client.get("/api/auth/session")).json()
                    if outcome == "new":
                        assert info["grants"] == []
                        assert info["user"]["is_admin"] is False
                        assert info["user"]["id"] != str(user.id)
                    else:
                        assert info["user"]["id"] == str(user.id)
                        assert info["grants"][0]["discipline"] == "MECH"
                    async with sessions() as db:
                        assert await db.get(LoginSession, token_hash(old)) is None
                if outcome != "browser":
                    calls = redeem.call_count
                    client.cookies.set(entra.FLOW_COOKIE, browser, domain="test.example", path="/")
                    replay = await client.get("/api/auth/callback" + query)
                    assert replay.headers["location"] == "/?auth=failed"
                    assert redeem.call_count == calls
                async with sessions() as db:
                    tokens = (await db.scalars(select(LoginSession))).all()
                    assert len(tokens) == 1

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
