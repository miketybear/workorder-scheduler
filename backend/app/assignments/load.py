from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select, text

from app.assignments.models import Allocation
from app.db.models import MaximoConnection
from app.maximo.task_load import effective_load, read_load


async def remote_load(request, db, settings, connection_id, laborcodes, start, before):
    connection = await db.get(MaximoConnection, connection_id)
    if not connection:
        raise HTTPException(404, "Connection not found")
    async with request.app.state.maximo_client_factory() as client:
        result = await read_load(client, settings, laborcodes, start, before, connection.timezone)
    cache = getattr(request.state, "assignment_load_snapshots", [])
    cache.append((connection_id, set(laborcodes), start, before, result))
    request.state.assignment_load_snapshots = cache
    return result


async def load_lock(db, connection_id):
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": "assignment-load:" + str(connection_id)},
    )


async def validate_remote_capacity(
    request, db, settings, day, connection_id, minutes, exclude_id=None
):
    from app.assignments.capacity import validate_capacity

    if day is None:
        validate_capacity(None, minutes, 0)
    # Pools may share a connection and labor binding. Serialize those ledgers together.
    await load_lock(db, connection_id)
    remote = await remote_load(
        request,
        db,
        settings,
        connection_id,
        {day.laborcode},
        day.date,
        day.date + timedelta(days=1),
    )
    local = (
        await db.scalars(
            select(Allocation).where(
                Allocation.connection_id == connection_id, Allocation.state == "reserved"
            )
        )
    ).all()
    totals = effective_load(local, remote, day.laborcode, day.date, exclude_id)
    validate_capacity(day, minutes, totals["allocated_minutes"])
    return totals


async def enrich_rows(request, db, settings, connection_id, rows, start, before):
    # An unavailable contract is explicit; never present local-only totals as complete.
    if settings.task_load_contract is None:
        for row in rows:
            for day in row["days"]:
                day.update(
                    local_minutes=day["allocated_minutes"],
                    external_minutes=0,
                    synced_minutes=0,
                    load_complete=False,
                )
        return rows
    remote = await remote_load(
        request, db, settings, connection_id, {r["laborcode"] for r in rows}, start, before
    )
    local = (
        await db.scalars(
            select(Allocation).where(
                Allocation.connection_id == connection_id, Allocation.state == "reserved"
            )
        )
    ).all()
    from datetime import date

    for row in rows:
        for day in row["days"]:
            totals = effective_load(
                local, remote, row["laborcode"], date.fromisoformat(day["date"])
            )
            day.update(
                totals,
                load_complete=True,
                remaining_minutes=day["capacity_minutes"] - totals["allocated_minutes"],
            )
    return rows
