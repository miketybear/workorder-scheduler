"""BD_WO route API: position-account session, read-only preview, routing and recovery."""

import asyncio
from collections import Counter
from datetime import UTC
from functools import partial
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import LoginSession, MaximoConnection, MaximoPersonBinding, User
from app.maximo.sender import NativeTestTransport, write_enabled
from app.scheduling.drafts import WorkOrderKey, require_scope
from app.scheduling.routes import checked_settings
from app.scheduling.upload_routes import PrivateRoute
from app.workflow_route import service
from app.workflow_route.contract import resolve_contract
from app.workflow_route.credentials import RouteCredential, SecretString
from app.workflow_route.ledger import PostgresLedger
from app.workflow_route.maximo import (
    RouteTransportError,
    maxauth_value,
    read_process,
    text,
    whoami,
)

router = APIRouter(prefix="/api/workflow", route_class=PrivateRoute)
_tasks: set[asyncio.Task] = set()


class ItemRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_id: str = Field(min_length=1, max_length=50)
    workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: UUID
    discipline: str = Field(min_length=1, max_length=50)


class PreviewRequest(Scope):
    items: list[ItemRef] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique_items(self):
        keys = [(item.site_id, item.workorder_id) for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate work order identity")
        return self


class RouteRequest(PreviewRequest):
    request_id: UUID


class LoginRequest(Scope):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def printable(self):
        if any(ord(char) < 32 or ord(char) == 127 for char in self.password + self.username):
            raise ValueError("Invalid credentials")
        return self


class EmptyCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")


def route_enabled(settings, connection) -> bool:
    """Same gate as writes: development/test application, onshore test connection, BDSCHED_WO."""
    config = settings.maximo.get(connection.id)
    return bool(
        config
        and config.workflow_route_accounts
        and config.collection_url.endswith("/oslc/os/BDSCHED_WO")
        and write_enabled(settings, connection)
    )


async def parse_secret_body(request: Request, model):
    """Credentials never reach FastAPI's validation errors, which echo the input."""
    try:
        return model.model_validate(await request.json())
    except (ValueError, ValidationError):
        raise HTTPException(422, {"code": "invalid_request"}) from None


def refuse(status: int, code: str, **extra):
    return HTTPException(status, {"code": code, **extra})


async def authority(request, scope: Scope, *, csrf: bool, write: bool = True):
    key = WorkOrderKey(scope.connection_id, "", "")
    return await checked_settings(request, key, scope.discipline, write=write, csrf=csrf)


async def build_context(request: Request, scope: Scope, *, with_credential=False):
    identity, config = await authority(request, scope, csrf=True)
    state = request.app.state
    async with state.sessions() as db:
        connection = await db.get(MaximoConnection, scope.connection_id)
        user = await db.get(User, identity.user_id)
        binding = await db.get(MaximoPersonBinding, (identity.user_id, scope.connection_id))
    account = config.workflow_route_accounts.get(scope.discipline)
    if connection is None or account is None or not route_enabled(state.settings, connection):
        raise refuse(409, "workflow_route_disabled")
    route = config.workflow_route

    async def reauthorize():
        fresh, _ = await authority(request, scope, csrf=True)
        if fresh.user_id != identity.user_id:
            raise HTTPException(401, "Sign-in required")

    async def load_problem():
        async with state.maximo_client_factory() as client:
            return resolve_contract(await read_process(client, config, route), route)

    cache_key = (scope.connection_id, route.process, route.revision)

    class SupnameWriter:
        def __init__(self, attempt_id):
            self.attempt_id = attempt_id

        async def write_supname(self, resource_id, revision, supname):
            async with state.maximo_client_factory() as client:
                transport = NativeTestTransport(
                    request, identity.user_id, scope.connection_id, scope.discipline, client
                )
                transport.attempt_id = self.attempt_id
                await transport.write_supname(resource_id, revision, supname)

    store = state.workflow_route_credentials
    session_key = (identity.token_hash, scope.connection_id, scope.discipline)
    credential = store.get(*session_key) if with_credential else None
    if credential is not None and credential.user_id != identity.user_id:
        credential = None
    ctx = service.RouteContext(
        actor_id=identity.user_id,
        actor_name=user.display_name,
        connection_id=scope.connection_id,
        discipline=scope.discipline,
        config=config,
        route=route,
        account=account,
        planner_person=binding.person_id if binding else None,
        ledger=PostgresLedger(state.sessions),
        client_factory=state.maximo_client_factory,
        authorize=reauthorize,
        contract=partial(state.workflow_route_contract.problem, cache_key, load_problem),
        transport_factory=SupnameWriter,
        credential=credential,
        drop_credential=partial(store.drop, *session_key),
    )
    return identity, ctx


def item_json(item: service.ItemResult) -> dict:
    return {
        "site_id": item.site_id,
        "workorder_id": item.workorder_id,
        "wonum": item.wonum,
        "state": item.state,
        "code": item.code,
        "attempt_id": str(item.attempt_id) if item.attempt_id else None,
        "wfassignment_id_after": item.wfassignment_id_after,
        "assigned_to": item.assigncode_after,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def submission_json(request_id, scope, items: list[service.ItemResult]) -> dict:
    open_states = {"pending", "sending", "not_attempted"}
    return {
        "request_id": str(request_id),
        "connection_id": str(scope.connection_id),
        "discipline": scope.discipline,
        "complete": not any(item.state in open_states for item in items),
        "counts": dict(Counter(item.state for item in items)),
        "items": [item_json(item) for item in items],
    }


@router.get("/route/status")
async def status(request: Request, connection_id: UUID, discipline: str):
    scope = Scope(connection_id=connection_id, discipline=discipline)
    identity, config = await authority(request, scope, csrf=False, write=False)
    state = request.app.state
    async with state.sessions() as db:
        connection = await db.get(MaximoConnection, connection_id)
        try:
            await require_scope(
                db, identity.user_id, WorkOrderKey(connection_id, "", ""), discipline, write=True
            )
            writer = True
        except HTTPException:
            writer = False
    account = config.workflow_route_accounts.get(discipline)
    enabled = bool(connection and account and route_enabled(state.settings, connection))
    can_route = enabled and writer
    credential = state.workflow_route_credentials.get(
        identity.token_hash, connection_id, discipline
    )
    active = can_route and credential is not None and credential.user_id == identity.user_id
    return {
        "enabled": enabled,
        "can_route": can_route,
        "personid": account.personid if can_route else None,
        "session": {
            "active": active,
            "expires_at": credential.expires_at.isoformat() if active else None,
        },
    }


@router.post("/route/session")
async def login(request: Request):
    payload = await parse_secret_body(request, LoginRequest)
    identity, ctx = await build_context(request, payload)
    state = request.app.state
    personid = ctx.account.personid
    if payload.username.upper() != personid.upper():
        raise refuse(422, "username_mismatch")
    account_key = (payload.connection_id, personid)
    wait = state.workflow_route_limiter.reserve(identity.user_id, account_key)
    if wait is not None:
        raise HTTPException(
            429,
            {"code": "login_rate_limited", "retry_after_seconds": wait},
            headers={"Retry-After": str(wait)},
        )
    # Maximo login names are lower case (ENISUP is the PERSON id, the login is enisup).
    maxauth = maxauth_value(personid.lower(), payload.password)
    try:
        async with state.maximo_client_factory() as client:
            reply = await whoami(client, ctx.config, maxauth)
    except RouteTransportError:
        state.workflow_route_limiter.release(identity.user_id, account_key)
        raise refuse(502, "maximo_unavailable") from None
    verified = (
        reply.status == 200
        and isinstance(reply.body, dict)
        and (text(reply.body.get("personid")) or "").upper() == personid.upper()
    )
    if reply.status >= 500:
        state.workflow_route_limiter.release(identity.user_id, account_key)
        raise refuse(502, "maximo_unavailable")
    if not verified:
        # Not 401: the browser treats 401 as "Entra session ended".
        raise refuse(
            422,
            "maximo_login_failed",
            remaining_attempts=state.workflow_route_limiter.remaining(identity.user_id),
        )
    state.workflow_route_limiter.release(identity.user_id, account_key)
    async with state.sessions() as db:
        expires_at = await db.scalar(
            select(LoginSession.expires_at).where(LoginSession.token_hash == identity.token_hash)
        )
    if expires_at is None:
        raise HTTPException(401, "Sign-in required")
    credential = RouteCredential(
        SecretString(maxauth), personid, identity.user_id, expires_at.astimezone(UTC)
    )
    state.workflow_route_credentials.put(
        identity.token_hash, payload.connection_id, payload.discipline, credential
    )
    return {
        "personid": personid,
        "session": {"active": True, "expires_at": credential.expires_at.isoformat()},
    }


@router.delete("/route/session", status_code=204)
async def logout_route_session(
    request: Request, connection_id: UUID | None = None, discipline: str | None = None
):
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        verify_csrf(identity, request.headers.get("X-CSRF-Token"))
    store = request.app.state.workflow_route_credentials
    if connection_id is not None and discipline is not None:
        store.drop(identity.token_hash, connection_id, discipline)
    else:
        store.drop_session(identity.token_hash)
    return Response(status_code=204)


@router.post("/route/preview")
async def preview(request: Request, payload: PreviewRequest):
    _, ctx = await build_context(request, payload)
    keys = [ctx.key(item.site_id, item.workorder_id) for item in payload.items]
    problem, _ = await ctx.contract()
    rows = []
    for key, evaluation in await service.preview(ctx, keys):
        order, held = evaluation.order, evaluation.assignment
        rows.append(
            {
                "site_id": key.site_id,
                "workorder_id": key.workorder_id,
                "wonum": order.wonum if order else None,
                "ready": evaluation.code == service.READY,
                "code": evaluation.code,
                "node_id": held.node if held else None,
                "wfassignment_id": held.id if held else None,
                "assigned_to": order.assignedto if order else None,
                "supervisor": {
                    "current": order.supname if order else None,
                    "will_set": evaluation.supname,
                },
            }
        )
    return {
        "connection_id": str(payload.connection_id),
        "discipline": payload.discipline,
        "contract": {"ok": problem is None, "problem": problem},
        "items": rows,
    }


@router.post("/route")
async def route(request: Request, payload: RouteRequest):
    identity, ctx = await build_context(request, payload, with_credential=True)
    state = request.app.state
    keys = [ctx.key(item.site_id, item.workorder_id) for item in payload.items]
    existing = await ctx.ledger.for_request(identity.user_id, payload.request_id)
    if existing:
        # A replayed request id returns what happened; it never routes again.
        wanted = {(key.site_id, key.workorder_id) for key in keys}
        if any((row.site_id, row.workorder_id) not in wanted for row in existing) or any(
            (row.connection_id, row.discipline) != (payload.connection_id, payload.discipline)
            for row in existing
        ):
            raise refuse(409, "request_id_conflict")
        return submission_json(payload.request_id, payload, replay_items(existing, keys))
    problem, _ = await ctx.contract()
    if problem is not None:
        raise refuse(409, "workflow_contract_changed", problem=problem)
    if ctx.credential is None:
        raise refuse(409, "route_session_required")
    lock = state.workflow_route_locks.setdefault(
        (payload.connection_id, ctx.account.personid), asyncio.Lock()
    )
    if lock.locked():
        raise refuse(409, "route_account_busy")

    async def run():
        async with lock:
            return await service.execute(ctx, payload.request_id, keys)

    # The work finishes and is recorded even if the browser disconnects.
    task = asyncio.create_task(run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    results = await asyncio.shield(task)
    return submission_json(payload.request_id, payload, results)


def replay_items(rows, keys) -> list[service.ItemResult]:
    by_key = {(row.site_id, row.workorder_id): service.result_from(row) for row in rows}
    return [
        by_key.get((key.site_id, key.workorder_id)) or service.not_attempted(key, "not_started")
        for key in keys
    ]


async def owned_submission(request: Request, request_id: UUID, *, csrf=False):
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        if csrf:
            verify_csrf(identity, request.headers.get("X-CSRF-Token"))
    rows = await PostgresLedger(request.app.state.sessions).for_request(
        identity.user_id, request_id
    )
    if not rows:
        raise refuse(404, "receipt_not_found")
    first = rows[0]
    scope = Scope(connection_id=first.connection_id, discipline=first.discipline)
    async with request.app.state.sessions() as db:
        for row in rows:
            await require_scope(
                db,
                identity.user_id,
                WorkOrderKey(row.connection_id, row.site_id, row.workorder_id),
                row.discipline,
                write=False,
            )
    return rows, scope


@router.get("/route-submissions/{request_id}")
async def submission(request: Request, request_id: UUID):
    rows, scope = await owned_submission(request, request_id)
    return submission_json(request_id, scope, [service.result_from(row) for row in rows])


@router.post("/route-submissions/{request_id}/reconcile")
async def reconcile_submission(request: Request, request_id: UUID, payload: EmptyCommand):
    rows, scope = await owned_submission(request, request_id, csrf=True)
    _, ctx = await build_context(request, scope)
    await service.reconcile(ctx, rows)
    fresh = await ctx.ledger.for_request(ctx.actor_id, request_id)
    return submission_json(request_id, scope, [service.result_from(row) for row in fresh])
