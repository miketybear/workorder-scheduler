from collections import defaultdict
from datetime import date
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.assignments.bulk_uploads import register as register_bulk_uploads
from app.assignments.capacity import validate_capacity
from app.assignments.incremental import metadata, receipt_metadata, revision
from app.assignments.load import enrich_rows, load_lock, validate_remote_capacity
from app.assignments.models import Allocation, AssignmentEvent, AssignmentSubmission
from app.assignments.plan_moves import register as register_plan_moves
from app.assignments.plan_uploads import register as register_plan_uploads
from app.assignments.plans import register as register_plans
from app.assignments.plans import release_empty_plan, validate_plan_edit
from app.assignments.summary import remember_tasks
from app.assignments.tasks import register
from app.assignments.uploads import register as register_uploads
from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.maximo.detail import read_detail
from app.maximo.tasks import read_tasks
from app.request_deadline import ReadDraftDeadlineRoute
from app.rota.activation import capacity
from app.rota.activation_routes import pool_lock
from app.rota.models import PersonDayCapacity, ResourcePoolState
from app.rota.parser import CRAFT
from app.rota.routes import authority
from app.scheduling.drafts import WorkOrderKey, require_scope
from app.scheduling.routes import actor_after_io, checked_settings, digest

router = APIRouter(prefix="/api", route_class=ReadDraftDeadlineRoute)


class AllocationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: UUID
    site_id: str = Field(min_length=1, max_length=50)
    workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")
    discipline: str = Field(min_length=1, max_length=50)
    person_id: UUID
    date: date
    minutes: int = Field(ge=1, le=630, strict=True)
    request_id: UUID


class AllocationUpdate(AllocationRequest):
    version: int = Field(ge=1, strict=True)


class Release(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1, strict=True)
    request_id: UUID


def require_resource_discipline(craft, discipline):
    if discipline not in set(CRAFT.values()) or craft != discipline:
        raise HTTPException(404, "Assignment resource not found")


def key(item):
    return WorkOrderKey(item.connection_id, item.site_id, item.workorder_id)


def view(item):
    return {
        k: str(getattr(item, k))
        for k in (
            "id",
            "pool_id",
            "person_id",
            "connection_id",
            "site_id",
            "workorder_id",
            "discipline",
            "craft",
            "role",
            "laborcode",
        )
    } | {
        "date": item.date.isoformat(),
        "minutes": item.minutes,
        "version": item.version,
        "state": item.state,
        "task_workorder_id": item.task_workorder_id,
        "task_id": item.task_id,
        "assignment_id": item.assignment_id,
        "remote_assignment_id": item.remote_assignment_id,
        "task_description": item.task_description,
        "sync_state": item.sync_state,
        "plan_id": str(item.plan_id) if item.plan_id is not None else None,
        "plan_total_minutes": item.plan.demand_minutes if item.plan_id is not None else None,
        "plan_version": item.plan.version if item.plan_id is not None else None,
        "plan_sync_state": item.plan.sync_state if item.plan_id is not None else None,
    }


async def read_scope(request, wo_key, discipline, *, write=False, require_eligible=False):
    """Closed WOs retain scoped local reservations that planners must be able to release."""
    identity, settings = await checked_settings(
        request, wo_key, discipline, write=write, csrf=write
    )
    async with request.app.state.maximo_client_factory() as client:
        order = await read_detail(client, settings, wo_key, discipline)
        if order is None:
            raise HTTPException(404, "Work order not found")
        if require_eligible and (
            order.status not in settings.open_statuses
            or order.istask
            or order.parent not in (None, "")
        ):
            raise HTTPException(409, "Work order is no longer eligible for scheduling")
    refreshed, _ = await checked_settings(request, wo_key, discipline, write=write, csrf=write)
    if refreshed.user_id != identity.user_id:
        raise HTTPException(401, "Sign-in required")
    remember_work_order(request, wo_key, discipline, order, settings)
    return refreshed


def remember_work_order(request, wo_key, discipline, order, settings):
    descriptors = getattr(request.state, "assignment_work_orders", {})
    descriptors[(wo_key.connection_id, wo_key.site_id, wo_key.workorder_id, discipline)] = {
        "connection_id": str(wo_key.connection_id),
        "site_id": wo_key.site_id,
        "workorder_id": wo_key.workorder_id,
        "wonum": order.wonum,
        "description": order.description,
        "status": order.status,
        "eligible": order.status in settings.open_statuses
        and not order.istask
        and order.parent in (None, ""),
    }
    request.state.assignment_work_orders = descriptors


