"""Atomic local segments for one existing Maximo assignment, never a remote payload."""

from collections import defaultdict
from datetime import date, timedelta
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.assignments.capacity import validate_capacity
from app.assignments.incremental import metadata, receipt_metadata, revision
from app.assignments.load import load_lock, remote_load
from app.assignments.models import Allocation, AssignmentEvent, AssignmentPlan, AssignmentSubmission
from app.assignments.summary import remember_tasks
from app.assignments.tasks import TaskSelection, select_tasks
from app.maximo.detail import read_detail
from app.maximo.task_load import effective_load
from app.maximo.tasks import read_tasks
from app.rota.activation_routes import pool_lock
from app.rota.models import PersonDayCapacity
from app.rota.routes import authority
from app.scheduling.drafts import require_scope
from app.scheduling.routes import actor_after_io, checked_settings, digest


class PlanSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    minutes: int = Field(ge=1, le=630, strict=True)


class TaskPlanEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")
    task_id: int = Field(ge=0, strict=True)
    assignment_id: str = Field(pattern=r"^[0-9]{1,30}$")
    total_minutes: int = Field(ge=1, le=230580, strict=True)
    segments: list[PlanSegment] = Field(min_length=1, max_length=366)

    @model_validator(mode="after")
    def valid_segments(self):
        if len({s.date for s in self.segments}) != len(self.segments):
            raise ValueError("Plan dates must be unique")
        if sum(s.minutes for s in self.segments) != self.total_minutes:
            raise ValueError("Segment minutes must equal total minutes")
        if any(s.date == date.max for s in self.segments):
            raise ValueError("Plan date cannot be the final representable date")
        if (max(s.date for s in self.segments) - min(s.date for s in self.segments)).days >= 366:
            raise ValueError("Plan dates must span at most 366 calendar days")
        return self


class TaskPlanRequest(TaskPlanEntry):
    connection_id: UUID
    site_id: str = Field(min_length=1, max_length=50)
    workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")
    discipline: str = Field(min_length=1, max_length=50)
    person_id: UUID
    request_id: UUID


class TaskPlanBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: UUID
    site_id: str = Field(min_length=1, max_length=50)
    workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")
    discipline: str = Field(min_length=1, max_length=50)
    person_id: UUID
    request_id: UUID
    tasks: list[TaskPlanEntry] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def valid_batch(self):
        if len({task.assignment_id for task in self.tasks}) != len(self.tasks):
            raise ValueError("Choose each assignment once")
        dates = [segment.date for task in self.tasks for segment in task.segments]
        if (max(dates) - min(dates)).days >= 366:
            raise ValueError("Batch dates must span at most 366 calendar days")
        return self


async def source_available(db, connection_id, assignment_ids):
    reserved = await db.scalar(
        select(Allocation.id)
        .where(
            Allocation.connection_id == connection_id,
            Allocation.assignment_id.in_(assignment_ids),
            Allocation.state == "reserved",
        )
        .limit(1)
    )
    plan = await db.scalar(
        select(AssignmentPlan.id)
        .where(
            AssignmentPlan.connection_id == connection_id,
            AssignmentPlan.assignment_id.in_(assignment_ids),
            AssignmentPlan.state == "reserved",
        )
        .limit(1)
    )
    if reserved or plan:
        raise HTTPException(409, "Task assignment already reserved; reload timeline")


