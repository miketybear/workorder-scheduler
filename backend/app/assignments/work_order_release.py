"""Scoped, atomic release of every still-local assignment of one work order."""

from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.assignments.incremental import metadata, receipt_metadata, revision
from app.assignments.models import (
    Allocation,
    AssignmentEvent,
    AssignmentPlan,
    AssignmentSubmission,
)
from app.assignments.plan_uploads import current_remote_scope, scoped_item, serialized
from app.scheduling.routes import digest


class WorkOrderReleaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    expected_allocation_ids: list[UUID] = Field(min_length=1, max_length=2000)


async def split_rows(db, item):
    """A plan is released whole or not at all, so one sent day keeps all of its days."""
    rows = list(
        (
            await db.scalars(
                select(Allocation)
                .where(
                    Allocation.pool_id == item.pool_id,
                    Allocation.connection_id == item.connection_id,
                    Allocation.site_id == item.site_id,
                    Allocation.workorder_id == item.workorder_id,
                    Allocation.discipline == item.discipline,
                    Allocation.state == "reserved",
                )
                .order_by(Allocation.date, Allocation.id)
                .execution_options(populate_existing=True)
            )
        ).unique()
    )
    plans = {}
    for plan_id in {row.plan_id for row in rows if row.plan_id}:
        plans[plan_id] = await db.get(AssignmentPlan, plan_id, populate_existing=True)

    def sent(row):
        return row.sync_state != "local" or bool(row.remote_assignment_id)

    blocked = {
        row.plan_id
        for row in rows
        if row.plan_id and (sent(row) or plans[row.plan_id].sync_state != "local")
    }
    kept = [row for row in rows if sent(row) or row.plan_id in blocked]
    kept_ids = {row.id for row in kept}
    return [row for row in rows if row.id not in kept_ids], kept, plans


def task_count(rows):
    return len({row.plan_id or row.assignment_id or row.id for row in rows})


async def anchored(request, pool_id, allocation_id, *, csrf):
    from app.assignments.routes import existing

    item = await existing(request, allocation_id)
    if item.pool_id != pool_id:
        raise HTTPException(404, "Assignment not found")
    # Closed work orders keep local reservations that planners must still be able to release.
    item, identity, settings, _ = await scoped_item(request, item, write=True, csrf=csrf)
    return item, identity, settings


async def preview(request, pool_id, allocation_id):
    item, identity, settings = await anchored(request, pool_id, allocation_id, csrf=False)
    async with request.app.state.sessions() as db:
        rows, kept, _ = await split_rows(db, item)
    return {
        "allocation_ids": [str(row.id) for row in rows],
        "task_count": task_count(rows),
        "total_minutes": sum(row.minutes for row in rows),
        "person_ids": sorted({str(row.person_id) for row in rows}),
        "kept_task_count": task_count(kept),
    }


async def release(request, pool_id, allocation_id, body):
    from app.assignments.routes import key, view

    item, identity, settings = await anchored(request, pool_id, allocation_id, csrf=True)
    async with serialized(request, item, identity, settings) as db:
        request_hash = digest(
            {
                "work_order_release": str(allocation_id),
                "pool_id": str(pool_id),
                "body": body.model_dump(mode="json"),
            }
        )
        receipt = await db.get(AssignmentSubmission, (identity.user_id, body.request_id))
        if receipt:
            if receipt.request_hash != request_hash:
                raise HTTPException(409, "Request ID already used for different changes")
            return await receipt_metadata(
                request,
                db,
                settings,
                key(item),
                item.discipline,
                pool_id,
                receipt.result,
                write=True,
            )
        rows, kept, plans = await split_rows(db, item)
        if not rows or {row.id for row in rows} != set(body.expected_allocation_ids):
            raise HTTPException(409, "Assignments changed; reload before releasing")
        await current_remote_scope(request, db, item, identity, settings)
        previous_revision = await revision(db, pool_id, item.connection_id, item.discipline)
        before = {row.id: view(row) for row in rows}
        released_tasks = task_count(rows)
        kept_tasks = task_count(kept)
        for row in rows:
            row.state = "released"
            row.version += 1
        for plan_id in {row.plan_id for row in rows if row.plan_id}:
            plans[plan_id].state = "released"
            plans[plan_id].version += 1
        await db.flush()
        for row in rows:
            db.add(
                AssignmentEvent(
                    actor_id=identity.user_id,
                    allocation_id=row.id,
                    event="work_order_release",
                    details={
                        "before": before[row.id],
                        "after": view(row),
                        "request_id": str(body.request_id),
                    },
                )
            )
        result = {
            "request_id": str(body.request_id),
            "released_task_count": released_tasks,
            "kept_task_count": kept_tasks,
            "items": [view(row) for row in rows],
        }
        result.update(
            await metadata(
                request,
                db,
                settings,
                key(item),
                item.discipline,
                pool_id,
                {(row.person_id, row.date) for row in rows},
                [row.id for row in rows],
                previous_revision=previous_revision,
            )
        )
        db.add(
            AssignmentSubmission(
                actor_id=identity.user_id,
                request_id=body.request_id,
                allocation_id=rows[0].id,
                request_hash=request_hash,
                result=result,
            )
        )
        return result


def register(router):
    @router.get("/resource-pools/{pool_id}/assignments/{allocation_id}/work-order-release")
    async def work_order_release_preview(request: Request, pool_id: UUID, allocation_id: UUID):
        return await preview(request, pool_id, allocation_id)

    @router.post("/resource-pools/{pool_id}/assignments/{allocation_id}/work-order-release")
    async def work_order_release(
        request: Request, pool_id: UUID, allocation_id: UUID, body: WorkOrderReleaseRequest
    ):
        return await release(request, pool_id, allocation_id, body)
