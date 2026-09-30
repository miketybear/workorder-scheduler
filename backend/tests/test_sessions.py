import uuid

import pytest
from fastapi import HTTPException, Response

from app.auth.sessions import SessionIdentity, set_session_cookies, token_hash, verify_csrf


def test_csrf_must_match_current_session():
    token = "a" * 43
    identity = SessionIdentity(uuid.uuid4(), "Test", False, "hash", token_hash(token))
    verify_csrf(identity, token)
    for invalid in (None, "", "b" * 43):
        with pytest.raises(HTTPException) as error:
            verify_csrf(identity, invalid)
        assert error.value.status_code == 403


def test_cookie_security_attributes():
    response = Response()
    set_session_cookies(response, "session", "csrf")
    session, csrf = response.headers.getlist("set-cookie")
    assert "HttpOnly" in session
    assert "HttpOnly" not in csrf
    for cookie in (session, csrf):
        assert "Secure" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
        assert "Domain=" not in cookie