async def reserve_plan(request, pool_id, body):
    batch = isinstance(body, TaskPlanBatchRequest)
    entries = body.tasks if batch else [body]
    from app.assignments.routes import (
        key,
        read_scope,
        remember_work_order,
        require_resource_discipline,
        view,
    )

    require_resource_discipline(body.discipline, body.discipline)
    wo_key = key(body)
    identity = await read_scope(request, wo_key, body.discipline, write=True, require_eligible=True)
    _, settings = await checked_settings(request, wo_key, body.discipline, write=True, csrf=True)
    async with request.app.state.maximo_client_factory() as client:
        tasks = await read_tasks(client, settings, wo_key, body.discipline)
    async with request.app.state.sessions() as db, db.begin():
        actor = await actor_after_io(request, db, identity)
        await require_scope(db, actor.user_id, wo_key, body.discipline, write=True)
        _, pool, _, _ = await authority(db, request, pool_id, True)
        if pool.connection_id != body.connection_id:
            raise HTTPException(422, "Assignment must use the resource pool connection")
        await pool_lock(db, pool_id, True)
        await authority(db, request, pool_id, True)
        request_hash = digest(
            {
                "pool": str(pool_id),
                "task_plan_batch" if batch else "task_plan": body.model_dump(mode="json"),
            }
        )
        receipt = await db.get(AssignmentSubmission, (actor.user_id, body.request_id))
        if receipt:
            if receipt.request_hash != request_hash:
                raise HTTPException(409, "Request ID already used for different changes")
            return await receipt_metadata(
                request, db, settings, wo_key, body.discipline, pool_id, receipt.result, write=True
            )
        choices = [
            TaskSelection(
                task_workorder_id=entry.task_workorder_id,
                task_id=entry.task_id,
                assignment_id=entry.assignment_id,
                minutes=1,
            )
            for entry in entries
        ]
        selected = select_tasks(tasks, choices, body.discipline)
        await load_lock(db, body.connection_id)
        await source_available(db, body.connection_id, [c.assignment_id for c in choices])
        requested = defaultdict(int)
        for entry in entries:
            for segment in entry.segments:
                requested[segment.date] += segment.minutes
        days = {}
        for segment_date, minutes in sorted(requested.items()):
            day = await db.get(PersonDayCapacity, (pool_id, body.person_id, segment_date))
            if day:
                require_resource_discipline(day.craft, body.discipline)
            validate_capacity(day, minutes, 0)
            if days and day.laborcode != next(iter(days.values())).laborcode:
                raise HTTPException(409, "Plan labor binding changes between days")
            days[segment_date] = day
        laborcode = next(iter(days.values())).laborcode
        remote = {}
        start, before = (
            min(days),
            max(days) + timedelta(days=1),
        )
        while start < before:
            end = min(before, start + timedelta(days=31))
            remote.update(
                await remote_load(
                    request, db, settings, body.connection_id, {laborcode}, start, end
                )
            )
            start = end
        local = (
            await db.scalars(
                select(Allocation).where(
                    Allocation.connection_id == body.connection_id, Allocation.state == "reserved"
                )
            )
        ).all()
        for segment_date, day in days.items():
            total = effective_load(local, remote, day.laborcode, day.date)["allocated_minutes"]
            validate_capacity(day, requested[segment_date], total)
        async with request.app.state.maximo_client_factory() as client:
            fresh_tasks = await read_tasks(client, settings, wo_key, body.discipline)
            fresh_order = await read_detail(client, settings, wo_key, body.discipline)
        if (
            fresh_order is None
            or fresh_order.status not in settings.open_statuses
            or fresh_order.istask
            or fresh_order.parent not in (None, "")
        ):
            raise HTTPException(409, "Work order is no longer eligible for planning")
        fresh_selected = select_tasks(fresh_tasks, choices, body.discipline)
        for (_, _, assignment), (_, _, fresh_assignment) in zip(
            selected, fresh_selected, strict=True
        ):
            if fresh_assignment.model_dump(mode="json") != assignment.model_dump(mode="json"):
                raise HTTPException(409, "Source assignment changed; reload before planning")
        await actor_after_io(request, db, identity)
        await require_scope(db, actor.user_id, wo_key, body.discipline, write=True)
        await authority(db, request, pool_id, True)
        await remember_tasks(db, wo_key, body.discipline, fresh_tasks)
        remember_work_order(request, wo_key, body.discipline, fresh_order, settings)
        previous_revision = await revision(db, pool_id, body.connection_id, body.discipline)
        plans = []
        for entry, (_, task, assignment) in zip(entries, fresh_selected, strict=True):
            plan = AssignmentPlan(
                actor_id=actor.user_id,
                pool_id=pool_id,
                connection_id=body.connection_id,
                assignment_id=entry.assignment_id,
                person_id=body.person_id,
                laborcode=laborcode,
                demand_minutes=entry.total_minutes,
                state="reserved",
            )
            db.add(plan)
            await db.flush()
            items = []
            for segment in entry.segments:
                day = days[segment.date]
                item = Allocation(
                    pool_id=pool_id,
                    plan=plan,
                    connection_id=body.connection_id,
                    site_id=body.site_id,
                    workorder_id=body.workorder_id,
                    discipline=body.discipline,
                    person_id=body.person_id,
                    date=segment.date,
                    minutes=segment.minutes,
                    craft=day.craft,
                    role=day.role,
                    laborcode=day.laborcode,
                    task_workorder_id=task.task_workorder_id,
                    task_id=task.task_id,
                    task_description=task.description,
                    assignment_id=assignment.assignment_id,
                    upstream_baseline=assignment.model_dump(mode="json"),
                    sync_state="local",
                )
                db.add(item)
                await db.flush()
                result = view(item)
                items.append(result)
                db.add(
                    AssignmentEvent(
                        actor_id=actor.user_id,
                        allocation_id=item.id,
                        event="create",
                        details={
                            "before": None,
                            "after": result,
                            "plan_demand_minutes": plan.demand_minutes,
                        },
                    )
                )
            plans.append(
                {
                    "plan_id": str(plan.id),
                    "task_workorder_id": task.task_workorder_id,
                    "task_id": task.task_id,
                    "assignment_id": assignment.assignment_id,
                    "total_minutes": entry.total_minutes,
                    "items": items,
                }
            )
        result = (
            {"request_id": str(body.request_id), "plans": plans}
            if batch
            else {
                "request_id": str(body.request_id),
                "plan_id": plans[0]["plan_id"],
                "items": plans[0]["items"],
            }
        )
        result.update(
            await metadata(
                request,
                db,
                settings,
                wo_key,
                body.discipline,
                pool_id,
                [(body.person_id, d) for d in days],
                [UUID(i["id"]) for p in plans for i in p["items"]],
                previous_revision=previous_revision,
            )
        )
        db.add(
            AssignmentSubmission(
                actor_id=actor.user_id,
                request_id=body.request_id,
                allocation_id=UUID(plans[0]["items"][0]["id"]),
                request_hash=request_hash,
                result=result,
            )
        )
        return result


