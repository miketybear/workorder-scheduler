"""Daily plan previews, one-shot durable sends and read-only mapping recovery."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from app.assignments.capacity import validate_capacity
from app.assignments.incremental import transaction_authority
from app.assignments.load import load_lock
from app.assignments.models import (
    Allocation,
    AssignmentEvent,
    AssignmentPlan,
    AssignmentPlanPreview,
    AssignmentPlanUpload,
)
from app.auth.person_access import verified_person_scope
from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.db.models import MaximoConnection, PlannerPermission, User
from app.maximo.daily_plan_sender import (
    build_daily_intent,
    read_daily_target,
    reconcile_daily_intent,
    send_daily_intent,
    snapshots,
)
from app.maximo.detail import read_detail
from app.maximo.reader import MaximoReadError
from app.maximo.task_load import effective_load, read_load
from app.maximo.task_sender import write_enabled
from app.maximo.tasks import read_tasks
from app.rota.activation_routes import pool_lock
from app.rota.models import PersonDayCapacity
from app.rota.routes import authority
from app.scheduling.drafts import require_scope
from app.scheduling.routes import checked_settings, digest


class PlanUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    plan_version: int = Field(ge=1, strict=True)
    preview_token: UUID


def enabled(request, settings, connection):
    return (
        request.app.state.settings.environment in {"test", "development"}
        and settings.assignment_daily_write_contract == "native_daily_assignment_rowstamp_test"
        and settings.task_load_contract == "bdsched_assignment_test"
        and write_enabled(settings, connection)
    )


async def plan_items(db, plan_id):
    plan = await db.get(AssignmentPlan, plan_id, populate_existing=True)
    items = list(
        (
            await db.scalars(
                select(Allocation)
                .where(Allocation.plan_id == plan_id, Allocation.state == "reserved")
                .order_by(Allocation.date, Allocation.id)
                .execution_options(populate_existing=True)
            )
        ).unique()
    )
    if not plan or not items:
        raise HTTPException(404, "Assignment plan not found")
    return plan, items


def segment_set(plan, items):
    return {
        "version": plan.version,
        "segments": [
            {
                "allocation_id": str(i.id),
                "version": i.version,
                "date": i.date.isoformat(),
                "minutes": i.minutes,
                "laborcode": i.laborcode,
                "person_id": str(i.person_id),
            }
            for i in items
        ],
    }


async def scoped_plan(request, plan_id, *, write=False, csrf=False, eligible=False):
    from app.assignments.routes import existing, key, read_scope

    async with request.app.state.sessions() as db:
        await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        _, items = await plan_items(db, plan_id)
    item = await existing(request, items[0].id)
    # Preview requires Planner but GET does not require CSRF.
    if write and not csrf:
        identity, settings = await checked_settings(request, key(item), item.discipline, write=True)
        await read_scope(request, key(item), item.discipline, require_eligible=eligible)
    else:
        identity = await read_scope(
            request, key(item), item.discipline, write=write, require_eligible=eligible
        )
        _, settings = await checked_settings(
            request, key(item), item.discipline, write=write, csrf=csrf
        )
    async with request.app.state.sessions() as db:
        actor, _, capability, connection = await authority(db, request, item.pool_id, False)
        if actor.user_id != identity.user_id:
            raise HTTPException(401, "Sign-in required")
        if write and capability.capability != "write":
            raise HTTPException(404, "Resource pool not found")
        if write and not await db.get(
            PlannerPermission, (identity.user_id, item.connection_id, item.discipline)
        ):
            raise HTTPException(404, "Work order not found")
    expected = getattr(request.state, "daily_connection_revisions", {})
    expected.setdefault(str(connection.id), connection_revision(connection))
    request.state.daily_connection_revisions = expected
    return item, identity, settings, connection


def connection_revision(connection):
    return digest(
        {
            k: str(getattr(connection, k))
            for k in (
                "id",
                "system",
                "environment",
                "base_url",
                "timezone",
                "enabled",
                "secret_reference",
            )
        }
    )


@asynccontextmanager
async def serialized(request, item, identity, settings, *, csrf=True, request_id=None):
    """Every phase uses the established User -> pool -> connection transaction order."""
    async with request.app.state.sessions() as db:
        async with db.begin():
            await db.execute(text("SET LOCAL lock_timeout='10s'"))
            await recheck(request, db, item, identity, settings, write=True, csrf=csrf)
            if request_id is not None:
                await db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                    {"key": "plan-upload-request:" + str(request_id)},
                )
            await pool_lock(db, item.pool_id, True)
            await load_lock(db, item.connection_id)
            yield db


async def current_remote_scope(request, db, item, identity, settings, *, eligible=False):
    from app.assignments.routes import key

    user = await db.get(User, identity.user_id, populate_existing=True)
    connection = await db.get(MaximoConnection, item.connection_id, populate_existing=True)
    discipline, _, unavailable = await verified_person_scope(
        request, db, user, connection, request.cookies.get(SESSION_COOKIE)
    )
    if unavailable or discipline != item.discipline:
        raise HTTPException(404, "Current PERSON scope is unavailable")
    async with request.app.state.maximo_client_factory() as client:
        order = await read_detail(client, settings, key(item), item.discipline)
    if order is None:
        raise HTTPException(404, "Work order not found")
    if eligible and (
        order.status not in settings.open_statuses or order.istask or order.parent not in (None, "")
    ):
        raise HTTPException(409, "Work order is no longer eligible for scheduling")
    await recheck(request, db, item, identity, settings, write=True, csrf=True)
    return connection


async def recheck(request, db, item, identity, settings, *, write, csrf):
    from app.assignments.routes import key

    actor, current = await transaction_authority(
        request, db, key(item), item.discipline, item.pool_id, write=csrf
    )
    if actor.user_id != identity.user_id or current != settings:
        raise HTTPException(409, "Session or connection configuration changed")
    await require_scope(db, actor.user_id, key(item), item.discipline, write=write)
    if write and not await db.get(
        PlannerPermission,
        (actor.user_id, item.connection_id, item.discipline),
        populate_existing=True,
    ):
        raise HTTPException(404, "Work order not found")
    if write and not csrf:
        _, _, capability, _ = await authority(db, request, item.pool_id, False)
        if capability.capability != "write":
            raise HTTPException(404, "Resource pool not found")
    fresh = await db.get(MaximoConnection, item.connection_id, populate_existing=True)
    expected = getattr(request.state, "daily_connection_revisions", {}).get(str(item.connection_id))
    if expected is None or connection_revision(fresh) != expected:
        raise HTTPException(409, "Connection registry changed during request")
    return actor


async def validate_plan(request, db, plan, items, settings, connection, start_time):
    from app.assignments.routes import key

    item = items[0]
    if (
        plan.state != "reserved"
        or plan.sync_state != "local"
        or any(i.sync_state != "local" for i in items)
    ):
        raise HTTPException(409, "Plan is already synced or upload is unresolved")
    if not enabled(request, settings, connection):
        raise HTTPException(409, "Daily assignment upload contract is not enabled")
    if (
        sum(i.minutes for i in items) != plan.demand_minutes
        or len(items) > 366
        or (items[-1].date - items[0].date).days >= 366
    ):
        raise HTTPException(409, "Upload requires the complete original plan demand")
    if any(
        i.person_id != plan.person_id
        or i.laborcode != plan.laborcode
        or i.assignment_id != plan.assignment_id
        or key(i) != key(item)
        or i.task_workorder_id != item.task_workorder_id
        or i.task_id != item.task_id
        or i.discipline != item.discipline
        for i in items
    ):
        raise HTTPException(409, "Plan segment identity changed")
    zone = ZoneInfo(connection.timezone)
    starts = [datetime.combine(i.date, time.fromisoformat(start_time), zone) for i in items]
    segments = [
        {"date": i.date, "scheduled_start": start, "minutes": i.minutes, "laborcode": i.laborcode}
        for i, start in zip(items, starts, strict=True)
    ]
    async with request.app.state.maximo_client_factory() as client:
        tasks = await read_tasks(client, settings, key(item), item.discipline)
        if not any(
            t.task_workorder_id == item.task_workorder_id
            and t.task_id == item.task_id
            and any(a.assignment_id == item.assignment_id for a in t.assignments)
            for t in tasks
        ):
            raise HTTPException(404, "Task assignment not found")
        target = await read_daily_target(
            client,
            settings,
            item.site_id,
            item.task_workorder_id,
            item.assignment_id,
            item.discipline,
        )
        if any(
            i.upstream_baseline
            and i.upstream_baseline.get("revision") != str(target["assignment"]["_rowstamp"])
            for i in items
        ):
            raise HTTPException(409, "Source assignment revision changed")
        try:
            intent = build_daily_intent(target, item.assignment_id, segments, connection.timezone)
        except (ValueError, KeyError):
            raise HTTPException(
                409, "Daily plan no longer matches its source or business dates"
            ) from None
    await check_capacity(request, db, plan, items, settings, connection)
    intent.update(
        segment_set=segment_set(plan, items),
        start_time=start_time,
        target=target,
        connection_revision=connection_revision(connection),
        config_revision=digest(
            {
                "settings": settings.model_dump(mode="json"),
                "credential": settings.api_key.get_secret_value(),
                "timezone": connection.timezone,
            }
        ),
    )
    return intent


async def check_capacity(request, db, plan, items, settings, connection):
    item = items[0]
    async with request.app.state.maximo_client_factory() as client:
        remote = {}
        start = items[0].date
        before = items[-1].date + timedelta(days=1)
        while start < before:
            end = min(before, start + timedelta(days=31))
            remote.update(
                await read_load(client, settings, {plan.laborcode}, start, end, connection.timezone)
            )
            start = end
    local = list(
        (
            await db.scalars(
                select(Allocation)
                .where(
                    Allocation.connection_id == item.connection_id, Allocation.state == "reserved"
                )
                .execution_options(populate_existing=True)
            )
        ).unique()
    )
    for i in items:
        day = await db.get(
            PersonDayCapacity, (i.pool_id, i.person_id, i.date), populate_existing=True
        )
        if not day or (day.laborcode, day.craft, day.role) != (i.laborcode, i.craft, i.role):
            raise HTTPException(409, "Rota binding changed")
        validate_capacity(
            day, 0, effective_load(local, remote, i.laborcode, i.date)["allocated_minutes"]
        )


async def preview(request, plan_id, start_time):

    item, identity, settings, connection = await scoped_plan(
        request, plan_id, write=True, eligible=True
    )
    async with serialized(request, item, identity, settings, csrf=False) as db:
        plan, items = await plan_items(db, plan_id)
        intent = await validate_plan(request, db, plan, items, settings, connection, start_time)
        await recheck(request, db, item, identity, settings, write=True, csrf=False)
        row = AssignmentPlanPreview(
            actor_id=identity.user_id,
            plan_id=plan_id,
            expires_at=datetime.now(UTC) + timedelta(seconds=120),
            intent=intent,
        )
        db.add(row)
        await db.flush()
        token = row.id
        expires = row.expires_at
        await db.commit()
    segments = []
    for i, s in zip(items, intent["segments"], strict=True):
        start = datetime.fromisoformat(s["scheduled_start"])
        segments.append(
            {
                "allocation_id": str(i.id),
                "version": i.version,
                "date": i.date.isoformat(),
                "minutes": i.minutes,
                "scheduled_start": start.isoformat(),
                "scheduled_finish": (start.astimezone(UTC) + timedelta(minutes=i.minutes))
                .astimezone(ZoneInfo(connection.timezone))
                .isoformat(),
                "remote_assignment_id": i.remote_assignment_id,
            }
        )
    return {
        "plan_id": str(plan.id),
        "plan_version": plan.version,
        "preview_token": str(token),
        "expires_at": expires.isoformat(),
        "timezone": connection.timezone,
        "source_assignment_id": plan.assignment_id,
        "connection_id": str(item.connection_id),
        "site_id": item.site_id,
        "workorder_id": item.workorder_id,
        "task_workorder_id": item.task_workorder_id,
        "task_id": item.task_id,
        "person_id": str(plan.person_id),
        "laborcode": plan.laborcode,
        "segments": segments,
        "total_minutes": plan.demand_minutes,
        "can_upload": True,
        "reason": None,
    }


def attempt_view(attempt, items):
    from app.assignments.routes import view

    return {
        "attempt_id": str(attempt.id),
        "request_id": str(attempt.request_id),
        "plan_id": str(attempt.plan_id),
        "state": attempt.state,
        "mapping": attempt.mapping,
        "items": [view(i) for i in items],
    }


async def outcome(request, db, attempt, items, readback, identity, settings, response=None):
    item = items[0]
    await current_remote_scope(request, db, item, identity, settings)
    await recheck(request, db, item, identity, settings, write=True, csrf=True)
    plan, items = await plan_items(db, attempt.plan_id)
    attempt = await db.get(AssignmentPlanUpload, attempt.id, populate_existing=True)
    if attempt.state != "unknown":
        return attempt_view(attempt, items)
    if (
        segment_set(plan, items) != attempt.intent["segment_set"]
        or plan.sync_state != "unknown"
        or any(i.sync_state != "unknown" for i in items)
    ):
        raise HTTPException(409, "Plan changed while upload outcome remains unresolved")
    result = (
        reconcile_daily_intent(attempt.intent, readback, attempt.mapping)
        if readback
        else {"state": "unknown"}
    )
    state = "unknown"
    mapping = None
    if result["state"] == "confirmed":
        state = "confirmed"
        mapping = [
            {"allocation_id": str(i.id), **m} for i, m in zip(items, result["mapping"], strict=True)
        ]
        for i, m in zip(items, mapping, strict=True):
            i.remote_assignment_id = m["assignment_id"]
            i.sync_state = "synced"
        plan.sync_state = "synced"
    elif (
        response in {"failed", "conflict"}
        and readback
        and readback["resource_id"] == attempt.intent["resource_id"]
        and readback["root_revision"] == attempt.intent["root_revision"]
        and snapshots(readback["assignments"]) == attempt.intent["before"]
    ):
        state = response
        plan.sync_state = "local"
        for i in items:
            i.sync_state = "local"
    attempt.state = state
    attempt.mapping = mapping
    for i in items:
        db.add(
            AssignmentEvent(
                actor_id=identity.user_id,
                allocation_id=i.id,
                event="plan_upload_outcome",
                details={"attempt_id": str(attempt.id), "state": state, "mapping": mapping},
            )
        )
    await db.flush()
    result = attempt_view(attempt, items)
    await db.commit()
    return result


async def submit(request, plan_id, body):
    item, identity, settings, connection = await scoped_plan(
        request, plan_id, write=True, csrf=True, eligible=True
    )
    request_hash = digest({"plan_id": str(plan_id), "body": body.model_dump(mode="json")})
    async with serialized(request, item, identity, settings, request_id=body.request_id) as db:
        plan, items = await plan_items(db, plan_id)
        previous = await db.scalar(
            select(AssignmentPlanUpload).where(AssignmentPlanUpload.request_id == body.request_id)
        )
        if previous:
            if previous.actor_id != identity.user_id or previous.request_hash != request_hash:
                raise HTTPException(409, "Request ID already used for different upload")
            await recheck(request, db, item, identity, settings, write=True, csrf=True)
            return attempt_view(previous, items)
        row = await db.get(AssignmentPlanPreview, body.preview_token)
        if (
            not row
            or row.actor_id != identity.user_id
            or row.plan_id != plan_id
            or row.expires_at <= datetime.now(UTC)
        ):
            raise HTTPException(409, "Upload preview expired or unavailable")
        if body.plan_version != plan.version or row.intent["segment_set"] != segment_set(
            plan, items
        ):
            raise HTTPException(409, "Plan changed after preview")
        intent = await validate_plan(
            request, db, plan, items, settings, connection, row.intent["start_time"]
        )
        if intent != row.intent:
            raise HTTPException(409, "Remote source or plan changed after preview")
        await recheck(request, db, item, identity, settings, write=True, csrf=True)
        attempt = AssignmentPlanUpload(
            actor_id=identity.user_id,
            request_id=body.request_id,
            plan_id=plan_id,
            version=plan.version,
            request_hash=request_hash,
            state="unknown",
            intent=intent,
        )
        db.add(attempt)
        await db.flush()
        plan.sync_state = "unknown"
        for i in items:
            i.sync_state = "unknown"
            db.add(
                AssignmentEvent(
                    actor_id=identity.user_id,
                    allocation_id=i.id,
                    event="plan_upload_intent",
                    details={
                        "attempt_id": str(attempt.id),
                        "payload": intent["payload"],
                        "segment_set": intent["segment_set"],
                    },
                )
            )
        request.state.plan_upload_not_sent = False
        await db.commit()
    # Unknown reservations remain fully counted while the first transaction releases locks.
    # A duplicate returns that receipt; only this newly committed attempt proceeds to send.
    item, refreshed, refreshed_settings, _ = await scoped_plan(
        request, plan_id, write=True, csrf=True, eligible=True
    )
    if refreshed.user_id != identity.user_id or refreshed_settings != settings:
        raise HTTPException(409, "Session or connection configuration changed")
    async with serialized(request, item, identity, settings) as db:
        plan, items = await plan_items(db, plan_id)
        attempt = await db.get(AssignmentPlanUpload, attempt.id, populate_existing=True)
        if (
            attempt.state != "unknown"
            or plan.sync_state != "unknown"
            or any(i.sync_state != "unknown" for i in items)
            or segment_set(plan, items) != intent["segment_set"]
        ):
            raise HTTPException(409, "Plan changed before upload send")
        connection = await db.get(MaximoConnection, item.connection_id, populate_existing=True)
        await check_capacity(request, db, plan, items, settings, connection)
        async with request.app.state.maximo_client_factory() as client:
            fresh_target = await read_daily_target(
                client,
                settings,
                item.site_id,
                item.task_workorder_id,
                item.assignment_id,
                item.discipline,
            )
        if fresh_target != intent["target"]:
            raise HTTPException(409, "Source assignment changed before upload send")
        connection = await current_remote_scope(
            request, db, item, identity, settings, eligible=True
        )
        if connection_revision(connection) != intent["connection_revision"] or not enabled(
            request, settings, connection
        ):
            raise HTTPException(409, "Connection registry changed before upload send")
        async with request.app.state.maximo_client_factory() as client:
            response = await send_daily_intent(
                client,
                settings,
                connection,
                intent,
                attempt.id,
                app_environment=request.app.state.settings.environment,
            )
            try:
                readback = await read_daily_target(
                    client,
                    settings,
                    item.site_id,
                    item.task_workorder_id,
                    item.assignment_id,
                    item.discipline,
                )
            except MaximoReadError:
                readback = None
        return await outcome(request, db, attempt, items, readback, identity, settings, response)


async def authorized_attempt(request, attempt_id, *, write=False):
    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        attempt = await db.get(AssignmentPlanUpload, attempt_id)
        if not attempt or attempt.actor_id != actor.user_id:
            raise HTTPException(404, "Plan upload not found")
    item, identity, settings, _ = await scoped_plan(
        request, attempt.plan_id, write=write, csrf=write
    )
    if identity.user_id != attempt.actor_id:
        raise HTTPException(404, "Plan upload not found")
    return attempt, item, identity, settings


def register(router):
    @router.get("/assignment-plans/{plan_id}/upload-status")
    async def status(request: Request, plan_id: UUID):
        item, identity, settings, _ = await scoped_plan(request, plan_id)
        async with request.app.state.sessions() as db:
            attempt = await db.scalar(
                select(AssignmentPlanUpload)
                .where(
                    AssignmentPlanUpload.actor_id == identity.user_id,
                    AssignmentPlanUpload.plan_id == plan_id,
                    AssignmentPlanUpload.state.in_(["unknown", "confirmed"]),
                )
                .order_by(AssignmentPlanUpload.created_at.desc(), AssignmentPlanUpload.id.desc())
                .limit(1)
            )
            if not attempt:
                raise HTTPException(404, "Plan upload not found")
            _, items = await plan_items(db, plan_id)
            await recheck(request, db, item, identity, settings, write=False, csrf=False)
            return attempt_view(attempt, items)

    @router.get("/assignment-plans/{plan_id}/upload-preview")
    async def get_preview(
        request: Request,
        plan_id: UUID,
        start_time: str = Query(default="06:30", pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$"),
    ):
        if any(
            k != "start_time" or len(request.query_params.getlist(k)) != 1
            for k in request.query_params
        ):
            raise HTTPException(422, "Unsupported or duplicate query parameter")
        return await preview(request, plan_id, start_time)

    @router.post("/assignment-plans/{plan_id}/upload")
    async def upload(request: Request, plan_id: UUID, body: PlanUploadRequest):
        request.state.plan_upload_not_sent = True
        try:
            return await submit(request, plan_id, body)
        except HTTPException as error:
            if getattr(request.state, "plan_upload_not_sent", False):
                try:
                    async with request.app.state.sessions() as db:
                        previous = await db.scalar(
                            select(AssignmentPlanUpload.id).where(
                                AssignmentPlanUpload.request_id == body.request_id
                            )
                        )
                    if previous is None:
                        raise HTTPException(
                            error.status_code,
                            {"message": error.detail, "outcome": "not_sent"},
                            headers=error.headers,
                        ) from None
                except SQLAlchemyError:
                    # Failed receipt I/O cannot prove the request was never committed.
                    pass
            raise

    @router.get("/assignment-plan-upload-submissions/{request_id}")
    async def receipt(request: Request, request_id: UUID):
        async with request.app.state.sessions() as db:
            actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
            attempt = await db.scalar(
                select(AssignmentPlanUpload).where(
                    AssignmentPlanUpload.actor_id == actor.user_id,
                    AssignmentPlanUpload.request_id == request_id,
                )
            )
            if not attempt:
                raise HTTPException(404, "Plan upload not found")
        return await get_attempt(request, attempt.id)

    @router.get("/assignment-plan-uploads/{attempt_id}")
    async def get_attempt(request: Request, attempt_id: UUID):
        attempt, item, identity, settings = await authorized_attempt(request, attempt_id)
        async with request.app.state.sessions() as db:
            _, items = await plan_items(db, attempt.plan_id)
            await recheck(request, db, item, identity, settings, write=False, csrf=False)
            return attempt_view(attempt, items)

    @router.post("/assignment-plan-uploads/{attempt_id}/reconcile")
    async def reconcile(request: Request, attempt_id: UUID):
        attempt, item, identity, settings = await authorized_attempt(
            request, attempt_id, write=True
        )
        async with serialized(request, item, identity, settings) as db:
            attempt = await db.get(AssignmentPlanUpload, attempt_id, populate_existing=True)
            _, items = await plan_items(db, attempt.plan_id)
            if attempt.state != "unknown":
                await recheck(request, db, item, identity, settings, write=True, csrf=True)
                return attempt_view(attempt, items)
            async with request.app.state.maximo_client_factory() as client:
                try:
                    readback = await read_daily_target(
                        client,
                        settings,
                        item.site_id,
                        item.task_workorder_id,
                        item.assignment_id,
                        item.discipline,
                    )
                except MaximoReadError:
                    readback = None
            return await outcome(request, db, attempt, items, readback, identity, settings)
