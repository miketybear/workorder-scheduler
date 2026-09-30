import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AccessGrant, Draft, DraftItem, MaximoConnection, User
from app.scheduling.changes import ScheduleChanges, WorkOrderBaseline, build_changes


@dataclass(frozen=True)
class WorkOrderKey:
    connection_id: uuid.UUID
    site_id: str
    workorder_id: str


@dataclass(frozen=True)
class CurrentWorkOrder:
    key: WorkOrderKey
    wonum: str
    discipline: str
    revision: str | None
    baseline: WorkOrderBaseline
    allowed_pics: frozenset[str]


ReadCurrent = Callable[[WorkOrderKey], Awaitable[CurrentWorkOrder]]


async def require_scope(
    db: AsyncSession, user_id: uuid.UUID, key: WorkOrderKey, discipline: str, *, write: bool
) -> None:
    grant = await db.scalar(
        select(AccessGrant.id)
        .join(User)
        .join(MaximoConnection)
        .where(
            User.id == user_id,
            User.active.is_(True),
            MaximoConnection.enabled.is_(True),
            AccessGrant.connection_id == key.connection_id,
            AccessGrant.discipline == discipline,
            AccessGrant.capability.in_(["write"] if write else ["read", "write"]),
        )
    )
    if grant is None:
        raise HTTPException(404, "Work order not found")


async def create_draft(
    db: AsyncSession, user_id: uuid.UUID, current: CurrentWorkOrder, changes: ScheduleChanges
) -> Draft:
    """Accept only a freshly retrieved, server-validated snapshot, never a browser baseline.

    Caller owns the transaction and obtains this snapshot from the scoped Maximo reader.
    """
    await require_scope(db, user_id, current.key, current.discipline, write=True)
    if not build_changes(current.baseline, changes, set(current.allowed_pics)):
        raise ValueError("Draft must contain at least one changed field")
    draft = Draft(owner_id=user_id, connection_id=current.key.connection_id)
    db.add(draft)
    await db.flush()
    db.add(
        DraftItem(
            draft_id=draft.id,
            site_id=current.key.site_id,
            workorder_id=current.key.workorder_id,
            wonum=current.wonum,
            discipline=current.discipline,
            upstream_revision=current.revision,
            baseline=current.baseline.model_dump(mode="json"),
            changes=changes.model_dump(mode="json", exclude_unset=True),
        )
    )
    await db.flush()
    return draft


async def load_draft(
    db: AsyncSession, user_id: uuid.UUID, draft_id: uuid.UUID, read_current: ReadCurrent
) -> list[DraftItem]:
    draft = await db.scalar(select(Draft).where(Draft.id == draft_id, Draft.owner_id == user_id))
    if draft is None:
        raise HTTPException(404, "Draft not found")
    items = list((await db.scalars(select(DraftItem).where(DraftItem.draft_id == draft.id))).all())
    # Never return cached WO content until both current grants and upstream discipline are checked.
    for item in items:
        key = WorkOrderKey(draft.connection_id, item.site_id, item.workorder_id)
        await require_scope(db, user_id, key, item.discipline, write=False)
        current = await read_current(key)
        if current.key != key or current.discipline != item.discipline:
            raise HTTPException(404, "Draft not found")
        await require_scope(db, user_id, key, current.discipline, write=False)
    return items
