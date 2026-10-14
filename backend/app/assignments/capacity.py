from fastapi import HTTPException
from sqlalchemy import func, select

from app.assignments.models import Allocation
from app.rota.models import ResourcePerson
from app.rota.parser import CRAFT, POSITIONS, WORK


def validate_capacity(day, minutes, allocated):
    if (
        day is None
        or day.code not in WORK
        or day.craft not in set(CRAFT.values())
        or day.role not in set(POSITIONS.values())
        or not day.laborcode
    ):
        raise HTTPException(409, "Person is unavailable in the active rota on this date")
    budget = min(630, int(day.capacity_hours * 60))
    if budget <= 0 or allocated + minutes > budget:
        raise HTTPException(409, "Daily allocation exceeds active rota capacity")


async def replacement_blockers(db, pool_id, start, before, proposed):
    loads = (
        await db.execute(
            select(ResourcePerson.person_key, Allocation.date, func.sum(Allocation.minutes))
            .join(ResourcePerson, ResourcePerson.id == Allocation.person_id)
            .where(
                Allocation.pool_id == pool_id,
                Allocation.state == "reserved",
                Allocation.date >= start,
                Allocation.date < before,
            )
            .group_by(ResourcePerson.person_key, Allocation.date)
        )
    ).all()
    if any(
        total > int(proposed.get((key, day.isoformat()), {}).get("capacity_hours", 0) * 60)
        for key, day, total in loads
    ):
        return [
            "Replacement rota capacity is below existing reservations; release or move them first"
        ]
    allocations = (
        await db.execute(
            select(ResourcePerson.person_key, Allocation)
            .join(ResourcePerson, ResourcePerson.id == Allocation.person_id)
            .where(
                Allocation.pool_id == pool_id,
                Allocation.state == "reserved",
                Allocation.date >= start,
                Allocation.date < before,
            )
        )
    ).all()
    if any(
        any(
            proposed.get((key, item.date.isoformat()), {}).get(field) != getattr(item, field)
            for field in ("craft", "role", "laborcode")
        )
        for key, item in allocations
    ):
        return ["Replacement rota changes reserved eligibility; release or move reservations first"]
    return []
