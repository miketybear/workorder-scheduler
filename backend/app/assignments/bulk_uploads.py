"""Durable month discovery and sequential, explicitly confirmed per-plan synchronization."""

from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import defer

from app.assignments import plan_uploads
from app.assignments.capacity import validate_capacity
from app.assignments.load import load_lock
from app.assignments.models import (
    Allocation,
    AssignmentPlanUpload,
)
from app.assignments.models import (
    AssignmentPlanUploadBatch as Batch,
)
from app.assignments.models import (
    AssignmentPlanUploadBatchItem as BatchItem,
)
from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.db.models import AccessGrant, PlannerPermission
from app.maximo.connections import configured_connection
from app.maximo.reader import MaximoReadError
from app.rota.activation_routes import pool_lock
from app.rota.models import PersonDayCapacity
from app.rota.routes import authority
from app.scheduling.routes import digest

STATES = (
    "pending",
    "ready",
    "blocked",
    "skipped",
    "queued",
    "sending",
    "confirmed",
    "failed",
    "conflict",
    "unknown",
)


def bounds(month):
    start = date.fromisoformat(month + "-01")
    before = (
        date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    )
    return start, before


class CreateBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    month: str = Field(pattern=r"^[0-9]{4}-(?:0[1-9]|1[0-2])$")
    start_time: str = Field(default="06:30", pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")

    @field_validator("month")
    @classmethod
    def real_month(cls, value):
        bounds(value)
        return value


class Confirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID


class ContinueBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: UUID


async def pool_scope(request, db, pool_id, *, write=False):
    identity, pool, capability, connection = await authority(db, request, pool_id, write)
    grants = list(
        await db.scalars(
            select(AccessGrant).where(
                AccessGrant.user_id == identity.user_id,
                AccessGrant.connection_id == connection.id,
                AccessGrant.capability.in_(["write"] if write else ["read", "write"]),
            )
        )
    )
    if len(grants) != 1:
        raise HTTPException(404, "Resource scope unavailable")
    discipline = grants[0].discipline
    if write and (
        capability.capability != "write"
        or not await db.get(PlannerPermission, (identity.user_id, connection.id, discipline))
    ):
        raise HTTPException(404, "Resource scope unavailable")
    return identity, pool, connection, discipline


async def batch_scope(request, db, batch_id, *, write=False, lock=False):
    actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
    batch = await db.get(Batch, batch_id)
    if not batch or batch.actor_id != actor.user_id:
        raise HTTPException(404, "Upload batch not found")
    identity, _, connection, discipline = await pool_scope(request, db, batch.pool_id, write=write)
    if (
        identity.user_id != batch.actor_id
        or connection.id != batch.connection_id
        or discipline != batch.discipline
    ):
        raise HTTPException(404, "Upload batch not found")
    if lock:
        batch = await db.scalar(
            select(Batch)
            .where(Batch.id == batch.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    return batch, identity, connection


async def rows(db, batch_id):
    return list(
        await db.scalars(
            select(BatchItem)
            .where(BatchItem.batch_id == batch_id)
            .order_by(BatchItem.position)
            .options(defer(BatchItem.frozen), defer(BatchItem.proposal), defer(BatchItem.labels))
            .execution_options(populate_existing=True)
        )
    )


def update_state(batch, items):
    counts = Counter(i.state for i in items)
    if batch.confirmation_request_id:
        batch.state = "running" if counts["queued"] or counts["sending"] else "completed"
    elif counts["pending"]:
        batch.state = "previewing"
    else:
        batch.state = "ready"
        if batch.expires_at is None:
            batch.expires_at = datetime.now(UTC) + timedelta(seconds=120)


def frozen(items):
    from app.assignments.routes import view

    return [
        {**view(i), "_source_baseline": i.upstream_baseline}
        for i in sorted(items, key=lambda i: (i.date, i.id))
    ]


def proposal(item, all_items, connection, start_time):
    zone = ZoneInfo(connection.timezone)
    segments = []
    for i in all_items:
        start = datetime.combine(i.date, time.fromisoformat(start_time), zone)
        finish = (start.astimezone(UTC) + timedelta(minutes=i.minutes)).astimezone(zone)
        segments.append(
            {
                "allocation_id": str(i.id),
                "version": i.version,
                "date": i.date.isoformat(),
                "minutes": i.minutes,
                "scheduled_start": start.isoformat(),
                "scheduled_finish": finish.isoformat(),
            }
        )
    return {
        "plan_id": str(item.plan_id) if item.plan_id else None,
        "allocation_id": str(item.id) if item.plan_id is None else None,
        "connection_id": str(item.connection_id),
        "site_id": item.site_id,
        "workorder_id": item.workorder_id,
        "wonum": None,
        "workorder_description": None,
        "task_workorder_id": item.task_workorder_id,
        "task_id": item.task_id,
        "task_description": item.task_description,
        "person_id": str(item.person_id),
        "person_name": None,
        "laborcode": item.laborcode,
        "source_assignment_id": item.assignment_id,
        "plan_version": item.plan.version if item.plan else None,
        "total_minutes": item.plan.demand_minutes if item.plan else item.minutes,
        "segments": segments,
    }


async def refresh_receipts(db, batch, items):
    for i in items:
        if i.state not in {"sending", "unknown"}:
            continue
        attempt = await db.scalar(
            select(AssignmentPlanUpload).where(
                AssignmentPlanUpload.actor_id == batch.actor_id,
                AssignmentPlanUpload.request_id == i.request_id,
                AssignmentPlanUpload.plan_id == i.plan_id,
            )
        )
        if attempt:
            i.attempt_id = attempt.id
            if attempt.state != "unknown":
                i.state = attempt.state
                i.reason = None
            elif (
                i.state == "unknown"
                or i.claimed_until is None
                or i.claimed_until <= datetime.now(UTC)
            ):
                i.state = "unknown"
                i.reason = "outcome_unresolved"
        elif i.claimed_until is None or i.claimed_until <= datetime.now(UTC):
            i.state = "unknown"
            i.reason = "claimed_outcome_unresolved"
    update_state(batch, items)


async def item_view(request, db, batch, item):
    from app.assignments.routes import existing, key, read_scope

    item = await db.get(BatchItem, item.id, populate_existing=True)
    base = {
        "item_id": str(item.id),
        "kind": "plan" if item.plan_id else "legacy",
        "state": item.state,
        "reason": item.reason,
    }
    try:
        allocation = await existing(request, item.allocation_id)
        identity = await read_scope(request, key(allocation), allocation.discipline)
        if (
            identity.user_id != batch.actor_id
            or allocation.discipline != batch.discipline
            or allocation.connection_id != batch.connection_id
        ):
            raise HTTPException(404, "Scope unavailable")
    except (HTTPException, MaximoReadError):
        return {**base, "reason": "scope_unavailable"}
    result = {
        **base,
        **item.proposal,
        **(item.labels or {}),
        "attempt_id": str(item.attempt_id) if item.attempt_id else None,
        "receipt": None,
    }
    descriptors = getattr(request.state, "assignment_work_orders", {}).get(
        (
            allocation.connection_id,
            allocation.site_id,
            allocation.workorder_id,
            allocation.discipline,
        ),
        {},
    )
    result["wonum"] = descriptors.get("wonum", result["wonum"])
    result["workorder_description"] = descriptors.get(
        "description", result["workorder_description"]
    )
    if item.attempt_id:
        attempt = await db.get(AssignmentPlanUpload, item.attempt_id)
        if attempt and attempt.actor_id == batch.actor_id:
            _, current_items = await plan_uploads.plan_items(db, item.plan_id)
            result["receipt"] = plan_uploads.attempt_view(attempt, current_items)
    return result


async def envelope(request, batch_id, *, cursor=None, changed_id=None):
    await sync_person_access(request, request.cookies.get(SESSION_COOKIE))
    async with request.app.state.sessions() as db:
        batch, _, _ = await batch_scope(request, db, batch_id, lock=True)
        items = await rows(db, batch.id)
        await refresh_receipts(db, batch, items)
        await db.commit()
        counts = {state: sum(i.state == state for i in items) for state in STATES}
        counts["total"] = len(items)
        next_item = None
        if not counts["sending"]:
            wanted = (
                "pending"
                if batch.state == "previewing"
                else "queued"
                if batch.state == "running"
                else None
            )
            next_item = next((str(i.id) for i in items if i.state == wanted), None)
        page = []
        next_cursor = None
        has_more = False
        if cursor is not None:
            offset = int(cursor)
            chosen = items[offset : offset + 20]
            for item in chosen:
                page.append(await item_view(request, db, batch, item))
            has_more = offset + len(chosen) < len(items)
            if has_more:
                next_cursor = str(offset + len(chosen))
        changed = next((i for i in items if i.id == changed_id), None)
        changed_view = await item_view(request, db, batch, changed) if changed else None
        # PERSON sync or network I/O must not permit releasing another actor's ledger.
        current, _, _ = await batch_scope(request, db, batch.id)
        return {
            "batch_id": str(current.id),
            "request_id": str(current.request_id),
            "confirmation_request_id": str(current.confirmation_request_id)
            if current.confirmation_request_id
            else None,
            "pool_id": str(current.pool_id),
            "connection_id": str(current.connection_id),
            "discipline": current.discipline,
            "month": current.month,
            "start_time": current.start_time,
            "state": current.state,
            "expires_at": current.expires_at.isoformat() if current.expires_at else None,
            "counts": counts,
            "next_item_id": next_item,
            "items": page,
            "has_more": has_more,
            "next_cursor": next_cursor,
            "changed_item": changed_view,
        }


async def uuid_lock(db, request_id):
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": "plan-batch-request:" + str(request_id)},
    )


async def request_owner(db, request_id):
    return await db.scalar(
        select(Batch).where(
            or_(Batch.request_id == request_id, Batch.confirmation_request_id == request_id)
        )
    )


async def create(request, pool_id, body):
    await sync_person_access(request, request.cookies.get(SESSION_COOKIE))
    start, before = bounds(body.month)
    request_hash = digest({"pool_id": str(pool_id), "body": body.model_dump(mode="json")})
    async with request.app.state.sessions() as db, db.begin():
        actor, _, connection, discipline = await pool_scope(request, db, pool_id, write=True)
        await uuid_lock(db, body.request_id)
        previous = await request_owner(db, body.request_id)
        if previous:
            if (
                previous.actor_id != actor.user_id
                or previous.request_id != body.request_id
                or previous.request_hash != request_hash
            ):
                raise HTTPException(409, "Request ID already used for different batch")
            batch_id = previous.id
        else:
            await pool_lock(db, pool_id, True)
            await load_lock(db, connection.id)
            candidates = list(
                (
                    await db.scalars(
                        select(Allocation)
                        .where(
                            Allocation.pool_id == pool_id,
                            Allocation.connection_id == connection.id,
                            Allocation.discipline == discipline,
                            Allocation.state == "reserved",
                            Allocation.date >= start,
                            Allocation.date < before,
                        )
                        .order_by(Allocation.date, Allocation.id)
                    )
                ).unique()
            )
            units = []
            seen = set()
            for i in candidates:
                marker = ("plan", i.plan_id) if i.plan_id else ("legacy", i.id)
                if marker in seen:
                    continue
                seen.add(marker)
                if len(seen) > 1000:
                    raise HTTPException(
                        409,
                        "More than 1000 upload units in this scope; "
                        "narrow the month before synchronizing",
                    )
                if i.plan_id:
                    _, all_items = await plan_uploads.plan_items(db, i.plan_id)
                else:
                    all_items = [i]
                units.append((i, all_items))
            batch = Batch(
                actor_id=actor.user_id,
                request_id=body.request_id,
                request_hash=request_hash,
                pool_id=pool_id,
                connection_id=connection.id,
                discipline=discipline,
                month=body.month,
                start_time=body.start_time,
                state="previewing",
            )
            db.add(batch)
            await db.flush()
            batch_id = batch.id
            for position, (i, all_items) in enumerate(units):
                public = proposal(i, all_items, connection, body.start_time)
                day = await db.get(PersonDayCapacity, (i.pool_id, i.person_id, i.date))
                public["person_name"] = day.name if day else None
                db.add(
                    BatchItem(
                        batch_id=batch.id,
                        allocation_id=i.id,
                        plan_id=i.plan_id,
                        position=position,
                        frozen={
                            "items": frozen(all_items),
                            "connection_revision": plan_uploads.connection_revision(connection),
                        },
                        proposal=public,
                        state="pending",
                    )
                )
            await db.flush()
            update_state(batch, await rows(db, batch.id))
    return await envelope(request, batch_id)


async def prepare(request, batch_id):
    from app.assignments.routes import existing, key, read_scope

    await sync_person_access(request, request.cookies.get(SESSION_COOKIE))
    async with request.app.state.sessions() as db, db.begin():
        batch, _, _ = await batch_scope(request, db, batch_id, write=True, lock=True)
        if batch.state != "previewing":
            return batch.id
        selected = next((i for i in await rows(db, batch.id) if i.state == "pending"), None)
        if selected is None:
            raise HTTPException(409, "Batch preview already prepared")
        selected_id = selected.id
        allocation_id = selected.allocation_id
    reason = None
    state = "ready"
    labels = None
    try:
        allocation = await existing(request, allocation_id)
        await read_scope(
            request, key(allocation), allocation.discipline, write=True, require_eligible=True
        )
        async with request.app.state.sessions() as db, db.begin():
            batch, _, connection = await batch_scope(request, db, batch_id, write=True, lock=True)
            item = await db.get(BatchItem, selected_id, populate_existing=True)
            await pool_lock(db, batch.pool_id, True)
            await load_lock(db, batch.connection_id)
            if item.plan_id:
                plan, all_items = await plan_uploads.plan_items(db, item.plan_id)
            else:
                all_items = [await db.get(Allocation, item.allocation_id, populate_existing=True)]
                plan = None
            if (
                frozen(all_items) != item.frozen["items"]
                or plan_uploads.connection_revision(connection)
                != item.frozen["connection_revision"]
            ):
                reason = "proposal_changed"
                state = "blocked"
            elif not item.plan_id:
                reason = "legacy_allocation_has_no_daily_plan"
                state = "blocked"
            elif plan.sync_state == "synced":
                reason = "already_synced"
                state = "skipped"
            elif plan.sync_state != "local":
                reason = "plan_outcome_unresolved"
                state = "blocked"
            elif not plan_uploads.enabled(
                request, configured_connection(request.app.state.settings, connection), connection
            ):
                reason = "daily_contract_not_enabled"
                state = "blocked"
            elif sum(i.minutes for i in all_items) != plan.demand_minutes:
                reason = "incomplete_source_demand"
                state = "blocked"
            else:
                for i, s in zip(all_items, item.proposal["segments"], strict=True):
                    day = await db.get(
                        PersonDayCapacity, (i.pool_id, i.person_id, i.date), populate_existing=True
                    )
                    validate_capacity(day, i.minutes, 0)
                    if (day.laborcode, day.craft, day.role) != (
                        i.laborcode,
                        i.craft,
                        i.role,
                    ) or datetime.fromisoformat(s["scheduled_finish"]).date() != i.date:
                        raise HTTPException(409, "Daily binding or business date changed")
            descriptors = getattr(request.state, "assignment_work_orders", {}).get(
                (
                    allocation.connection_id,
                    allocation.site_id,
                    allocation.workorder_id,
                    allocation.discipline,
                ),
                {},
            )
            labels = {
                "wonum": descriptors.get("wonum"),
                "workorder_description": descriptors.get("description"),
            }
            if item.state == "pending":
                item.state = state
                item.reason = reason
                item.labels = labels
            update_state(batch, await rows(db, batch.id))
    except (HTTPException, MaximoReadError):
        async with request.app.state.sessions() as db, db.begin():
            batch, _, _ = await batch_scope(request, db, batch_id, write=True, lock=True)
            item = await db.get(BatchItem, selected_id, populate_existing=True)
            if item.state == "pending":
                item.state = "blocked"
                item.reason = "scope_or_binding_unavailable"
            update_state(batch, await rows(db, batch.id))
    return await envelope(request, batch_id, changed_id=selected_id)


async def confirm(request, batch_id, body):
    await sync_person_access(request, request.cookies.get(SESSION_COOKIE))
    async with request.app.state.sessions() as db, db.begin():
        batch, _, _ = await batch_scope(request, db, batch_id, write=True, lock=True)
        await uuid_lock(db, body.request_id)
        previous = await request_owner(db, body.request_id)
        if previous:
            if previous.id != batch.id or batch.confirmation_request_id != body.request_id:
                raise HTTPException(409, "Request ID already used for different confirmation")
        elif batch.confirmation_request_id:
            raise HTTPException(409, "Batch already confirmed with another request ID")
        elif (
            batch.state != "ready"
            or batch.expires_at is None
            or batch.expires_at <= datetime.now(UTC)
        ):
            raise HTTPException(409, "Common preview expired or incomplete")
        else:
            batch.confirmation_request_id = body.request_id
            for item in await rows(db, batch.id):
                if item.state == "ready":
                    item.state = "queued"
            update_state(batch, await rows(db, batch.id))
    return await envelope(request, batch_id)


async def continue_one(request, batch_id, body):
    await sync_person_access(request, request.cookies.get(SESSION_COOKIE))
    async with request.app.state.sessions() as db, db.begin():
        batch, _, _ = await batch_scope(request, db, batch_id, write=True, lock=True)
        items = await rows(db, batch.id)
        await refresh_receipts(db, batch, items)
        if not batch.confirmation_request_id:
            raise HTTPException(409, "Confirm the common preview first")
        item = next((i for i in items if i.id == body.item_id), None)
        if item is None:
            raise HTTPException(404, "Upload batch item not found")
        if item.state in {
            "sending",
            "confirmed",
            "failed",
            "conflict",
            "unknown",
            "blocked",
            "skipped",
        }:
            selected_id = item.id
            should_send = False
        else:
            next_item = next((i for i in items if i.state == "queued"), None)
            if (
                any(i.state == "sending" for i in items)
                or next_item is None
                or item.id != next_item.id
            ):
                raise HTTPException(409, "Only the next queued item can be processed")
            selected_id = item.id
            should_send = True
            item = await db.get(BatchItem, item.id, populate_existing=True)
            item.state = "sending"
            item.claimed_until = datetime.now(UTC) + timedelta(
                seconds=request.app.state.settings.read_draft_request_timeout_seconds + 30
            )
            plan_id = item.plan_id
            request_id = item.request_id
            approved = item.proposal
            expected = item.frozen
            start_time = batch.start_time
    if not should_send:
        return await envelope(request, batch_id, changed_id=selected_id)
    state = "unknown"
    reason = "outcome_unresolved"
    attempt_id = None
    try:
        async with request.app.state.sessions() as db:
            _, current = await plan_uploads.plan_items(db, plan_id)
            if frozen(current) != expected["items"]:
                raise HTTPException(409, "Approved local plan changed")
        preview = await plan_uploads.preview(request, plan_id, start_time)
        compare = (
            "plan_id",
            "connection_id",
            "site_id",
            "workorder_id",
            "task_workorder_id",
            "task_id",
            "person_id",
            "laborcode",
            "source_assignment_id",
            "plan_version",
            "total_minutes",
        )
        actual_segments = [
            {
                k: s[k]
                for k in (
                    "allocation_id",
                    "version",
                    "date",
                    "minutes",
                    "scheduled_start",
                    "scheduled_finish",
                )
            }
            for s in preview["segments"]
        ]
        if (
            any(preview[k] != approved[k] for k in compare)
            or actual_segments != approved["segments"]
        ):
            raise HTTPException(409, "Fresh preview differs from approved business proposal")
        async with request.app.state.sessions() as db:
            _, _, connection = await batch_scope(request, db, batch_id)
            if plan_uploads.connection_revision(connection) != expected["connection_revision"]:
                raise HTTPException(409, "Approved connection registry changed")
        request.state.plan_upload_not_sent = True
        receipt = await plan_uploads.submit(
            request,
            plan_id,
            plan_uploads.PlanUploadRequest(
                request_id=request_id,
                plan_version=preview["plan_version"],
                preview_token=preview["preview_token"],
            ),
        )
        state = receipt["state"]
        attempt_id = UUID(receipt["attempt_id"])
        reason = None if state != "unknown" else "outcome_unresolved"
    except (HTTPException, MaximoReadError, SQLAlchemyError):
        try:
            async with request.app.state.sessions() as db:
                attempt = await db.scalar(
                    select(AssignmentPlanUpload).where(
                        AssignmentPlanUpload.actor_id == batch.actor_id,
                        AssignmentPlanUpload.request_id == request_id,
                        AssignmentPlanUpload.plan_id == plan_id,
                    )
                )
                if attempt:
                    state = attempt.state
                    attempt_id = attempt.id
                else:
                    state = "blocked"
                    reason = "final_preflight_unavailable_no_send"
        except SQLAlchemyError:
            state = "unknown"
            reason = "receipt_unavailable"
    async with request.app.state.sessions() as db, db.begin():
        batch, _, _ = await batch_scope(request, db, batch_id, write=True, lock=True)
        item = await db.get(BatchItem, selected_id, populate_existing=True)
        item.state = state
        item.reason = reason
        item.attempt_id = attempt_id
        update_state(batch, await rows(db, batch.id))
    return await envelope(request, batch_id, changed_id=selected_id)


def validate_query(request, allowed):
    if any(
        k not in allowed or len(request.query_params.getlist(k)) != 1 for k in request.query_params
    ):
        raise HTTPException(422, "Unsupported or duplicate query parameter")


def register(router):
    @router.post("/resource-pools/{pool_id}/plan-upload-batches")
    async def create_batch(request: Request, pool_id: UUID, body: CreateBatch):
        return await create(request, pool_id, body)

    @router.get("/resource-pools/{pool_id}/plan-upload-batches")
    async def latest(
        request: Request, pool_id: UUID, month: str = Query(pattern=r"^[0-9]{4}-(?:0[1-9]|1[0-2])$")
    ):
        validate_query(request, {"month"})
        await sync_person_access(request, request.cookies.get(SESSION_COOKIE))
        async with request.app.state.sessions() as db:
            actor, _, connection, discipline = await pool_scope(request, db, pool_id)
            batch = await db.scalar(
                select(Batch)
                .where(
                    Batch.actor_id == actor.user_id,
                    Batch.pool_id == pool_id,
                    Batch.connection_id == connection.id,
                    Batch.discipline == discipline,
                    Batch.month == month,
                )
                .order_by(Batch.created_at.desc(), Batch.id.desc())
                .limit(1)
            )
            if not batch:
                raise HTTPException(404, "Upload batch not found")
            batch_id = batch.id
        return await envelope(request, batch_id)

    @router.get("/plan-upload-batch-submissions/{request_id}")
    async def receipt(request: Request, request_id: UUID):
        async with request.app.state.sessions() as db:
            actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
            batch = await request_owner(db, request_id)
            if not batch or batch.actor_id != actor.user_id:
                raise HTTPException(404, "Upload batch not found")
            batch_id = batch.id
        return await envelope(request, batch_id)

    @router.get("/plan-upload-batches/{batch_id}")
    async def get_batch(
        request: Request, batch_id: UUID, cursor: str = Query(default="0", pattern=r"^[0-9]{1,9}$")
    ):
        validate_query(request, {"cursor"})
        return await envelope(request, batch_id, cursor=cursor)

    @router.post("/plan-upload-batches/{batch_id}/prepare-next")
    async def prepare_next(request: Request, batch_id: UUID):
        result = await prepare(request, batch_id)
        return await envelope(request, result) if isinstance(result, UUID) else result

    @router.post("/plan-upload-batches/{batch_id}/confirm")
    async def confirm_batch(request: Request, batch_id: UUID, body: Confirmation):
        return await confirm(request, batch_id, body)

    @router.post("/plan-upload-batches/{batch_id}/continue")
    async def step(request: Request, batch_id: UUID, body: ContinueBatch):
        return await continue_one(request, batch_id, body)
