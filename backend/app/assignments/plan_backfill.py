"""Close the gap a moved task plan leaves behind by pulling later same-WO plans forward.

compact() is pure. backfill_for_move() gathers the same facts plan moves and day-segment edits
use (rota capacity, Maximo plus other local load) and returns both the public preview and the
rows to apply, so the preview and the commit share one computation.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.assignments.capacity import validate_capacity
from app.assignments.load import remote_load
from app.maximo.task_load import effective_load
from app.rota.models import PersonDayCapacity

DAY_LIMIT = 630
HORIZON_DAYS = 366


@dataclass(frozen=True)
class Follower:
    plan_id: str
    task_id: int
    rows: tuple[tuple[date, int], ...]


def compact(followers, vacated, capacity, external):
    """Return (changes, skipped): plans pull hours into cells that were just freed.

    For each vacated date d (ascending, re-queued as hours move away from later dates), the
    free capacity of d goes to plans that already sit on d and continue after it, earliest
    starting plan first. Each takes hours from its own latest days, so totals stay unchanged
    and no plan ever finishes later.

    capacity: working-day limit per date (missing or <= 0 means no rota capacity).
    external: minutes used by everything that is not one of the followers; None (or a missing
    date) means the load is unverified and every candidate that would touch it is skipped.
    """
    rows = {f.plan_id: dict(f.rows) for f in followers}
    task = {f.plan_id: f.task_id for f in followers}
    original = {f.plan_id: sorted(f.rows) for f in followers}
    skipped: dict[str, str] = {}
    work = set(vacated)
    for _ in range(100_000):  # hours only move earlier, so this bound is never reached
        if not work:
            break
        d = min(work)
        work.discard(d)
        limit = min(DAY_LIMIT, capacity.get(d, 0))
        if limit <= 0:
            continue
        order = sorted(
            (p for p, r in rows.items() if d in r and any(x > d for x in r)),
            key=lambda p: (min(rows[p]), task[p], p),
        )
        free = limit - (external.get(d) or 0) - sum(r.get(d, 0) for r in rows.values())
        for p in order:
            if free <= 0:
                break
            r = rows[p]
            take = min(free, sum(m for x, m in r.items() if x > d))
            cuts, left = [], take
            for x in sorted((x for x in r if x > d), reverse=True):
                cut = min(left, r[x])
                cuts.append((x, cut))
                left -= cut
                if not left:
                    break
            if external.get(d) is None or any(external.get(x) is None for x, _ in cuts):
                skipped[p] = "load_unverified"
                continue
            r[d] += take
            for x, cut in cuts:
                r[x] -= cut
                if r[x] == 0:
                    del r[x]
                work.add(x)
            free -= take
    changes = {}
    for p, r in rows.items():
        if sorted(r.items()) != original[p]:
            changes[p] = sorted(r.items())
            skipped.pop(p, None)
    return changes, skipped


def _segments(rows):
    return [{"date": d.isoformat(), "minutes": m} for d, m in rows]


async def backfill_for_move(
    request, db, settings, plan, items, anchor, local, new_segments, target_laborcode, enabled
):
    """Return (public, applications) for plans of the source person sharing the vacated days.

    local: every reserved allocation of the connection except the moved plan's own rows.
    Applications are internal: {"plan", "rows", "after", "days"} with ORM objects.
    """
    empty = {"enabled": enabled, "plans": [], "skipped": []}
    if not enabled:
        return empty, []
    vacated = {i.date for i in items}
    start = min(vacated)
    groups: dict = {}
    for row in local:
        p = row.plan
        if (
            p is None
            or row.person_id != plan.person_id
            or p.person_id != plan.person_id
            or p.pool_id != plan.pool_id
            or p.state != "reserved"
            or row.discipline != anchor.discipline
        ):
            continue
        groups.setdefault(p.id, (p, []))[1].append(row)
    candidates = {}
    for pid, (p, rows) in groups.items():
        if (
            p.sync_state == "local"
            and p.laborcode == plan.laborcode
            and all(
                r.sync_state == "local"
                and not r.remote_assignment_id
                and r.person_id == p.person_id
                and r.laborcode == p.laborcode
                for r in rows
            )
        ):
            candidates[pid] = (p, sorted(rows, key=lambda r: r.date))
    skipped = []
    for pid in list(candidates):
        p, rows = candidates[pid]
        if rows[-1].date < start:
            del candidates[pid]  # entirely earlier: cannot take part, stays as load
        elif (rows[-1].date - start).days >= HORIZON_DAYS:
            if any(r.date in vacated for r in rows):
                skipped.append(
                    {"plan_id": str(pid), "task_id": rows[0].task_id, "reason": "horizon"}
                )
            del candidates[pid]
    if not candidates:
        return {**empty, "skipped": skipped}, []
    last = max(rows[-1].date for _, rows in candidates.values())
    day_rows = {
        d.date: d
        for d in await db.scalars(
            select(PersonDayCapacity).where(
                PersonDayCapacity.pool_id == plan.pool_id,
                PersonDayCapacity.person_id == plan.person_id,
                PersonDayCapacity.date >= start,
                PersonDayCapacity.date <= last,
            )
        )
    }
    capacity = {}
    for d, day in day_rows.items():
        try:
            validate_capacity(day, 0, 0)
        except HTTPException:
            continue
        if day.craft == anchor.discipline and day.laborcode == plan.laborcode:
            capacity[d] = min(DAY_LIMIT, int(day.capacity_hours * 60))
    remote = {}
    cursor = start
    while cursor <= last:
        end = min(last + timedelta(days=1), cursor + timedelta(days=31))
        remote.update(
            await remote_load(
                request, db, settings, plan.connection_id, {plan.laborcode}, cursor, end
            )
        )
        cursor = end
    owned = {r.id for _, rows in candidates.values() for r in rows}
    others = [r for r in local if r.id not in owned]
    if target_laborcode == plan.laborcode:
        # A same-person move keeps occupying the source person's days after the relocation.
        others += [
            SimpleNamespace(
                id=uuid4(),
                laborcode=target_laborcode,
                date=date.fromisoformat(s["date"]),
                minutes=s["minutes"],
                sync_state="local",
                remote_assignment_id=None,
                assignment_id=None,
            )
            for s in new_segments
        ]
    external = {}
    day = start
    while day <= last:
        external[day] = effective_load(others, remote, plan.laborcode, day)["allocated_minutes"]
        day += timedelta(days=1)
    followers = [
        Follower(str(pid), rows[0].task_id or 0, tuple((r.date, r.minutes) for r in rows))
        for pid, (_, rows) in candidates.items()
    ]
    changes, unverified = compact(followers, vacated, capacity, external)
    for pid, (_, rows) in candidates.items():
        if str(pid) in unverified:
            skipped.append(
                {"plan_id": str(pid), "task_id": rows[0].task_id, "reason": unverified[str(pid)]}
            )
    plans, applications = [], []
    for pid, (p, rows) in sorted(
        candidates.items(), key=lambda kv: (kv[1][1][0].date, kv[1][1][0].task_id or 0, str(kv[0]))
    ):
        after = changes.get(str(pid))
        if after is None:
            continue
        plans.append(
            {
                "plan_id": str(pid),
                "plan_version": p.version,
                "task_workorder_id": rows[0].task_workorder_id,
                "task_id": rows[0].task_id,
                "task_description": rows[0].task_description,
                "before": _segments((r.date, r.minutes) for r in rows),
                "after": _segments(after),
                "finish_before": rows[-1].date.isoformat(),
                "finish_after": after[-1][0].isoformat(),
            }
        )
        applications.append(
            {
                "plan": p,
                "rows": rows,
                "after": dict(after),
                "days": {d: day_rows[d] for d, _ in after},
            }
        )
    return {"enabled": True, "plans": plans, "skipped": skipped}, applications


def requested(plans):
    """Normalize submitted backfill plans for comparison with the server's computation."""
    return sorted(
        (
            {
                "plan_id": str(p.plan_id),
                "plan_version": p.expected_version,
                "segments": _segments((s.date, s.minutes) for s in p.segments),
            }
            for p in plans
        ),
        key=lambda p: p["plan_id"],
    )


def computed(public):
    return sorted(
        (
            {"plan_id": p["plan_id"], "plan_version": p["plan_version"], "segments": p["after"]}
            for p in public["plans"]
        ),
        key=lambda p: p["plan_id"],
    )
