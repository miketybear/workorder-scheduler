import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from msal import ConfidentialClientApplication
from requests.exceptions import RequestException
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from starlette.concurrency import run_in_threadpool

from app.auth.photos import fetch_photo
from app.auth.sessions import SESSION_COOKIE, issue_session, set_session_cookies, token_hash
from app.config import EntraSettings
from app.db.models import LoginFlow, LoginSession, User

router = APIRouter(prefix="/api/auth")
FLOW_COOKIE = "__Host-wos-login"
FLOW_LIFETIME = timedelta(minutes=10)


def msal_client(settings: EntraSettings) -> ConfidentialClientApplication:
    # A new client per operation keeps tokens out of shared caches and disk.
    return ConfidentialClientApplication(
        str(settings.client_id),
        authority=f"https://login.microsoftonline.com/{settings.tenant_id}",
        client_credential=settings.client_secret.get_secret_value(),
        timeout=settings.timeout_seconds,
        exclude_scopes=["offline_access"],
        enable_pii_log=False,
    )


def begin_flow(settings: EntraSettings) -> dict:
    flow = msal_client(settings).initiate_auth_code_flow(
        scopes=settings.login_scopes, redirect_uri=settings.redirect_uri, response_mode="query"
    )
    flow["photo_requested"] = settings.profile_photo_enabled
    return flow


def redeem_flow(settings: EntraSettings, flow: dict, response: dict) -> dict:
    # MSAL owns state, nonce and PKCE. Version 1.39 leaves JWT validation to the app.
    result = msal_client(settings).acquire_token_by_auth_code_flow(flow, response)
    if "id_token" in result and not result.get("error"):
        result["id_token_claims"] = validate_id_token(settings, result["id_token"])
    else:
        result.pop("id_token_claims", None)
    return result


def validate_id_token(settings: EntraSettings, token: str) -> dict:
    keys = jwt.PyJWKClient(
        f"https://login.microsoftonline.com/{settings.tenant_id}/discovery/v2.0/keys",
        timeout=settings.timeout_seconds,
    )
    key = keys.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        key.key,
        algorithms=["RS256"],
        audience=str(settings.client_id),
        issuer=f"https://login.microsoftonline.com/{settings.tenant_id}/v2.0",
        options={"require": ["exp", "iat", "iss", "aud", "sub", "tid", "oid", "nonce"]},
    )


def identity_claims(result: dict, settings: EntraSettings) -> tuple[UUID, UUID, str]:
    """Only accepts results from MSAL's validated code exchange, never a client-supplied JWT."""
    claims = result.get("id_token_claims")
    if result.get("error") or not isinstance(claims, dict):
        raise ValueError("Identity validation failed")
    tenant, object_id = UUID(claims["tid"]), UUID(claims["oid"])
    if tenant != settings.tenant_id or claims.get("aud") != str(settings.client_id):
        raise ValueError("Identity validation failed")
    name = claims.get("name")
    return tenant, object_id, name[:200] if isinstance(name, str) and name else "Planner"


def photo_consent_failed(result: dict) -> bool:
    if result.get("error") in {
        "access_denied",
        "consent_required",
        "interaction_required",
        "invalid_scope",
    }:
        return True
    # Entra can return consent failures from the token endpoint as invalid_grant.
    return result.get("error") == "invalid_grant" and (
        result.get("suberror") == "consent_required" or 65001 in (result.get("error_codes") or [])
    )


@router.get("/configuration")
async def configuration(request: Request):
    return {"login_available": request.app.state.settings.entra is not None}


@router.get("/login")
async def login(request: Request):
    settings = request.app.state.settings.entra
    if settings is None:
        raise HTTPException(503, "Sign-in is not configured")
    return await start_login(request, settings)


