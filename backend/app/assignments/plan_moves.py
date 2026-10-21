"""Scoped, atomic relocation of every remaining local segment of one task plan."""

from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.assignments.capacity import validate_capacity
from app.assignments.incremental import metadata, receipt_metadata, revision
from app.assignments.load import remote_load
from app.assignments.models import Allocation, AssignmentEvent, AssignmentSubmission
from app.assignments.plan_backfill import backfill_for_move, computed, requested
from app.assignments.plan_uploads import (
    current_remote_scope,
    plan_items,
    recheck,
    scoped_plan,
    serialized,
)
from app.assignments.plans import PlanSegment, verify_plan_source
from app.maximo.task_load import effective_load
from app.rota.models import PersonDayCapacity, ResourcePerson
from app.scheduling.routes import digest


class MovePreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: UUID
    discipline: str = Field(min_length=1, max_length=50)
    expected_plan_version: int = Field(ge=1, strict=True)
    anchor_allocation_id: UUID
    target_person_id: UUID
    target_date: date
    mode: Literal["shift", "reallocate"]
    backfill: bool = True


class BackfillPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_id: UUID
    expected_version: int = Field(ge=1, strict=True)
    segments: list[PlanSegment] = Field(min_length=1, max_length=366)


class MoveRequest(MovePreview):
    request_id: UUID
    segments: list[PlanSegment] = Field(min_length=1, max_length=366)
    backfill_plans: list[BackfillPlan] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_dates(self):
        if len({s.date for s in self.segments}) != len(self.segments):
            raise ValueError("Plan dates must be unique")
        return self


def conflict(message, mode):
    raise HTTPException(
        409,
        {"message": message, "code": "plan_move_conflict", "can_reallocate": mode == "shift"},
    )


