"""Return authoritative changed cells without re-reading the whole workspace."""

from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select

from app.assignments.load import remote_load
from app.assignments.models import Allocation
from app.assignments.summary import planning_summary
from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import MaximoConnection
from app.maximo.connections import configured_connection
from app.maximo.task_load import effective_load
from app.rota.models import PersonDayCapacity, ResourcePoolState
from app.rota.routes import authority
from app.scheduling.drafts import require_scope
from app.scheduling.routes import digest


async def transaction_authority(request, db, key, discipline, pool_id, *, write):
    # PERSON synchronization already ran before this transaction acquired User locks.
    # Re-entering checked_settings would open another session and lock the same User.
    identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
    if write:
        verify_csrf(identity, request.headers.get("X-CSRF-Token"))
    await require_scope(db, identity.user_id, key, discipline, write=write)
    pool_actor, pool, _, _ = await authority(db, request, pool_id, write)
    if pool_actor.user_id != identity.user_id:
        raise HTTPException(401, "Sign-in required")
    if pool.connection_id != key.connection_id:
        raise HTTPException(404, "Resource pool not found")
    connection = await db.get(MaximoConnection, key.connection_id, populate_existing=True)
    if connection is None or not connection.enabled:
        raise HTTPException(404, "Connection or discipline not found")
    return identity, configured_connection(request.app.state.settings, connection)


async def revision(db, pool_id, connection_id, discipline):
    bindings = select(PersonDayCapacity.laborcode).where(
        PersonDayCapacity.pool_id == pool_id,
        PersonDayCapacity.craft == discipline,
        PersonDayCapacity.role != "MATERIAL_CONTROLLER",
    )
    counts = (
        await db.execute(
            select(
                func.count(Allocation.id),
                func.coalesce(func.sum(Allocation.version), 0),
                func.coalesce(func.sum(case((Allocation.sync_state == "synced", 1), else_=0)), 0),
                func.coalesce(func.sum(case((Allocation.sync_state == "unknown", 1), else_=0)), 0),
            ).where(
                or_(Allocation.pool_id == pool_id, Allocation.laborcode.in_(bindings)),
                Allocation.connection_id == connection_id,
                Allocation.discipline == discipline,
                Allocation.craft == discipline,
            )
        )
    ).one()
    state = await db.get(ResourcePoolState, pool_id)
    return digest(
        {
            "pool": str(pool_id),
            "version": state.version if state else 0,
            # Versions only increase and runtime cannot delete allocation history.
            "allocations": list(counts),
        }
    )


async def metadata(
    request,
    db,
    settings,
    key,
    discipline,
    pool_id,
    cells,
    allocation_ids=(),
    *,
    previous_revision=None,
    write=True,
):
    from app.assignments.routes import view

    identity, initial_settings = await transaction_authority(
        request, db, key, discipline, pool_id, write=write
    )
    if initial_settings != settings:
        raise HTTPException(409, "Assignment scope changed; refresh")
    if previous_revision is None:
        previous_revision = await revision(db, pool_id, key.connection_id, discipline)
    updates = (
        (
            await db.scalars(
                select(Allocation).where(
                    Allocation.id.in_(allocation_ids),
                    Allocation.pool_id == pool_id,
                    Allocation.connection_id == key.connection_id,
                    Allocation.discipline == discipline,
                    Allocation.craft == discipline,
                )
            )
        ).all()
        if allocation_ids
        else []
    )
    cells = set(cells) | {(item.person_id, item.date) for item in updates}
    local = (
        await db.scalars(
            select(Allocation).where(
                Allocation.connection_id == key.connection_id, Allocation.state == "reserved"
            )
        )
    ).all()
    affected = []
    for person_id, day_date in sorted(set(cells), key=lambda x: (str(x[0]), x[1])):
        day = await db.get(PersonDayCapacity, (pool_id, person_id, day_date))
        if day is None:
            raise HTTPException(409, "Resource rota changed; refresh before saving")
        if day.craft != discipline:
            raise HTTPException(404, "Assignment resource not found")
        remote = None
        for conn, labors, start, before, snapshot in getattr(
            request.state, "assignment_load_snapshots", []
        ):
            if conn == key.connection_id and day.laborcode in labors and start <= day_date < before:
                remote = snapshot
        if remote is None and settings.task_load_contract is not None:
            remote = await remote_load(
                request,
                db,
                settings,
                key.connection_id,
                {day.laborcode},
                day_date,
                day_date + timedelta(days=1),
            )
        totals = effective_load(local, remote or {}, day.laborcode, day_date)
        capacity = int(day.capacity_hours * 60)
        affected.append(
            dict(
                pool_id=str(pool_id),
                person_id=str(person_id),
                craft=day.craft,
                laborcode=day.laborcode,
                date=day_date.isoformat(),
                code=day.code,
                capacity_minutes=capacity,
                remaining_minutes=capacity - totals["allocated_minutes"],
                load_complete=remote is not None,
                **totals,
            )
        )
    current, current_settings = await transaction_authority(
        request, db, key, discipline, pool_id, write=write
    )
    if current.user_id != identity.user_id:
        raise HTTPException(401, "Sign-in required")
    if current_settings != settings:
        raise HTTPException(409, "Assignment scope changed; refresh")
    return dict(
        affected_days=affected,
        allocation_updates=[view(item) for item in updates],
        assignment_revision=await revision(db, pool_id, key.connection_id, discipline),
        previous_assignment_revision=previous_revision,
        work_order=getattr(request.state, "assignment_work_orders", {}).get(
            (key.connection_id, key.site_id, key.workorder_id, discipline)
        ),
        planning_summary=await planning_summary(
            db, key, discipline, request.app.state.settings.assignment_summary_ttl_seconds
        ),
    )


async def receipt_metadata(request, db, settings, key, discipline, pool_id, result, *, write=False):
    from datetime import date
    from uuid import UUID

    items = (
        [i for p in result["plans"] for i in p["items"]]
        if "plans" in result
        else result.get("items", [result])
    )
    cells = {(UUID(i["person_id"]), date.fromisoformat(i["date"])) for i in items}
    cells.update(
        (UUID(d["person_id"]), date.fromisoformat(d["date"]))
        for d in result.get("affected_days", [])
    )
    refreshed = {
        **result,
        **await metadata(
            request,
            db,
            settings,
            key,
            discipline,
            pool_id,
            cells,
            [UUID(i["id"]) for i in items],
            write=write,
        ),
    }
    return refreshed
