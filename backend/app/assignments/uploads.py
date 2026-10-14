"""Durable single-assignment intent, conditional send and read-only recovery."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.assignments.load import validate_remote_capacity
from app.assignments.models import Allocation, AssignmentEvent, AssignmentUpload
from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.db.models import MaximoConnection
from app.maximo.reader import MaximoReadError
from app.maximo.task_sender import (
    payload,
    read_target,
    send_assignment,
    siblings_unchanged,
    write_enabled,
)
from app.maximo.tasks import read_tasks
from app.rota.activation_routes import pool_lock
from app.rota.models import PersonDayCapacity
from app.rota.routes import authority
from app.scheduling.drafts import require_scope
from app.scheduling.routes import actor_after_io, checked_settings, digest


class UploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1, strict=True)
    request_id: UUID
    scheduled_start: AwareDatetime


def view_attempt(attempt):
    return {
        "attempt_id": str(attempt.id),
        "allocation_id": str(attempt.allocation_id),
        "request_id": str(attempt.request_id),
        "state": attempt.state,
    }


def matches_readback(row, intended):
    try:
        return (
            row.get("laborcode") == intended["laborcode"]
            and datetime.fromisoformat(row["scheduledate"])
            == datetime.fromisoformat(intended["scheduledate"])
            and Decimal(str(row["laborhrs"])) == Decimal(str(intended["laborhrs"]))
        )
    except (ValueError, TypeError, KeyError):
        return False


async def finish(request, attempt_id, state, identity):
    from app.assignments.routes import key

    async with request.app.state.sessions() as db, db.begin():
        actor = await actor_after_io(request, db, identity)
        attempt = await db.get(AssignmentUpload, attempt_id)
        item = await db.get(Allocation, attempt.allocation_id)
        await pool_lock(db, item.pool_id, True)
        attempt = await db.get(AssignmentUpload, attempt_id, populate_existing=True)
        item = await db.get(Allocation, attempt.allocation_id, populate_existing=True)
        await authority(db, request, item.pool_id, True)
        await require_scope(db, actor.user_id, key(item), item.discipline, write=True)
        if attempt.state == "unknown":
            attempt.state = state
            item.sync_state = (
                "synced"
                if state == "confirmed"
                else "local"
                if state in {"failed", "conflict"}
                else "unknown"
            )
            db.add(
                AssignmentEvent(
                    actor_id=actor.user_id,
                    allocation_id=item.id,
                    event="upload_outcome",
                    details={"attempt_id": str(attempt.id), "state": state},
                )
            )
        return view_attempt(attempt)


async def upload(request, allocation_id, body):
    from app.assignments.routes import existing, key, read_scope

    item = await existing(request, allocation_id)
    identity = await read_scope(
        request, key(item), item.discipline, write=True, require_eligible=True
    )
    _, settings = await checked_settings(request, key(item), item.discipline, write=True, csrf=True)
    request_hash = digest(
        {"allocation_id": str(allocation_id), "body": body.model_dump(mode="json")}
    )
    async with request.app.state.sessions() as db:
        previous = await db.scalar(
            select(AssignmentUpload).where(
                AssignmentUpload.actor_id == identity.user_id,
                AssignmentUpload.request_id == body.request_id,
            )
        )
        if previous:
            if previous.request_hash != request_hash:
                raise HTTPException(409, "Request ID already used for different upload")
            return view_attempt(previous)
        # Only a new request with no prior intent can safely report a pre-send rejection.
        request.state.assignment_upload_not_sent = True
        request.state.assignment_upload_actor_id = identity.user_id
        if item.plan_id is not None:
            raise HTTPException(409, "Multi-day task plans are local only and cannot be uploaded")
        connection = await db.get(MaximoConnection, item.connection_id)
        if not write_enabled(
            settings, connection
        ) or request.app.state.settings.environment not in {"test", "development"}:
            raise HTTPException(409, "Assignment upload contract is not verified")
        if body.scheduled_start.astimezone(ZoneInfo(connection.timezone)).date() != item.date:
            raise HTTPException(422, "Scheduled start must be on the allocation day")
    if (
        not item.task_workorder_id
        or item.state != "reserved"
        or item.sync_state != "local"
        or item.version != body.version
    ):
        raise HTTPException(409, "Task allocation changed or upload is unresolved")
    async with request.app.state.maximo_client_factory() as client:
        tasks = await read_tasks(client, settings, key(item), item.discipline)
        if not any(
            t.task_workorder_id == item.task_workorder_id
            and t.task_id == item.task_id
            and any(a.assignment_id == item.assignment_id for a in t.assignments)
            for t in tasks
        ):
            raise HTTPException(404, "Task assignment not found")
        target = await read_target(client, settings, item)
    remote = target["assignment"]
    if remote.get("laborcode") or remote.get("scheduledate") or remote.get("status") != "WAITASGN":
        raise HTTPException(409, "Remote assignment changed; reload before upload")
    if item.upstream_baseline and str(remote.get("_rowstamp")) != item.upstream_baseline.get(
        "revision"
    ):
        raise HTTPException(409, "Remote assignment revision changed")
    intent = payload(target, item, body.scheduled_start.isoformat())
    async with request.app.state.sessions() as db, db.begin():
        actor = await actor_after_io(request, db, identity)
        await pool_lock(db, item.pool_id, True)
        await authority(db, request, item.pool_id, True)
        await require_scope(db, actor.user_id, key(item), item.discipline, write=True)
        current = await db.get(Allocation, item.id, populate_existing=True)
        previous = await db.scalar(
            select(AssignmentUpload).where(
                AssignmentUpload.actor_id == actor.user_id,
                AssignmentUpload.request_id == body.request_id,
            )
        )
        if previous:
            if previous.request_hash != request_hash:
                raise HTTPException(409, "Request ID already used for different upload")
            return view_attempt(previous)
        if (
            current.version != body.version
            or current.sync_state != "local"
            or current.state != "reserved"
        ):
            raise HTTPException(409, "Task allocation changed or upload is unresolved")
        day = await db.get(PersonDayCapacity, (item.pool_id, item.person_id, item.date))
        await validate_remote_capacity(
            request, db, settings, day, item.connection_id, item.minutes, item.id
        )
        await actor_after_io(request, db, identity)
        await require_scope(db, actor.user_id, key(item), item.discipline, write=True)
        await authority(db, request, item.pool_id, True)
        attempt = AssignmentUpload(
            actor_id=actor.user_id,
            request_id=body.request_id,
            allocation_id=item.id,
            version=body.version,
            request_hash=request_hash,
            intent={"payload": intent, "target": target, "baseline": remote},
            state="unknown",
        )
        db.add(attempt)
        await db.flush()
        current.sync_state = "unknown"
        db.add(
            AssignmentEvent(
                actor_id=actor.user_id,
                allocation_id=item.id,
                event="upload_intent",
                details={"attempt_id": str(attempt.id), "payload": intent},
            )
        )
        attempt_id = attempt.id
    # The intent commits before any outbound mutation. Unknown is the crash-safe state.
    request.state.assignment_upload_not_sent = False
    await read_scope(request, key(item), item.discipline, write=True, require_eligible=True)
    async with request.app.state.sessions() as db:
        current_actor, _, _, _ = await authority(db, request, item.pool_id, True)
        if current_actor.user_id != identity.user_id:
            raise HTTPException(401, "Sign-in required")
        await require_scope(db, current_actor.user_id, key(item), item.discipline, write=True)
    async with request.app.state.maximo_client_factory() as client:
        outcome = await send_assignment(client, settings, target, intent, attempt_id)
        if outcome == "accepted":
            try:
                readback = await read_target(client, settings, item)
                outcome = (
                    "confirmed"
                    if (
                        matches_readback(readback["assignment"], intent["assignment"][0])
                        and siblings_unchanged(target, readback, item.assignment_id)
                    )
                    else "unknown"
                )
            except MaximoReadError:
                outcome = "unknown"
    return await finish(request, attempt_id, outcome, identity)


def register(router):
    @router.get("/assignment-upload-submissions/{request_id}")
    async def receipt(request: Request, request_id: UUID):
        async with request.app.state.sessions() as db:
            actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
            attempt = await db.scalar(
                select(AssignmentUpload).where(
                    AssignmentUpload.actor_id == actor.user_id,
                    AssignmentUpload.request_id == request_id,
                )
            )
            if not attempt:
                raise HTTPException(404, "Assignment upload not found")
        checked, _, _ = await authorized_attempt(request, attempt.id)
        return view_attempt(checked)

    @router.post("/assignments/{allocation_id}/upload")
    async def submit(request: Request, allocation_id: UUID, body: UploadRequest):
        try:
            return await upload(request, allocation_id, body)
        except HTTPException as error:
            if getattr(
                request.state, "assignment_upload_not_sent", False
            ) and await verified_no_intent(request, body.request_id):
                raise HTTPException(
                    error.status_code,
                    {
                        "message": error.detail,
                        "outcome": "not_sent",
                        "request_id": str(body.request_id),
                    },
                    headers=error.headers,
                ) from None
            raise

    @router.get("/assignment-uploads/{attempt_id}")
    async def get_attempt(request: Request, attempt_id: UUID):
        attempt, _, _ = await authorized_attempt(request, attempt_id)
        return view_attempt(attempt)

    @router.post("/assignment-uploads/{attempt_id}/reconcile")
    async def reconcile(request: Request, attempt_id: UUID):
        attempt, item, identity = await authorized_attempt(request, attempt_id, write=True)
        if attempt.state != "unknown":
            return view_attempt(attempt)
        _, settings = await checked_settings(
            request, key_for(item), item.discipline, write=True, csrf=True
        )
        async with request.app.state.maximo_client_factory() as client:
            current = await read_target(client, settings, item)
        state = (
            "confirmed"
            if (
                matches_readback(current["assignment"], attempt.intent["payload"]["assignment"][0])
                and siblings_unchanged(attempt.intent["target"], current, item.assignment_id)
            )
            else "unknown"
        )
        return await finish(request, attempt_id, state, identity)


def key_for(item):
    from app.assignments.routes import key

    return key(item)


async def authorized_attempt(request, attempt_id, write=False):
    from app.assignments.routes import existing, read_scope

    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        attempt = await db.get(AssignmentUpload, attempt_id)
        if not attempt or attempt.actor_id != actor.user_id:
            raise HTTPException(404, "Assignment upload not found")
    item = await existing(request, attempt.allocation_id)
    identity = await read_scope(request, key_for(item), item.discipline, write=write)
    return attempt, item, identity


async def verified_no_intent(request, request_id):
    """A concurrent duplicate can commit after the initial receipt lookup misses."""
    actor_id = getattr(request.state, "assignment_upload_actor_id", None)
    if actor_id is None:
        return False
    try:
        async with request.app.state.sessions() as db:
            attempt_id = await db.scalar(
                select(AssignmentUpload.id).where(
                    AssignmentUpload.actor_id == actor_id, AssignmentUpload.request_id == request_id
                )
            )
        return attempt_id is None
    except SQLAlchemyError:
        # Without a reliable receipt read, the response must retain uncertainty.
        return False
