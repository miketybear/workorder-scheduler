"""Scoped, atomic replacement of the day segments of one local task plan."""

from datetime import date, timedelta
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.assignments.capacity import validate_capacity
from app.assignments.incremental import metadata, receipt_metadata, revision
from app.assignments.load import remote_load
from app.assignments.models import Allocation, AssignmentEvent, AssignmentSubmission
from app.assignments.plan_uploads import (
    current_remote_scope,
    plan_items,
    recheck,
    scoped_plan,
    serialized,
)
from app.assignments.plans import PlanSegment, verify_plan_source
from app.maximo.task_load import effective_load
from app.rota.models import PersonDayCapacity
from app.scheduling.routes import digest


class PlanSegmentsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    expected_version: int = Field(ge=1, strict=True)
    segments: list[PlanSegment] = Field(min_length=1, max_length=366)

    @model_validator(mode="after")
    def valid_segments(self):
        dates = [s.date for s in self.segments]
        if len(set(dates)) != len(dates):
            raise ValueError("Plan dates must be unique")
        if date.max in dates:
            raise ValueError("Plan date cannot be the final representable date")
        if (max(dates) - min(dates)).days >= 366:
            raise ValueError("Plan dates must span at most 366 calendar days")
        return self


async def validated_targets(request, db, plan, items, settings, body):
    """Return the rota day per requested date after the same checks plan moves apply."""
    from app.assignments.routes import key, require_resource_discipline

    if plan.version != body.expected_version:
        raise HTTPException(409, "Plan changed; reload before editing")
    if (
        plan.state != "reserved"
        or plan.sync_state != "local"
        or any(i.sync_state != "local" or i.remote_assignment_id for i in items)
    ):
        raise HTTPException(409, "Uploaded or unresolved plan cannot be edited")
    anchor = items[0]
    if any(
        i.person_id != plan.person_id
        or i.laborcode != plan.laborcode
        or i.pool_id != plan.pool_id
        or i.assignment_id != plan.assignment_id
        or key(i) != key(anchor)
        or i.task_workorder_id != anchor.task_workorder_id
        or i.task_id != anchor.task_id
        or i.discipline != anchor.discipline
        or i.upstream_baseline != anchor.upstream_baseline
        for i in items
    ):
        raise HTTPException(409, "Plan identity changed; reload before editing")
    if sum(s.minutes for s in body.segments) != plan.demand_minutes:
        raise HTTPException(422, "Segment minutes must equal the plan's total minutes")
    if {(i.date, i.minutes) for i in items} == {(s.date, s.minutes) for s in body.segments}:
        raise HTTPException(422, "Segments are unchanged")
    if settings.task_load_contract is None:
        raise HTTPException(409, "Verified Maximo load is required to edit a task plan")
    await verify_plan_source(request, settings, anchor)
    days = {}
    for segment in body.segments:
        day = await db.get(PersonDayCapacity, (plan.pool_id, plan.person_id, segment.date))
        if day:
            require_resource_discipline(day.craft, anchor.discipline)
        validate_capacity(day, 0, 0)
        if day.laborcode != plan.laborcode:
            raise HTTPException(409, "Plan labor binding changes between days")
        days[segment.date] = day
    return anchor, days


async def day_loads(request, db, plan, settings, days):
    remote = {}
    start, before = min(days), max(days) + timedelta(days=1)
    while start < before:
        end = min(before, start + timedelta(days=31))
        remote.update(
            await remote_load(
                request, db, settings, plan.connection_id, {plan.laborcode}, start, end
            )
        )
        start = end
    # The plan's own rows are the ones being replaced, so they must not count against it.
    local = [
        i
        for i in (
            await db.scalars(
                select(Allocation).where(
                    Allocation.connection_id == plan.connection_id, Allocation.state == "reserved"
                )
            )
        ).unique()
        if i.plan_id != plan.id
    ]
    return {d: effective_load(local, remote, plan.laborcode, d)["allocated_minutes"] for d in days}