async def existing(request, allocation_id):
    await sync_person_access(request, request.cookies.get(SESSION_COOKIE))
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        item = await db.get(Allocation, allocation_id)
        if not item:
            raise HTTPException(404, "Assignment not found")
        require_resource_discipline(item.craft, item.discipline)
        await require_scope(db, identity.user_id, key(item), item.discipline, write=False)
        await authority(db, request, item.pool_id)
        return item


async def persist(request, pool_id, body, allocation_id=None, release=False):
    original = await existing(request, allocation_id) if allocation_id else None
    target = original or body
    require_resource_discipline(target.discipline, target.discipline)
    pool_id = original.pool_id if original else pool_id
    identity = await read_scope(
        request, key(target), target.discipline, write=True, require_eligible=not release
    )
    _, capacity_settings = await checked_settings(
        request, key(target), target.discipline, write=True, csrf=True
    )
    if original and original.task_workorder_id:
        if original.sync_state != "local":
            raise HTTPException(
                409, "Uploaded assignment requires remote reconciliation before editing"
            )
    task_rows = None
    if original and original.task_workorder_id and not (original.plan_id and release):
        _, task_settings = await checked_settings(
            request, key(original), original.discipline, write=True, csrf=True
        )
        async with request.app.state.maximo_client_factory() as client:
            task_rows = await read_tasks(client, task_settings, key(original), original.discipline)
        if not any(
            t.task_workorder_id == original.task_workorder_id
            and t.task_id == original.task_id
            and any(a.assignment_id == original.assignment_id for a in t.assignments)
            for t in task_rows
        ):
            raise HTTPException(404, "Task assignment not found")
        if original.plan_id:
            from app.assignments.tasks import TaskSelection, select_tasks

            selection = TaskSelection(
                task_workorder_id=original.task_workorder_id,
                task_id=original.task_id,
                assignment_id=original.assignment_id,
                minutes=1,
            )
            _, _, current_source = select_tasks(task_rows, [selection], original.discipline)[0]
            if current_source.model_dump(mode="json") != original.upstream_baseline:
                raise HTTPException(409, "Task source changed; reload before editing the plan")
    if (
        original
        and not release
        and (key(original) != key(body) or original.discipline != body.discipline)
    ):
        raise HTTPException(422, "Assignment work order identity cannot be changed")
    async with request.app.state.sessions() as db, db.begin():
        actor = await actor_after_io(request, db, identity)
        await require_scope(db, actor.user_id, key(target), target.discipline, write=True)
        _, pool, _, _ = await authority(db, request, pool_id, True)
        if pool.connection_id != target.connection_id:
            raise HTTPException(422, "Assignment must use the resource pool connection")
        # A single exclusive pool lock also serializes missing day rows and activation.
        await pool_lock(db, pool_id, True)
        await authority(db, request, pool_id, True)
        request_hash = digest(
            {
                "id": str(allocation_id),
                "pool": str(pool_id),
                "release": release,
                "body": body.model_dump(mode="json"),
            }
        )
        receipt = await db.get(AssignmentSubmission, (actor.user_id, body.request_id))
        if receipt:
            if receipt.request_hash != request_hash:
                raise HTTPException(409, "Request ID already used for different changes")
            require_resource_discipline(receipt.result.get("craft"), target.discipline)
            return await receipt_metadata(
                request,
                db,
                capacity_settings,
                key(target),
                target.discipline,
                pool_id,
                receipt.result,
                write=True,
            )
        if task_rows is not None:
            await remember_tasks(db, key(target), target.discipline, task_rows)
        item = await db.get(Allocation, allocation_id, populate_existing=True) if original else None
        if original and (not item or item.pool_id != pool_id):
            raise HTTPException(404, "Assignment not found")
        if item:
            require_resource_discipline(item.craft, target.discipline)
        if item and (item.version != body.version or item.state != "reserved"):
            raise HTTPException(409, "Assignment changed; reload before saving")
        if item and item.task_workorder_id and item.sync_state != "local":
            raise HTTPException(409, "Assignment upload is unresolved; reload before editing")
        if item and item.plan_id:
            await load_lock(db, item.connection_id)
            if item.plan.sync_state != "local":
                raise HTTPException(409, "Plan upload is unresolved or already synced")
            item.plan.version += 1
            if not release:
                await validate_plan_edit(db, item, body)
        await load_lock(db, target.connection_id)
        previous_revision = await revision(db, pool_id, target.connection_id, target.discipline)
        before = view(item) if item else None
        cells = [(item.person_id, item.date)] if item else []
        if release:
            item.state = "released"
            item.version += 1
            if item.plan_id:
                await release_empty_plan(db, item)
        else:
            day = await db.get(PersonDayCapacity, (pool_id, body.person_id, body.date))
            total = await db.scalar(
                select(func.coalesce(func.sum(Allocation.minutes), 0)).where(
                    Allocation.pool_id == pool_id,
                    Allocation.person_id == body.person_id,
                    Allocation.date == body.date,
                    Allocation.state == "reserved",
                    Allocation.id != allocation_id if allocation_id else True,
                )
            )
            if day is not None:
                require_resource_discipline(day.craft, body.discipline)
                if item and item.plan_id and day.laborcode != item.laborcode:
                    raise HTTPException(409, "Plan labor binding changes between days")
            validate_capacity(day, body.minutes, total)
            if capacity_settings.task_load_contract is not None or (
                original and original.task_workorder_id
            ):
                await validate_remote_capacity(
                    request,
                    db,
                    capacity_settings,
                    day,
                    body.connection_id,
                    body.minutes,
                    allocation_id,
                )
                if item and item.plan_id:
                    from app.assignments.plans import verify_plan_source

                    await verify_plan_source(request, capacity_settings, item)
                await actor_after_io(request, db, identity)
                await require_scope(db, actor.user_id, key(target), target.discipline, write=True)
                await authority(db, request, pool_id, True)
            if item:
                item.person_id, item.date, item.minutes = body.person_id, body.date, body.minutes
                item.version += 1
            else:
                item = Allocation(pool_id=pool_id, **body.model_dump(exclude={"request_id"}))
                db.add(item)
            item.craft, item.role, item.laborcode = day.craft, day.role, day.laborcode
        await db.flush()
        result = view(item)
        cells.append((item.person_id, item.date))
        result.update(
            await metadata(
                request,
                db,
                capacity_settings,
                key(target),
                target.discipline,
                pool_id,
                cells,
                [item.id],
                previous_revision=previous_revision,
            )
        )
        await actor_after_io(request, db, identity)
        await require_scope(db, actor.user_id, key(target), target.discipline, write=True)
        await authority(db, request, pool_id, True)
        db.add(
            AssignmentEvent(
                actor_id=actor.user_id,
                allocation_id=item.id,
                event="release" if release else "update" if original else "create",
                details={"before": before, "after": result},
            )
        )
        db.add(
            AssignmentSubmission(
                actor_id=actor.user_id,
                request_id=body.request_id,
                allocation_id=item.id,
                request_hash=request_hash,
                result=result,
            )
        )
        return result


