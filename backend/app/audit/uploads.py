import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import AuditEvent, UploadBatch, UploadItem

UploadState = Literal["pending", "sending", "confirmed", "failed", "conflict", "unknown"]
TRANSITIONS: dict[str, frozenset[str]] = {
    "pending": frozenset({"sending", "failed", "conflict"}),
    "sending": frozenset({"confirmed", "failed", "conflict", "unknown"}),
    "unknown": frozenset({"confirmed", "failed", "conflict"}),
    "confirmed": frozenset(),
    "failed": frozenset(),
    "conflict": frozenset(),
}


def validate_transition(previous: str, following: UploadState, reconciled: bool) -> None:
    if following not in TRANSITIONS.get(previous, frozenset()):
        raise ValueError(f"Invalid upload transition: {previous} -> {following}")
    if previous == "unknown" and not reconciled:
        raise ValueError("Unknown outcomes require reconciliation, never automatic retry")


async def record_transition(
    db: AsyncSession,
    item: UploadItem,
    actor_id: uuid.UUID,
    state: UploadState,
    *,
    reconciled: bool = False,
) -> None:
    validate_transition(item.state, state, reconciled)
    item.state = state
    item.updated_at = datetime.now(UTC)
    details = {"state": state, "reconciled": reconciled}
    if state == "sending":
        details.update({"before": item.before, "changes": item.changes})
    db.add(
        AuditEvent(
            upload_item_id=item.id,
            actor_id=actor_id,
            event="intent" if state == "sending" else state,
            details=details,
        )
    )
    await db.flush()


async def transition_upload(
    sessions: async_sessionmaker[AsyncSession],
    item_id: uuid.UUID,
    actor_id: uuid.UUID,
    state: UploadState,
    *,
    reconciled: bool = False,
) -> None:
    """Internal persistence boundary. Caller must revalidate scope/current WO before sending.

    Returns only after state and event commit. This function does not call Maximo.
    """
    async with sessions.begin() as db:
        item = await db.scalar(
            select(UploadItem)
            .join(UploadBatch)
            .where(UploadItem.id == item_id, UploadBatch.actor_id == actor_id)
            .with_for_update()
        )
        if item is None:
            raise ValueError("Upload item not found")
        await record_transition(db, item, actor_id, state, reconciled=reconciled)


async def recover_stale_sends(sessions: async_sessionmaker[AsyncSession], before: datetime) -> int:
    """Mark abandoned sends unknown; never resend. Run only after worker ownership is settled."""
    if before.tzinfo is None:
        raise ValueError("Recovery cutoff must include a timezone")
    async with sessions.begin() as db:
        rows = (
            await db.execute(
                select(UploadItem, UploadBatch.actor_id)
                .join(UploadBatch)
                .where(UploadItem.state == "sending", UploadItem.updated_at < before)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for item, actor_id in rows:
            await record_transition(db, item, actor_id, "unknown")
        return len(rows)