async def validate_plan_edit(db, item, body):
    plan = await db.get(AssignmentPlan, item.plan_id, populate_existing=True)
    if not plan or plan.state != "reserved":
        raise HTTPException(409, "Task plan changed; reload before editing")
    if body.person_id != plan.person_id:
        raise HTTPException(422, "All plan segments must use the same person")
    others = (
        await db.scalars(
            select(Allocation).where(
                Allocation.plan_id == plan.id,
                Allocation.state == "reserved",
                Allocation.id != item.id,
            )
        )
    ).all()
    if any(a.date == body.date for a in others):
        raise HTTPException(409, "Plan already has a segment on this date")
    if sum(a.minutes for a in others) + body.minutes > plan.demand_minutes:
        raise HTTPException(409, "Reserved plan minutes exceed its original demand")
    return plan


async def verify_plan_source(request, settings, item):
    from app.assignments.routes import key, remember_work_order

    async with request.app.state.maximo_client_factory() as client:
        tasks = await read_tasks(client, settings, key(item), item.discipline)
        order = await read_detail(client, settings, key(item), item.discipline)
    if (
        order is None
        or order.status not in settings.open_statuses
        or order.istask
        or order.parent not in (None, "")
    ):
        raise HTTPException(409, "Work order is no longer eligible for planning")
    choice = TaskSelection(
        task_workorder_id=item.task_workorder_id,
        task_id=item.task_id,
        assignment_id=item.assignment_id,
        minutes=1,
    )
    _, _, assignment = select_tasks(tasks, [choice], item.discipline)[0]
    if assignment.model_dump(mode="json") != item.upstream_baseline:
        raise HTTPException(409, "Source assignment changed; reload before editing")
    remember_work_order(request, key(item), item.discipline, order, settings)


async def release_empty_plan(db, item):
    await db.flush()
    remaining = await db.scalar(
        select(Allocation.id)
        .where(Allocation.plan_id == item.plan_id, Allocation.state == "reserved")
        .limit(1)
    )
    if not remaining:
        plan = await db.get(AssignmentPlan, item.plan_id, populate_existing=True)
        plan.state = "released"


def register(router):
    @router.post("/resource-pools/{pool_id}/task-plans")
    async def task_plan(request: Request, pool_id: UUID, body: TaskPlanRequest):
        return await reserve_plan(request, pool_id, body)

    @router.post("/resource-pools/{pool_id}/task-plan-batches")
    async def task_plan_batch(request: Request, pool_id: UUID, body: TaskPlanBatchRequest):
        return await reserve_plan(request, pool_id, body)
