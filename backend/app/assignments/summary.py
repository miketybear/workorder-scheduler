"""Planning completion is scoped task demand, never WO duration or visible dates."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import ROUND_CEILING, Decimal, InvalidOperation

from sqlalchemy import select, tuple_
from sqlalchemy.dialects.postgresql import insert

from app.assignments.models import Allocation, PlanningSnapshot


def unverified():
    return dict(
        state="unverified",
        remaining_minutes=None,
        remaining_tasks=None,
        total_tasks=None,
        verified_at=None,
    )


async def remember_tasks(db, key, discipline, tasks):
    now = datetime.now(UTC)
    statement = insert(PlanningSnapshot).values(
        connection_id=key.connection_id,
        site_id=key.site_id,
        workorder_id=key.workorder_id,
        discipline=discipline,
        tasks=[t.model_dump(mode="json") for t in tasks],
        verified_at=now,
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=["connection_id", "site_id", "workorder_id", "discipline"],
            set_={"tasks": statement.excluded.tasks, "verified_at": now},
        )
    )


def minutes(hours):
    value = Decimal(str(hours))
    if not value.is_finite() or value < 0:
        raise ValueError("Unknown labor demand")
    return int((value * 60).to_integral_value(rounding=ROUND_CEILING))


def calculate(tasks, allocations, discipline, verified_at):
    try:
        return calculate_verified(tasks, allocations, discipline, verified_at)
    except (InvalidOperation, TypeError, ValueError, KeyError):
        # Unknown upstream hours/quantity must never disappear into Completed.
        return unverified()


def calculate_verified(tasks, allocations, discipline, verified_at):
    remaining, covered, total_tasks, remaining_tasks = 0, 0, 0, 0
    local = defaultdict(list)
    for row in allocations:
        local[row.assignment_id].append(row)
    source_ids = {s["assignment_id"] for task in tasks for s in task["assignments"]}
    if any(row.assignment_id not in source_ids for row in allocations):
        return unverified()
    for task in tasks:
        if task.get("has_out_of_scope_demand", True):
            return unverified()
        planned, sources = task["planned_labor"], task["assignments"]
        if not planned and not sources:
            continue
        if any(p["craft"] != discipline for p in planned) or any(
            s["craft"] != discipline for s in sources
        ):
            return unverified()
        planned_demand = sum(
            minutes(Decimal(str(p["labor_hours"])) * Decimal(str(p["quantity"]))) for p in planned
        )
        demand = sum(minutes(s["labor_hours"]) for s in sources)
        if not sources or demand <= 0 or (planned and planned_demand != demand):
            return unverified()
        task_remaining = 0
        for source in sources:
            needed = minutes(source["labor_hours"])
            rows = local.get(source["assignment_id"], [])
            if any(
                r.task_workorder_id != task["task_workorder_id"] or r.task_id != task["task_id"]
                for r in rows
            ):
                return unverified()
            remote = bool(source["laborcode"] and source["scheduledate"])
            if remote and (
                needed > 630 or source["status"] not in {"ASSIGNED", "STARTED", "COMPLETE"}
            ):
                return unverified()
            if not remote and (
                source["status"] != "WAITASGN" or source["laborcode"] or source["scheduledate"]
            ):
                return unverified()
            # Synced rows represent the same remote assignment, not additional demand.
            if any(r.sync_state not in {"local", "synced"} for r in rows):
                return unverified()
            reserved = sum(r.minutes for r in rows if r.sync_state == "local")
            if remote and reserved:
                return unverified()
            placed = needed if remote else min(needed, reserved)
            task_remaining += needed - placed
            covered += placed
        total_tasks += 1
        remaining += task_remaining
        remaining_tasks += bool(task_remaining)
    if not total_tasks:
        return unverified()
    return dict(
        state="completed" if remaining == 0 else "partial" if covered else "unallocated",
        remaining_minutes=remaining,
        remaining_tasks=remaining_tasks,
        total_tasks=total_tasks,
        verified_at=verified_at.isoformat(),
    )


async def planning_summary(db, key, discipline, ttl):
    snapshot = await db.get(
        PlanningSnapshot,
        (key.connection_id, key.site_id, key.workorder_id, discipline),
        populate_existing=True,
    )
    if not snapshot or snapshot.verified_at < datetime.now(UTC) - timedelta(seconds=ttl):
        return unverified()
    rows = (
        await db.scalars(
            select(Allocation).where(
                Allocation.connection_id == key.connection_id,
                Allocation.site_id == key.site_id,
                Allocation.workorder_id == key.workorder_id,
                Allocation.discipline == discipline,
                Allocation.craft == discipline,
                Allocation.state == "reserved",
            )
        )
    ).all()
    return calculate(snapshot.tasks, rows, discipline, snapshot.verified_at)


async def list_summaries(db, connection_id, discipline, orders, ttl):
    """Two bounded ledger queries, rather than a query per backlog row."""
    keys = {(o.siteid, o.workorderid) for o in orders}
    results = {key: unverified() for key in keys}
    if not keys:
        return results
    snapshots = (
        await db.scalars(
            select(PlanningSnapshot).where(
                PlanningSnapshot.connection_id == connection_id,
                PlanningSnapshot.discipline == discipline,
                PlanningSnapshot.verified_at >= datetime.now(UTC) - timedelta(seconds=ttl),
                tuple_(PlanningSnapshot.site_id, PlanningSnapshot.workorder_id).in_(keys),
            )
        )
    ).all()
    fresh_keys = {(s.site_id, s.workorder_id) for s in snapshots}
    if not fresh_keys:
        return results
    rows = (
        await db.scalars(
            select(Allocation).where(
                Allocation.connection_id == connection_id,
                Allocation.discipline == discipline,
                Allocation.craft == discipline,
                Allocation.state == "reserved",
                tuple_(Allocation.site_id, Allocation.workorder_id).in_(fresh_keys),
            )
        )
    ).all()
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row.site_id, row.workorder_id)].append(row)
    for snapshot in snapshots:
        key = (snapshot.site_id, snapshot.workorder_id)
        results[key] = calculate(snapshot.tasks, grouped[key], discipline, snapshot.verified_at)
    return results

