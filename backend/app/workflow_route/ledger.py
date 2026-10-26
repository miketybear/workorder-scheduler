"""Durable route attempts: the audit intent and the per-WO lock live in the same row."""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.db.models import Draft, DraftItem, UploadItem, WorkflowRouteAttempt

ACTIVE_STATES = ("pending", "sending")
TERMINAL_STATES = ("confirmed", "failed", "stranded", "unknown", "rejected")
UPDATABLE = {
    "wonum",
    "node_id",
    "wfassignment_id_before",
    "chosen_action_id",
    "state",
    "error_code",
    "wfassignment_id_after",
    "assigncode_after",
    "evidence",
}


class RouteBusy(Exception):
    """Another route is pending or sending for this work order."""


class RequestIdReused(Exception):
    """The request id already belongs to a different attempt."""


@dataclass
class Attempt:
    id: uuid.UUID
    request_id: uuid.UUID
    actor_user_id: uuid.UUID
    connection_id: uuid.UUID
    site_id: str
    workorder_id: str
    discipline: str
    process: str
    revision: int
    state: str = "pending"
    wonum: str | None = None
    node_id: int | None = None
    wfassignment_id_before: str | None = None
    chosen_action_id: int | None = None
    error_code: str | None = None
    wfassignment_id_after: str | None = None
    assigncode_after: str | None = None
    evidence: dict = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


def to_attempt(row: WorkflowRouteAttempt) -> Attempt:
    return Attempt(
        **{name: getattr(row, name) for name in Attempt.__dataclass_fields__},
    )


class PostgresLedger:
    def __init__(self, sessions):
        self.sessions = sessions

    async def insert(self, **fields) -> Attempt:
        """Commit one attempt row. The partial unique index serializes pending/sending per WO."""
        now = datetime.now(UTC)
        row = WorkflowRouteAttempt(
            id=uuid.uuid4(), evidence={}, created_at=now, updated_at=now, **fields
        )
        try:
            async with self.sessions.begin() as db:
                db.add(row)
                await db.flush()
                created = to_attempt(row)
        except IntegrityError as error:
            constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
            if constraint == "uq_route_request_wo":
                raise RequestIdReused() from None
            if constraint == "uq_active_route_wo":
                raise RouteBusy() from None
            raise
        return created

    async def reserve(self, **fields) -> Attempt:
        return await self.insert(state="pending", **fields)

    async def reject(self, code: str, **fields) -> Attempt:
        return await self.insert(state="rejected", error_code=code, **fields)

    async def update(self, attempt_id, allowed_from: tuple[str, ...], **fields):
        """Compare-and-set a transition; the new timestamp, or None when the state changed."""
        if set(fields) - UPDATABLE:
            raise ValueError("Unsupported route attempt column")
        now = datetime.now(UTC)
        async with self.sessions.begin() as db:
            result = await db.execute(
                update(WorkflowRouteAttempt)
                .where(
                    WorkflowRouteAttempt.id == attempt_id,
                    WorkflowRouteAttempt.state.in_(allowed_from),
                )
                .values(**fields, updated_at=now)
            )
            return now if result.rowcount == 1 else None

    async def for_request(self, actor_user_id, request_id) -> list[Attempt]:
        async with self.sessions() as db:
            rows = await db.scalars(
                select(WorkflowRouteAttempt)
                .where(
                    WorkflowRouteAttempt.actor_user_id == actor_user_id,
                    WorkflowRouteAttempt.request_id == request_id,
                )
                .order_by(WorkflowRouteAttempt.created_at, WorkflowRouteAttempt.id)
            )
            return [to_attempt(row) for row in rows]

    async def unsynced(self, actor_user_id, connection_id, site_id, workorder_id) -> bool:
        """An unsent draft of this user, or any upload still in flight, for this exact WO."""
        async with self.sessions() as db:
            draft = await db.scalar(
                select(DraftItem.id)
                .join(Draft, Draft.id == DraftItem.draft_id)
                .where(
                    Draft.owner_id == actor_user_id,
                    Draft.connection_id == connection_id,
                    DraftItem.site_id == site_id,
                    DraftItem.workorder_id == workorder_id,
                )
                .limit(1)
            )
            upload = await db.scalar(
                select(UploadItem.id)
                .where(
                    UploadItem.connection_id == connection_id,
                    UploadItem.site_id == site_id,
                    UploadItem.workorder_id == workorder_id,
                    UploadItem.state.in_(["pending", "sending", "unknown"]),
                )
                .limit(1)
            )
        return draft is not None or upload is not None