async def start_login(request: Request, settings: EntraSettings):
    try:
        flow = await run_in_threadpool(begin_flow, settings)
    except (RequestException, ValueError):
        raise HTTPException(503, "Sign-in service unavailable") from None
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    async with request.app.state.sessions.begin() as db:
        await db.execute(delete(LoginFlow).where(LoginFlow.expires_at <= now))
        old = request.cookies.get(FLOW_COOKIE)
        if old:
            await db.execute(delete(LoginFlow).where(LoginFlow.token_hash == token_hash(old)))
        db.add(LoginFlow(token_hash=token_hash(token), flow=flow, expires_at=now + FLOW_LIFETIME))
    response = RedirectResponse(
        flow["auth_uri"],
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )
    response.set_cookie(
        FLOW_COOKIE,
        token,
        max_age=int(FLOW_LIFETIME.total_seconds()),
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/callback")
async def callback(request: Request):
    settings = request.app.state.settings.entra
    if settings is None:
        raise HTTPException(503, "Sign-in is not configured")
    failure = RedirectResponse(
        "/?auth=failed",
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )
    failure.delete_cookie(FLOW_COOKIE, secure=True, httponly=True, samesite="lax", path="/")
    token = request.cookies.get(FLOW_COOKIE)
    if not token or len(token) != 43:
        return failure
    # Commit consumption before exchange: concurrent/replayed callbacks cannot redeem twice.
    async with request.app.state.sessions.begin() as db:
        stored = (
            await db.execute(
                delete(LoginFlow)
                .where(LoginFlow.token_hash == token_hash(token))
                .returning(LoginFlow.flow, LoginFlow.expires_at)
            )
        ).one_or_none()
    if stored is None or stored.expires_at <= datetime.now(UTC):
        return failure
    params = dict(request.query_params)
    if any(len(request.query_params.getlist(key)) != 1 for key in params):
        return failure
    try:
        result = await run_in_threadpool(redeem_flow, settings, stored.flow, params)
        if (
            stored.flow.get("photo_requested") is True
            and isinstance(params.get("state"), str)
            and secrets.compare_digest(params["state"], stored.flow.get("state", ""))
            and photo_consent_failed(result)
        ):
            # Never authenticate from this error. Restart once with fresh ID-only state/nonce.
            return await start_login(
                request, settings.model_copy(update={"profile_photo_enabled": False})
            )
        tenant, object_id, name = identity_claims(result, settings)
    except (RequestException, ValueError, KeyError, TypeError, RuntimeError, jwt.PyJWTError):
        return failure
    access_token = result.pop("access_token", None)
    result.pop("refresh_token", None)
    result.pop("id_token", None)
    photo = (
        await fetch_photo(access_token)
        if settings.profile_photo_enabled and isinstance(access_token, str) and access_token
        else None
    )
    del access_token
    async with request.app.state.sessions.begin() as db:
        await db.execute(
            insert(User)
            .values(
                tenant_id=tenant,
                object_id=object_id,
                display_name=name,
                active=True,
            )
            .on_conflict_do_nothing(index_elements=["tenant_id", "object_id"])
        )
        user = await db.scalar(
            select(User)
            .where(User.tenant_id == tenant, User.object_id == object_id)
            .with_for_update()
        )
        if not user.active:
            return failure
        user.display_name = name
        # This signed claim locates PERSON; tenant/object ID remain the identity keys.
        login_name = result["id_token_claims"].get("preferred_username")
        user.login_name = (
            login_name if isinstance(login_name, str) and len(login_name) <= 320 else None
        )
        old = request.cookies.get(SESSION_COOKIE)
        if old:
            await db.execute(delete(LoginSession).where(LoginSession.token_hash == token_hash(old)))
        session_token, csrf = await issue_session(db, user)
    if old:
        request.app.state.profile_photos.drop_session(token_hash(old))
    if photo:
        request.app.state.profile_photos.put(token_hash(session_token), photo)
    response = RedirectResponse(
        "/",
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )
    response.delete_cookie(FLOW_COOKIE, secure=True, httponly=True, samesite="lax", path="/")
    set_session_cookies(response, session_token, csrf)
    return response
