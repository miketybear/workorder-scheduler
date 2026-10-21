"""Scoped, atomic release of every day of one local task plan."""

from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.assignments.incremental import metadata, receipt_metadata, revision
from app.assignments.models import AssignmentEvent, AssignmentSubmission
from app.assignments.plan_uploads import (
    current_remote_scope,
    plan_items,
    recheck,
    scoped_plan,
    serialized,
)
from app.scheduling.routes import digest


class PlanReleaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    expected_version: int = Field(ge=1, strict=True)


async def release_plan(request, pool_id, plan_id, body):
    from app.assignments.routes import key, view

    # Closed work orders keep local reservations that planners must still be able to release,
    # as with single-row release, so work-order eligibility is not required here.
    item, identity, settings, _ = await scoped_plan(
        request, plan_id, write=True, csrf=True, any_state=True
    )
    if item.pool_id != pool_id:
        raise HTTPException(404, "Assignment plan not found")
    async with serialized(request, item, identity, settings) as db:
        request_hash = digest(
            {
                "plan_release": str(plan_id),
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
        plan, rows = await plan_items(db, plan_id, any_state=True)
        items = [i for i in rows if i.state == "reserved"]
        if plan.version != body.expected_version:
            raise HTTPException(409, "Plan changed; reload before releasing")
        if (
            plan.state != "reserved"
            or not items
            or plan.sync_state != "local"
            or any(i.sync_state != "local" or i.remote_assignment_id for i in items)
        ):
            raise HTTPException(409, "Uploaded, released or unresolved plan cannot be released")
        await current_remote_scope(request, db, item, identity, settings)
        await recheck(request, db, item, identity, settings, write=True, csrf=True)
        previous_revision = await revision(db, pool_id, item.connection_id, item.discipline)
        before = {i.id: view(i) for i in items}
        for row in items:
            row.state = "released"
            row.version += 1
        plan.state = "released"
        plan.version += 1
        await db.flush()
        for row in items:
            db.add(
                AssignmentEvent(
                    actor_id=identity.user_id,
                    allocation_id=row.id,
                    event="plan_release",
                    details={
                        "plan_id": str(plan_id),
                        "before": before[row.id],
                        "after": view(row),
                        "plan_version": plan.version,
                        "request_id": str(body.request_id),
                    },
                )
            )
        anchor = items[0]
        result = {
            "request_id": str(body.request_id),
            "plan_id": str(plan_id),
            "plan_version": plan.version,
            "plan_total_minutes": plan.demand_minutes,
            "task_workorder_id": anchor.task_workorder_id,
            "task_id": anchor.task_id,
            "assignment_id": plan.assignment_id,
            "items": [view(i) for i in items],
        }
        result.update(
            await metadata(
                request,
                db,
                settings,
                key(item),
                item.discipline,
                pool_id,
                {(i.person_id, i.date) for i in items},
                [i.id for i in items],
                previous_revision=previous_revision,
            )
        )
        db.add(
            AssignmentSubmission(
                actor_id=identity.user_id,
                request_id=body.request_id,
                allocation_id=anchor.id,
                request_hash=request_hash,
                result=result,
            )
        )
        return result


def register(router):
    @router.post("/resource-pools/{pool_id}/assignment-plans/{plan_id}/release")
    async def plan_release(
        request: Request, pool_id: UUID, plan_id: UUID, body: PlanReleaseRequest
    ):
        return await release_plan(request, pool_id, plan_id, body)