@router.post("/resource-pools/{pool_id}/assignments")
async def create(request: Request, pool_id: UUID, body: AllocationRequest):
    return await persist(request, pool_id, body)


@router.patch("/assignments/{allocation_id}")
async def update(request: Request, allocation_id: UUID, body: AllocationUpdate):
    return await persist(request, None, body, allocation_id)


@router.delete("/assignments/{allocation_id}")
async def delete(request: Request, allocation_id: UUID, body: Release):
    return await persist(request, None, body, allocation_id, release=True)


@router.get("/assignment-submissions/{request_id}")
async def submission_receipt(request: Request, request_id: UUID):
    async with request.app.state.sessions() as db:
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        receipt = await db.get(AssignmentSubmission, (actor.user_id, request_id))
        if not receipt:
            raise HTTPException(404, "Assignment submission not found")
        item = await existing(request, receipt.allocation_id)
        refreshed = await read_scope(request, key(item), item.discipline)
        if refreshed.user_id != actor.user_id:
            raise HTTPException(401, "Sign-in required")
        async with request.app.state.sessions() as check:
            current, _, _, _ = await authority(check, request, item.pool_id)
            if current.user_id != actor.user_id:
                raise HTTPException(401, "Sign-in required")
            await require_scope(check, current.user_id, key(item), item.discipline, write=False)
        results = (
            [result for plan in receipt.result["plans"] for result in plan["items"]]
            if "plans" in receipt.result
            else receipt.result.get("items", [receipt.result])
        )
        for result in results:
            require_resource_discipline(result.get("craft"), item.discipline)
        _, settings = await checked_settings(request, key(item), item.discipline)
        async with request.app.state.sessions() as check:
            await pool_lock(check, item.pool_id, False)
            await load_lock(check, item.connection_id)
            result = await receipt_metadata(
                request, check, settings, key(item), item.discipline, item.pool_id, receipt.result
            )
            await authority(check, request, item.pool_id)
        return {"result": result}