async def proposal(request, db, plan, items, settings, body, backfill):
    from app.assignments.routes import key, require_resource_discipline, view

    if plan.version != body.expected_plan_version:
        raise HTTPException(409, "Plan changed; reload before moving")
    if (
        plan.state != "reserved"
        or plan.sync_state != "local"
        or any(i.sync_state != "local" or i.remote_assignment_id for i in items)
    ):
        raise HTTPException(409, "Uploaded or unresolved plan cannot be moved")
    anchor = next((i for i in items if i.id == body.anchor_allocation_id), None)
    if anchor is None:
        raise HTTPException(409, "Anchor segment changed; reload before moving")
    if any(
        i.person_id != plan.person_id
        or i.laborcode != plan.laborcode
        or i.pool_id != plan.pool_id
        or i.assignment_id != plan.assignment_id
        or i.task_workorder_id != anchor.task_workorder_id
        or i.task_id != anchor.task_id
        or key(i) != key(anchor)
        or i.discipline != anchor.discipline
        or i.upstream_baseline != anchor.upstream_baseline
        for i in items
    ):
        raise HTTPException(409, "Plan identity changed; reload before moving")
    total = sum(i.minutes for i in items)
    if total > plan.demand_minutes or len(items) > 366:
        raise HTTPException(409, "Reserved plan no longer matches its original demand")
    person = await db.get(ResourcePerson, body.target_person_id)
    if not person or person.pool_id != plan.pool_id:
        raise HTTPException(404, "Assignment resource not found")
    if settings.task_load_contract is None:
        raise HTTPException(409, "Verified Maximo load is required to move a task plan")
    await verify_plan_source(request, settings, anchor)
    if body.mode == "shift":
        delta = body.target_date - anchor.date
        try:
            candidates = [i.date + delta for i in items]
        except OverflowError:
            raise HTTPException(422, "Shifted dates are outside the supported range") from None
        if max(candidates) == date.max or (max(candidates) - min(candidates)).days >= 366:
            raise HTTPException(422, "Shifted dates must span at most 366 calendar days")
    else:
        try:
            candidates = [body.target_date + timedelta(days=i) for i in range(366)]
            if candidates[-1] == date.max:
                raise OverflowError
        except OverflowError:
            raise HTTPException(422, "Reallocation dates are outside the supported range") from None
    days = {
        d.date: d
        for d in await db.scalars(
            select(PersonDayCapacity).where(
                PersonDayCapacity.pool_id == plan.pool_id,
                PersonDayCapacity.person_id == body.target_person_id,
                PersonDayCapacity.date.in_(candidates),
            )
        )
    }
    for day in days.values():
        require_resource_discipline(day.craft, anchor.discipline)
    available_days = []
    for day in sorted(days.values(), key=lambda d: d.date):
        try:
            validate_capacity(day, 0, 0)
        except HTTPException:
            continue
        available_days.append(day)
    labors = {d.laborcode for d in available_days}
    if not available_days or (body.mode == "shift" and len(labors) != 1):
        conflict("Target rota labor binding is unavailable or changes between days", body.mode)
    laborcode = available_days[0].laborcode
    remote = {}
    start, before = min(candidates), max(candidates) + timedelta(days=1)
    loaded_before = start
    if body.mode == "shift":
        while start < before:
            end = min(before, start + timedelta(days=31))
            remote.update(
                await remote_load(
                    request, db, settings, plan.connection_id, {laborcode}, start, end
                )
            )
            start = end
    # Exclude the entire source plan before testing a same-person move onto its old dates.
    local = list(
        (
            await db.scalars(
                select(Allocation).where(
                    Allocation.connection_id == plan.connection_id,
                    Allocation.state == "reserved",
                )
            )
        ).unique()
    )
    local = [i for i in local if i.plan_id != plan.id]
    segments, capacities = [], []
    remaining = total
    for index, target in enumerate(candidates):
        day = days.get(target)
        if body.mode == "reallocate":
            if not day or day not in available_days:
                continue
            if day.laborcode != laborcode:
                conflict("Target rota labor binding changes between proposed days", body.mode)
            if target >= loaded_before:
                loaded_before = min(before, target + timedelta(days=31))
                remote.update(
                    await remote_load(
                        request,
                        db,
                        settings,
                        plan.connection_id,
                        {laborcode},
                        target,
                        loaded_before,
                    )
                )
        allocated = effective_load(local, remote, laborcode, target)["allocated_minutes"]
        minutes = items[index].minutes if body.mode == "shift" else 0
        if body.mode == "reallocate":
            try:
                validate_capacity(day, 0, allocated)
            except HTTPException:
                continue
            minutes = min(remaining, min(630, int(day.capacity_hours * 60)) - allocated)
            if minutes <= 0:
                continue
        try:
            validate_capacity(day, minutes, allocated)
        except HTTPException as error:
            conflict(str(error.detail), body.mode)
        segments.append({"date": target.isoformat(), "minutes": minutes})
        capacity = min(630, int(day.capacity_hours * 60))
        capacities.append(
            dict(
                person_id=str(body.target_person_id),
                date=target.isoformat(),
                laborcode=laborcode,
                capacity_minutes=capacity,
                allocated_minutes=allocated,
                remaining_minutes=capacity - allocated,
                proposed_minutes=minutes,
                remaining_after_minutes=capacity - allocated - minutes,
            )
        )
        remaining -= minutes
        if body.mode == "reallocate" and remaining == 0:
            break
    if remaining:
        conflict("Not enough verified rota capacity within 366 days", body.mode)
    followers, applications = await backfill_for_move(
        request, db, settings, plan, items, anchor, local, segments, laborcode, backfill
    )
    await verify_plan_source(request, settings, anchor)
    return {
        "plan_id": str(plan.id),
        "plan_version": plan.version,
        "pool_id": str(plan.pool_id),
        "connection_id": str(plan.connection_id),
        "discipline": anchor.discipline,
        "task_workorder_id": anchor.task_workorder_id,
        "task_id": anchor.task_id,
        "assignment_id": plan.assignment_id,
        "source_person_id": str(plan.person_id),
        "target_person_id": str(body.target_person_id),
        "source_laborcode": plan.laborcode,
        "target_laborcode": laborcode,
        "original_demand_minutes": plan.demand_minutes,
        "total_minutes": total,
        "mode": body.mode,
        "anchor_allocation_id": str(body.anchor_allocation_id),
        "target_date": body.target_date.isoformat(),
        "old_items": [view(i) for i in items],
        "segments": segments,
        "capacity": capacities,
        "backfill": followers,
    }, applications


def hashed_out(body):
    """Keep receipt hashes of requests that predate backfill unchanged."""
    excluded = {"backfill"}
    return excluded | ({"backfill_plans"} if not getattr(body, "backfill_plans", None) else set())


def apply_backfill(db, applications, person_id, cells):
    """Rewrite follower rows like a day-segment edit; returns (plan, before view, row)."""
    from app.assignments.routes import view

    out = []
    for app in applications:
        plan, wanted = app["plan"], app["after"]
        existing = {r.date: r for r in app["rows"]}
        template = app["rows"][0]
        cells.update((person_id, d) for d in existing)
        cells.update((person_id, d) for d in wanted)
        changes = []
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
            day = app["days"][new_date]
            row = Allocation(
                pool_id=plan.pool_id,
                connection_id=plan.connection_id,
                site_id=template.site_id,
                workorder_id=template.workorder_id,
                discipline=template.discipline,
                plan=plan,
                person_id=person_id,
                laborcode=day.laborcode,
                craft=day.craft,
                role=day.role,
                date=new_date,
                minutes=wanted[new_date],
                task_workorder_id=template.task_workorder_id,
                task_id=template.task_id,
                task_description=template.task_description,
                assignment_id=plan.assignment_id,
                upstream_baseline=template.upstream_baseline,
                sync_state="local",
                state="reserved",
            )
            db.add(row)
            changes.append((row, None))
        out.extend((plan, before, row) for row, before in changes)
    return out