async def edit_segments(request, pool_id, plan_id, body):
    from app.assignments.routes import key, view

    item, identity, settings, _ = await scoped_plan(
        request, plan_id, write=True, csrf=True, eligible=True
    )
    if item.pool_id != pool_id:
        raise HTTPException(404, "Assignment plan not found")
    async with serialized(request, item, identity, settings) as db:
        request_hash = digest(
            {
                "plan_segments": str(plan_id),
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
        plan, items = await plan_items(db, plan_id)
        anchor, days = await validated_targets(request, db, plan, items, settings, body)
        allocated = await day_loads(request, db, plan, settings, days)
        for segment in body.segments:
            validate_capacity(days[segment.date], segment.minutes, allocated[segment.date])
        await verify_plan_source(request, settings, anchor)
        await current_remote_scope(request, db, item, identity, settings, eligible=True)
        await recheck(request, db, item, identity, settings, write=True, csrf=True)
        previous_revision = await revision(db, pool_id, item.connection_id, item.discipline)
        existing = {i.date: i for i in items}
        wanted = {s.date: s.minutes for s in body.segments}
        cells = {(plan.person_id, d) for d in existing} | {(plan.person_id, d) for d in wanted}
        changes = []  # (allocation, before view or None)
        for old_date, row in existing.items():
            if old_date not in wanted:
                changes.append((row, view(row)))
                row.state = "released"
                row.version += 1
            elif row.minutes != wanted[old_date]:
                changes.append((row, view(row)))
                row.minutes = wanted[old_date]
                row.version += 1
        plan.version += 1
        for new_date in sorted(set(wanted) - set(existing)):
            day = days[new_date]
            row = Allocation(
                pool_id=pool_id,
                connection_id=item.connection_id,
                site_id=anchor.site_id,
                workorder_id=anchor.workorder_id,
                discipline=anchor.discipline,
                plan=plan,
                person_id=plan.person_id,
                laborcode=day.laborcode,
                craft=day.craft,
                role=day.role,
                date=new_date,
                minutes=wanted[new_date],
                task_workorder_id=anchor.task_workorder_id,
                task_id=anchor.task_id,
                task_description=anchor.task_description,
                assignment_id=plan.assignment_id,
                upstream_baseline=anchor.upstream_baseline,
                sync_state="local",
                state="reserved",
            )
            db.add(row)
            changes.append((row, None))
        await db.flush()
        for row, before in changes:
            db.add(
                AssignmentEvent(
                    actor_id=identity.user_id,
                    allocation_id=row.id,
                    event="plan_segments",
                    details={
                        "plan_id": str(plan_id),
                        "before": before,
                        "after": view(row),
                        "plan_version": plan.version,
                        "request_id": str(body.request_id),
                    },
                )
            )
        changed = [row for row, _ in changes]
        result = {
            "request_id": str(body.request_id),
            "plan_id": str(plan_id),
            "plan_version": plan.version,
            "plan_total_minutes": plan.demand_minutes,
            "task_workorder_id": anchor.task_workorder_id,
            "task_id": anchor.task_id,
            "assignment_id": plan.assignment_id,
            "items": [view(i) for i in changed],
        }
        result.update(
            await metadata(
                request,
                db,
                settings,
                key(item),
                item.discipline,
                pool_id,
                cells,
                [i.id for i in changed],
                previous_revision=previous_revision,
            )
        )
        # Always have an allocation to anchor the receipt, even when nothing changed.
        db.add(
            AssignmentSubmission(
                actor_id=identity.user_id,
                request_id=body.request_id,
                allocation_id=(changed or items)[0].id,
                request_hash=request_hash,
                result=result,
            )
        )
        return result


def register(router):
    @router.post("/resource-pools/{pool_id}/assignment-plans/{plan_id}/segments")
    async def plan_segments(
        request: Request, pool_id: UUID, plan_id: UUID, body: PlanSegmentsRequest
    ):
        return await edit_segments(request, pool_id, plan_id, body)