@router.get("/resource-pools/{pool_id}/assignments")
async def list_assignments(
    request: Request,
    pool_id: UUID,
    date_from: date,
    date_before: date,
    connection_id: UUID,
    discipline: str,
    site_id: str,
    workorder_id: str,
):
    if not 1 <= (date_before - date_from).days <= 31:
        raise HTTPException(422, "Choose a range of 1 to 31 calendar days")
    # Apply the same identifier bounds as mutations, without creating an allocation.
    if (
        not site_id
        or len(site_id) > 50
        or not discipline
        or len(discipline) > 50
        or (not workorder_id.isascii() or not workorder_id.isdigit() or len(workorder_id) > 30)
    ):
        raise HTTPException(422, "Invalid work order identity")
    require_resource_discipline(discipline, discipline)
    wo_key = WorkOrderKey(connection_id, site_id, workorder_id)
    identity = await read_scope(request, wo_key, discipline)
    _, settings = await checked_settings(request, wo_key, discipline)
    async with request.app.state.sessions() as db:
        _, pool, _, _ = await authority(db, request, pool_id)
        if pool.connection_id != connection_id:
            raise HTTPException(422, "Assignment must use the resource pool connection")
        await pool_lock(db, pool_id, False)
        actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        if actor.user_id != identity.user_id:
            raise HTTPException(401, "Sign-in required")
        await require_scope(db, actor.user_id, wo_key, discipline, write=False)
        await authority(db, request, pool_id)
        rows = await resource_rows(db, pool_id, date_from, date_before, discipline)
        items = (
            await db.scalars(
                select(Allocation)
                .where(
                    Allocation.pool_id == pool_id,
                    Allocation.connection_id == connection_id,
                    Allocation.discipline == discipline,
                    Allocation.craft == discipline,
                    Allocation.site_id == site_id,
                    Allocation.workorder_id == workorder_id,
                    Allocation.state == "reserved",
                    Allocation.date >= date_from,
                    Allocation.date < date_before,
                )
                .order_by(Allocation.date, Allocation.id)
            )
        ).all()
        state = await db.get(ResourcePoolState, pool_id)
        rows = await enrich_rows(
            request,
            db,
            settings,
            connection_id,
            await resource_rows(db, pool_id, date_from, date_before, discipline),
            date_from,
            date_before,
        )
        current_identity, current_settings = await checked_settings(request, wo_key, discipline)
        if current_identity.user_id != identity.user_id or current_settings != settings:
            raise HTTPException(409, "Timeline scope changed; reload")
        await authority(db, request, pool_id)
        return {
            "pool_id": str(pool_id),
            "pool_version": state.version if state else 0,
            "rows": rows,
            "items": [view(item) for item in items],
        }


async def resource_rows(db, pool_id, date_from, date_before, discipline):
    days = [
        day
        for day in await capacity(db, pool_id, date_from, date_before)
        if day.role != "MATERIAL_CONTROLLER" and day.craft == discipline
    ]
    loads = (
        await db.execute(
            select(Allocation.person_id, Allocation.date, func.sum(Allocation.minutes))
            .where(
                Allocation.pool_id == pool_id,
                Allocation.state == "reserved",
                Allocation.date >= date_from,
                Allocation.date < date_before,
            )
            .group_by(Allocation.person_id, Allocation.date)
        )
    ).all()
    totals = {(p, d): m for p, d, m in loads}
    groups = defaultdict(list)
    for day in days:
        groups[(day.person_id, day.name, day.craft, day.role, day.laborcode)].append(day)
    rows = [
        {
            "person_id": str(k[0]),
            "name": k[1],
            "craft": k[2],
            "role": k[3],
            "laborcode": k[4],
            "days": [
                {
                    "date": d.date.isoformat(),
                    "code": d.code,
                    "capacity_minutes": int(d.capacity_hours * 60),
                    "allocated_minutes": totals.get((d.person_id, d.date), 0),
                    "remaining_minutes": int(d.capacity_hours * 60)
                    - totals.get((d.person_id, d.date), 0),
                }
                for d in sorted(values, key=lambda d: d.date)
            ],
        }
        for k, values in sorted(groups.items(), key=lambda x: (x[0][2], x[0][1]))
    ]
    return rows