async def move(request, pool_id, plan_id, body, *, commit=False):
    from app.assignments.routes import key, view

    item, identity, settings, _ = await scoped_plan(
        request, plan_id, write=True, csrf=True, eligible=True
    )
    if (
        item.pool_id != pool_id
        or item.connection_id != body.connection_id
        or item.discipline != body.discipline
    ):
        raise HTTPException(404, "Assignment plan not found")
    async with serialized(request, item, identity, settings) as db:
        request_hash = digest(
            {
                "plan_move": str(plan_id),
                "pool_id": str(pool_id),
                "body": body.model_dump(mode="json", exclude=hashed_out(body)),
            }
        )
        if commit:
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
        # A commit recomputes backfill only when the client asked for the previewed plans.
        intent, applications = await proposal(
            request,
            db,
            plan,
            items,
            settings,
            body,
            bool(body.backfill_plans) if commit else body.backfill,
        )
        await current_remote_scope(request, db, item, identity, settings, eligible=True)
        await recheck(request, db, item, identity, settings, write=True, csrf=True)
        if not commit:
            return intent
        if [s.model_dump(mode="json") for s in body.segments] != intent["segments"]:
            raise HTTPException(409, "Move preview changed; review a fresh preview before saving")
        if requested(body.backfill_plans) != computed(intent["backfill"]):
            raise HTTPException(
                409, "Backfill changed since the preview; review a fresh preview before saving"
            )
        previous_revision = await revision(db, pool_id, item.connection_id, item.discipline)
        old = intent["old_items"]
        cells = {(i.person_id, i.date) for i in items}
        template = items[0]
        source_person_id = plan.person_id
        # The date uniqueness index covers reserved rows. Free the old dates in this
        # transaction before overlapping shifts restore the same row identities.
        for i in items:
            i.state = "released"
        await db.flush()
        plan.person_id = body.target_person_id
        plan.laborcode = intent["target_laborcode"]
        plan.version += 1
        changed = list(items)
        for i in items:
            i.version += 1
        for index, segment in enumerate(intent["segments"]):
            day_date = date.fromisoformat(segment["date"])
            day = await db.get(PersonDayCapacity, (pool_id, body.target_person_id, day_date))
            if index < len(items):
                target = items[index]
            else:
                target = Allocation(
                    pool_id=pool_id,
                    connection_id=item.connection_id,
                    site_id=template.site_id,
                    workorder_id=template.workorder_id,
                    discipline=template.discipline,
                    plan=plan,
                    task_workorder_id=template.task_workorder_id,
                    task_id=template.task_id,
                    task_description=template.task_description,
                    assignment_id=plan.assignment_id,
                    upstream_baseline=template.upstream_baseline,
                    sync_state="local",
                )
                db.add(target)
                changed.append(target)
            target.person_id = body.target_person_id
            target.laborcode = day.laborcode
            target.craft = day.craft
            target.role = day.role
            target.date = day_date
            target.minutes = segment["minutes"]
            target.state = "reserved"
            cells.add((target.person_id, target.date))
        backfilled = apply_backfill(db, applications, source_person_id, cells)
        await db.flush()
        for plan_after, before, allocation in backfilled:
            db.add(
                AssignmentEvent(
                    actor_id=identity.user_id,
                    allocation_id=allocation.id,
                    event="plan_backfill",
                    details={
                        "plan_id": str(plan_after.id),
                        "moved_plan_id": str(plan_id),
                        "before": before,
                        "after": view(allocation),
                        "plan_version": plan_after.version,
                        "request_id": str(body.request_id),
                    },
                )
            )
        for index, allocation in enumerate(changed):
            db.add(
                AssignmentEvent(
                    actor_id=identity.user_id,
                    allocation_id=allocation.id,
                    event="plan_move",
                    details={
                        "plan_id": str(plan_id),
                        "mode": body.mode,
                        "before": old[index] if index < len(old) else None,
                        "after": view(allocation),
                        "plan_version": plan.version,
                        "request_id": str(body.request_id),
                    },
                )
            )
        result = {
            "request_id": str(body.request_id),
            "plan_id": str(plan_id),
            "plan_version": plan.version,
            "items": [view(i) for i in changed],
            "backfill_items": [view(a) for _, _, a in backfilled],
            "backfill_plans": [
                {"plan_id": str(a["plan"].id), "plan_version": a["plan"].version}
                for a in applications
            ],
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
                [i.id for i in changed] + [a.id for _, _, a in backfilled],
                previous_revision=previous_revision,
            )
        )
        db.add(
            AssignmentSubmission(
                actor_id=identity.user_id,
                request_id=body.request_id,
                allocation_id=changed[0].id,
                request_hash=request_hash,
                result=result,
            )
        )
        return result


def register(router):
    @router.post("/resource-pools/{pool_id}/assignment-plans/{plan_id}/move-preview")
    async def preview(request: Request, pool_id: UUID, plan_id: UUID, body: MovePreview):
        return await move(request, pool_id, plan_id, body)

    @router.post("/resource-pools/{pool_id}/assignment-plans/{plan_id}/move")
    async def commit(request: Request, pool_id: UUID, plan_id: UUID, body: MoveRequest):
        return await move(request, pool_id, plan_id, body, commit=True)
