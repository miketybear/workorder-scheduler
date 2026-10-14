"""Atomic local task reservations using server-verified assignment ownership."""

from datetime import date
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.assignments.capacity import validate_capacity
from app.assignments.incremental import metadata, receipt_metadata, revision
from app.assignments.load import load_lock, validate_remote_capacity
from app.assignments.models import Allocation, AssignmentEvent, AssignmentSubmission
from app.assignments.summary import planning_summary, remember_tasks
from app.db.models import MaximoConnection
from app.maximo.task_sender import write_enabled
from app.maximo.tasks import read_tasks
from app.rota.activation_routes import pool_lock
from app.rota.models import PersonDayCapacity
from app.rota.routes import authority
from app.scheduling.drafts import WorkOrderKey, require_scope
from app.scheduling.routes import actor_after_io, checked_settings, digest


class TaskSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")
    task_id: int = Field(ge=0, strict=True)
    assignment_id: str = Field(pattern=r"^[0-9]{1,30}$")
    minutes: int = Field(ge=1, le=630, strict=True)


class TaskBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: UUID
    site_id: str = Field(min_length=1, max_length=50)
    workorder_id: str = Field(pattern=r"^[0-9]{1,30}$")
    discipline: str = Field(min_length=1, max_length=50)
    person_id: UUID
    date: date
    request_id: UUID
    tasks: list[TaskSelection] = Field(min_length=1, max_length=50)


def select_tasks(tasks, selections, discipline):
    selected, seen = [], set()
    for choice in selections:
        if choice.assignment_id in seen:
            raise HTTPException(422, "Choose each assignment once")
        seen.add(choice.assignment_id)
        task = next(
            (
                t
                for t in tasks
                if t.task_workorder_id == choice.task_workorder_id and t.task_id == choice.task_id
            ),
            None,
        )
        assignment = (
            next((a for a in task.assignments if a.assignment_id == choice.assignment_id), None)
            if task
            else None
        )
        if assignment is None or assignment.craft != discipline:
            raise HTTPException(404, "Task assignment not found")
        if assignment.status != "WAITASGN" or assignment.laborcode or assignment.scheduledate:
            raise HTTPException(409, "Assignment already has labor or schedule; reload tasks")
        selected.append((choice, task, assignment))
    return selected


async def reserve_tasks(request, pool_id, body):
    from app.assignments.routes import key, read_scope, require_resource_discipline, view

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
        request_hash = digest({"pool": str(pool_id), "task_batch": body.model_dump(mode="json")})
        receipt = await db.get(AssignmentSubmission, (actor.user_id, body.request_id))
        if receipt:
            if receipt.request_hash != request_hash:
                raise HTTPException(409, "Request ID already used for different changes")
            return await receipt_metadata(
                request, db, settings, wo_key, body.discipline, pool_id, receipt.result, write=True
            )
        await remember_tasks(db, wo_key, body.discipline, tasks)
        selected = select_tasks(tasks, body.tasks, body.discipline)
        await load_lock(db, body.connection_id)
        from app.assignments.plans import source_available

        await source_available(db, body.connection_id, [c.assignment_id for c in body.tasks])
        day = await db.get(PersonDayCapacity, (pool_id, body.person_id, body.date))
        if day:
            require_resource_discipline(day.craft, body.discipline)
        existing = (
            await db.scalars(
                select(Allocation).where(
                    Allocation.connection_id == body.connection_id, Allocation.state == "reserved"
                )
            )
        ).all()
        if any(a.assignment_id in {c.assignment_id for c in body.tasks} for a in existing):
            raise HTTPException(409, "Task assignment already reserved; reload timeline")
        total = sum(
            a.minutes
            for a in existing
            if a.pool_id == pool_id and a.person_id == body.person_id and a.date == body.date
        )
        validate_capacity(day, sum(c.minutes for c in body.tasks), total)
        await validate_remote_capacity(
            request, db, settings, day, body.connection_id, sum(c.minutes for c in body.tasks)
        )
        await actor_after_io(request, db, identity)
        await require_scope(db, actor.user_id, wo_key, body.discipline, write=True)
        await authority(db, request, pool_id, True)
        previous_revision = await revision(db, pool_id, body.connection_id, body.discipline)
        items = []
        for choice, task, assignment in selected:
            item = Allocation(
                pool_id=pool_id,
                connection_id=body.connection_id,
                site_id=body.site_id,
                workorder_id=body.workorder_id,
                discipline=body.discipline,
                person_id=body.person_id,
                date=body.date,
                minutes=choice.minutes,
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
                    details={"before": None, "after": result},
                )
            )
        result = {"items": items, "request_id": str(body.request_id)}
        result.update(
            await metadata(
                request,
                db,
                settings,
                wo_key,
                body.discipline,
                pool_id,
                [(body.person_id, body.date)],
                [UUID(i["id"]) for i in items],
                previous_revision=previous_revision,
            )
        )
        db.add(
            AssignmentSubmission(
                actor_id=actor.user_id,
                request_id=body.request_id,
                allocation_id=UUID(items[0]["id"]),
                request_hash=request_hash,
                result=result,
            )
        )
        return result


def register(router):
    @router.get("/work-orders/{connection_id}/{site_id}/{workorder_id}/tasks")
    async def task_detail(
        request: Request, connection_id: UUID, site_id: str, workorder_id: str, discipline: str
    ):
        wo_key = WorkOrderKey(connection_id, site_id, workorder_id)
        identity, settings = await checked_settings(request, wo_key, discipline)
        async with request.app.state.maximo_client_factory() as client:
            tasks = await read_tasks(client, settings, wo_key, discipline)
        refreshed, _ = await checked_settings(request, wo_key, discipline)
        if refreshed.user_id != identity.user_id:
            raise HTTPException(401, "Sign-in required")
        async with request.app.state.sessions() as db, db.begin():
            await require_scope(db, identity.user_id, wo_key, discipline, write=False)
            await remember_tasks(db, wo_key, discipline, tasks)
            summary = await planning_summary(
                db, wo_key, discipline, request.app.state.settings.assignment_summary_ttl_seconds
            )
            connection = await db.get(MaximoConnection, connection_id)
            upload_enabled = write_enabled(
                settings, connection
            ) and request.app.state.settings.environment in {"test", "development"}
        return {
            "connection_id": str(connection_id),
            "site_id": site_id,
            "workorder_id": workorder_id,
            "tasks": [t.model_dump(mode="json") for t in tasks],
            "upload_enabled": upload_enabled,
            "planning_summary": summary,
        }

    @router.post("/resource-pools/{pool_id}/task-allocations")
    async def task_batch(request: Request, pool_id: UUID, body: TaskBatch):
        return await reserve_tasks(request, pool_id, body)