@router.get("/resource-pools/{pool_id}/assignment-timeline")
async def assignment_timeline(
    request: Request,
    pool_id: UUID,
    connection_id: UUID,
    discipline: str,
    date_from: date,
    date_before: date,
):
    if not 1 <= (date_before - date_from).days <= 31:
        raise HTTPException(422, "Choose a range of 1 to 31 calendar days")
    require_resource_discipline(discipline, discipline)
    # A synthetic key is used only to check grants, never to retrieve a WO.
    scope_key = WorkOrderKey(connection_id, "_", "0")
    identity, settings = await checked_settings(request, scope_key, discipline)
    async with request.app.state.sessions() as db:
        _, pool, _, _ = await authority(db, request, pool_id)
        if pool.connection_id != connection_id:
            raise HTTPException(422, "Assignment must use the resource pool connection")
        await require_scope(db, identity.user_id, scope_key, discipline, write=False)
        initial = await timeline_items(
            db, pool_id, connection_id, discipline, date_from, date_before
        )
        revisions = {item.id: item.version for item in initial}
        keys = sorted({key(item) for item in initial}, key=lambda k: (k.site_id, k.workorder_id))
    if len(keys) > 200:
        raise HTTPException(422, "Timeline exceeds 200 work orders; choose a shorter date range")
    work_orders = []
    async with request.app.state.maximo_client_factory() as client:
        for wo_key in keys:
            order = await read_detail(client, settings, wo_key, discipline)
            if order is None:
                raise HTTPException(404, "Work order not found")
            work_orders.append(
                {
                    "connection_id": str(connection_id),
                    "site_id": wo_key.site_id,
                    "workorder_id": wo_key.workorder_id,
                    "wonum": order.wonum,
                    "description": order.description,
                    "status": order.status,
                    "eligible": order.status in settings.open_statuses
                    and not order.istask
                    and order.parent in (None, ""),
                }
            )
    refreshed, _ = await checked_settings(request, scope_key, discipline)
    if refreshed.user_id != identity.user_id:
        raise HTTPException(401, "Sign-in required")
    async with request.app.state.sessions() as db:
        await pool_lock(db, pool_id, False)
        actor, _, _, _ = await authority(db, request, pool_id)
        if actor.user_id != identity.user_id:
            raise HTTPException(401, "Sign-in required")
        await require_scope(db, actor.user_id, scope_key, discipline, write=False)
        items = await timeline_items(db, pool_id, connection_id, discipline, date_from, date_before)
        if {item.id: item.version for item in items} != revisions:
            raise HTTPException(409, "Assignments changed; reload timeline")
        state = await db.get(ResourcePoolState, pool_id)
        ledger_revision = await revision(db, pool_id, connection_id, discipline)
        rows = await enrich_rows(
            request,
            db,
            settings,
            connection_id,
            await resource_rows(db, pool_id, date_from, date_before, discipline),
            date_from,
            date_before,
        )
        current_identity, current_settings = await checked_settings(request, scope_key, discipline)
        if current_identity.user_id != identity.user_id or current_settings != settings:
            raise HTTPException(409, "Timeline scope changed; reload")
        await authority(db, request, pool_id)
        if await revision(db, pool_id, connection_id, discipline) != ledger_revision:
            raise HTTPException(409, "Assignment capacity changed; reload timeline")
        return {
            "pool_id": str(pool_id),
            "pool_version": state.version if state else 0,
            "rows": rows,
            "items": [view(item) for item in items],
            "work_orders": work_orders,
            "assignment_revision": ledger_revision,
        }


async def timeline_items(db, pool_id, connection_id, discipline, date_from, date_before):
    return (
        await db.scalars(
            select(Allocation)
            .where(
                Allocation.pool_id == pool_id,
                Allocation.connection_id == connection_id,
                Allocation.discipline == discipline,
                Allocation.craft == discipline,
                Allocation.state == "reserved",
                Allocation.date >= date_from,
                Allocation.date < date_before,
            )
            .order_by(Allocation.date, Allocation.id)
        )
    ).all()


@router.get("/resource-pools/{pool_id}/assignment-revision")
async def assignment_revision(
    request: Request, pool_id: UUID, connection_id: UUID, discipline: str
):
    require_resource_discipline(discipline, discipline)
    scope_key = WorkOrderKey(connection_id, "_", "0")
    identity, _ = await checked_settings(request, scope_key, discipline)
    async with request.app.state.sessions() as db:
        actor, pool, _, _ = await authority(db, request, pool_id)
        if actor.user_id != identity.user_id:
            raise HTTPException(401, "Sign-in required")
        if pool.connection_id != connection_id:
            raise HTTPException(404, "Resource pool not found")
        await require_scope(db, actor.user_id, scope_key, discipline, write=False)
        return dict(
            pool_id=str(pool_id),
            connection_id=str(connection_id),
            discipline=discipline,
            revision=await revision(db, pool_id, connection_id, discipline),
        )


register(router)
register_uploads(router)
register_plans(router)
register_plan_uploads(router)
register_bulk_uploads(router)
register_plan_moves(router)
