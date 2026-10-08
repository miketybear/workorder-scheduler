"""Saved-draft upload preparation and orchestration; no production transport is provided."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.audit.uploads import record_transition
from app.db.models import AuditEvent, Draft, UploadBatch, UploadItem, User
from app.scheduling.changes import ScheduleChanges, WorkOrderBaseline, build_changes
from app.scheduling.drafts import ReadCurrent, WorkOrderKey, require_scope
from app.scheduling.routes import digest, owned_draft


@dataclass(frozen=True)
class PreparedItem:
    member_id: UUID
    key: WorkOrderKey
    wonum: str
    discipline: str
    revision: str | None
    before: dict
    proposal: dict
    changes: dict
    code: str


@dataclass(frozen=True)
class PreparedUpload:
    draft_id: UUID
    version: int
    items: tuple[PreparedItem, ...]

    @property
    def preview_hash(self):
        # Includes source member IDs and snapshots; a hash is never a write revision.
        return digest(
            {
                "draft_id": str(self.draft_id),
                "version": self.version,
                "items": [{**source(item), "code": item.code} for item in self.items],
            }
        )


def source(item):
    return {
        "member_id": str(item.member_id),
        "connection_id": str(item.key.connection_id),
        "site_id": item.key.site_id,
        "workorder_id": item.key.workorder_id,
        "discipline": item.discipline,
        "revision": item.revision,
        "before": item.before,
        "proposal": item.proposal,
        "changes": item.changes,
    }


def member_hash(members):
    return digest(
        [
            {
                "id": str(member.id),
                "site_id": member.site_id,
                "workorder_id": member.workorder_id,
                "wonum": member.wonum,
                "discipline": member.discipline,
                "revision": member.upstream_revision,
                "before": member.baseline,
                "proposal": member.changes,
            }
            for member in sorted(members, key=lambda member: str(member.id))
        ]
    )


def validate_current(item, current):
    if current.key != item.key or current.discipline != item.discipline:
        raise HTTPException(404, "Work order not found")
    before = WorkOrderBaseline.model_validate(item.before)
    if current.baseline != before or current.revision != item.revision:
        return "conflict", {}
    try:
        changes = ScheduleChanges.model_validate(item.proposal)
        values = build_changes(current.baseline, changes, set(current.allowed_pics))
        # Serialize through Pydantic to preserve Decimal and aware datetime semantics.
        serialized = changes.model_dump(mode="json", exclude_unset=True)
        return ("ready" if values else "empty_changes"), {
            field: serialized[field] for field in values
        }
    except ValueError:
        return "invalid_changes", {}


async def prepare_upload(db, actor_id, draft_id, version, keys, read_current: ReadCurrent):
    draft, members = await owned_draft(db, actor_id, draft_id)
    if draft.version != version:
        raise HTTPException(409, "Draft changed; reopen before uploading")
    selected = {(key.site_id, key.workorder_id) for key in keys}
    if len(selected) != len(keys) or not 1 <= len(selected) <= 200:
        raise HTTPException(422, "Select 1 to 200 unique draft members")
    members = sorted(
        (item for item in members if (item.site_id, item.workorder_id) in selected),
        key=lambda item: (item.site_id, item.workorder_id),
    )
    if len(members) != len(selected):
        raise HTTPException(404, "Draft member not found")
    result = []
    for member in members:
        key = WorkOrderKey(draft.connection_id, member.site_id, member.workorder_id)
        await require_scope(db, actor_id, key, member.discipline, write=True)
        item = PreparedItem(
            member.id,
            key,
            member.wonum,
            member.discipline,
            member.upstream_revision,
            member.baseline,
            member.changes,
            {},
            "",
        )
        current = await read_current(key)
        await require_scope(db, actor_id, key, member.discipline, write=True)
        code, changes = validate_current(item, current)
        result.append(
            PreparedItem(
                item.member_id,
                key,
                item.wonum,
                item.discipline,
                item.revision,
                item.before,
                item.proposal,
                changes,
                code,
            )
        )
    return PreparedUpload(draft.id, version, tuple(result))


async def create_upload(sessions, actor_id, request_id, prepared, preview_hash):
    """Internal only. Commit immutable source evidence and local reservations before send."""
    if prepared.preview_hash != preview_hash or any(i.code != "ready" for i in prepared.items):
        raise HTTPException(409, "Preview changed or contains invalid items")
    try:
        async with sessions.begin() as db:
            # User -> draft -> upload lock order matches draft saves/permission changes.
            for item in prepared.items:
                await require_scope(db, actor_id, item.key, item.discipline, write=True)
            existing = await db.scalar(
                select(UploadBatch).where(
                    UploadBatch.actor_id == actor_id,
                    UploadBatch.idempotency_key == request_id,
                )
            )
            if existing:
                if existing.request_hash != preview_hash:
                    raise HTTPException(409, "Request ID already used for a different upload")
                return existing.id
            draft, members = await owned_draft(db, actor_id, prepared.draft_id, lock=True)
            by_id = {member.id: member for member in members}
            membership_hash = member_hash(members)
            if draft.version != prepared.version:
                raise HTTPException(409, "Draft changed; reopen before uploading")
            for item in prepared.items:
                member = by_id.get(item.member_id)
                if (
                    member is None
                    or draft.connection_id != item.key.connection_id
                    or member.site_id != item.key.site_id
                    or member.workorder_id != item.key.workorder_id
                    or member.discipline != item.discipline
                    or member.baseline != item.before
                    or member.changes != item.proposal
                    or member.upstream_revision != item.revision
                ):
                    raise HTTPException(409, "Draft changed; reopen before uploading")
            batch = UploadBatch(
                actor_id=actor_id,
                idempotency_key=request_id,
                request_hash=preview_hash,
            )
            db.add(batch)
            await db.flush()
            for item in prepared.items:
                upload = UploadItem(
                    batch_id=batch.id,
                    connection_id=item.key.connection_id,
                    site_id=item.key.site_id,
                    workorder_id=item.key.workorder_id,
                    wonum=item.wonum,
                    discipline=item.discipline,
                    upstream_revision=item.revision,
                    before=item.before,
                    changes=item.changes,
                )
                db.add(upload)
                await db.flush()
                db.add(
                    AuditEvent(
                        upload_item_id=upload.id,
                        actor_id=actor_id,
                        event="prepared",
                        details={
                            "draft_id": str(draft.id),
                            "draft_version": prepared.version,
                            "request_hash": preview_hash,
                            "membership_hash": membership_hash,
                            "full_selection": len(members) == len(prepared.items),
                            **source(item),
                        },
                    )
                )
            return batch.id
    except IntegrityError:
        # The database uniqueness constraint also catches concurrent reservations.
        raise HTTPException(409, "Work order already has an unresolved upload") from None


class ConditionalConflict(Exception):
    """The transport proves the conditional mutation was rejected without a write."""


class WriteRejected(Exception):
    """The transport proves the mutation was rejected without a write."""


class UncertainWrite(Exception):
    """The transport cannot prove whether the remote mutation happened."""


class ConditionalTransport(Protocol):
    async def write(self, key: WorkOrderKey, revision: str, changes: dict) -> None: ...


async def upload_item(db, actor_id, item_id):
    await db.scalar(select(User.id).where(User.id == actor_id).with_for_update())
    item = await db.scalar(
        select(UploadItem)
        .join(UploadBatch)
        .where(
            UploadItem.id == item_id,
            UploadBatch.actor_id == actor_id,
        )
        .with_for_update(of=UploadItem)
    )
    if item is None:
        raise HTTPException(404, "Upload not found")
    return item


async def immutable_item(db, item):
    key = WorkOrderKey(item.connection_id, item.site_id, item.workorder_id)
    prepared = await db.scalar(
        select(AuditEvent).where(
            AuditEvent.upload_item_id == item.id,
            AuditEvent.event == "prepared",
        )
    )
    if prepared is None:
        raise HTTPException(409, "Upload has no saved-draft source evidence")
    evidence = prepared.details
    expected = PreparedItem(
        UUID(evidence["member_id"]),
        key,
        item.wonum,
        item.discipline,
        evidence["revision"],
        evidence["before"],
        evidence["proposal"],
        evidence["changes"],
        "ready",
    )
    if (
        source(expected) != {field: evidence[field] for field in source(expected)}
        or item.before != expected.before
        or item.changes != expected.changes
        or item.upstream_revision != expected.revision
    ):
        raise HTTPException(409, "Upload intent changed")
    return expected


async def checked_item(db, actor_id, item, reader):
    key = WorkOrderKey(item.connection_id, item.site_id, item.workorder_id)
    await require_scope(db, actor_id, key, item.discipline, write=True)
    # This must be a raw configured read, never a route helper opening another user-locking
    # session. The injected reader must enforce current status/parent/task eligibility too.
    current = await reader(key)
    await require_scope(db, actor_id, key, item.discipline, write=True)
    expected = await immutable_item(db, item)
    code, changes = validate_current(expected, current)
    if code == "ready" and changes != item.changes:
        code = "conflict"
    return key, current, code


async def send_pending(
    sessions, actor_id, item_id, reader: ReadCurrent, transport: ConditionalTransport
):
    """Explicit internal orchestration; never resend sending/unknown/terminal items.

    No HTTP endpoint calls this function and the app has no concrete write transport.
    Cancellation/crash leaves sending, to be recovered as unknown by existing recovery.
    """
    async with sessions.begin() as db:
        item = await upload_item(db, actor_id, item_id)
        if item.state != "pending":
            return item.state
        _, current, code = await checked_item(db, actor_id, item, reader)
        if (
            code != "ready"
            or not current.revision
            or not current.revision.strip()
            or current.revision.strip() == "*"
        ):
            state = "conflict" if code == "conflict" else "failed"
            await record_transition(db, item, actor_id, state)
            return state
        await record_transition(db, item, actor_id, "sending")
    # Intent has committed before outbound I/O; keep this item locked through the call so
    # stale-send recovery cannot race the worker. A second check closes the commit gap.
    async with sessions.begin() as db:
        item = await upload_item(db, actor_id, item_id)
        if item.state != "sending":
            return item.state
        key, current, code = await checked_item(db, actor_id, item, reader)
        if code != "ready":
            await record_transition(db, item, actor_id, "conflict")
            return "conflict"
        try:
            await transport.write(key, current.revision, item.changes)
        except ConditionalConflict:
            state = "conflict"
        except WriteRejected:
            state = "failed"
        except (UncertainWrite, TimeoutError, OSError):
            state = "unknown"
        else:
            state = await readback_state(db, actor_id, item, reader)
        await record_transition(db, item, actor_id, state)
        return state


async def readback_state(db, actor_id, item, reader):
    from app.maximo.reader import MaximoReadError

    key = WorkOrderKey(item.connection_id, item.site_id, item.workorder_id)
    try:
        current = await reader(key)
        if current.key != key or current.discipline != item.discipline:
            return "unknown"
        await require_scope(db, actor_id, key, item.discipline, write=True)
        evidence = await immutable_item(db, item)
        expected = WorkOrderBaseline.model_validate({**evidence.before, **evidence.changes})
        # Compare normalized entire relevant baseline, including fields we did not write.
        return "confirmed" if current.baseline == expected else "unknown"
    except (MaximoReadError, HTTPException, TimeoutError, OSError):
        return "unknown"


async def reconcile_unknown(sessions, actor_id, item_id, reader: ReadCurrent):
    """Explicit read-only reconciliation; mismatch stays unknown and keeps its WO reserved."""
    async with sessions.begin() as db:
        item = await upload_item(db, actor_id, item_id)
        key = WorkOrderKey(item.connection_id, item.site_id, item.workorder_id)
        await require_scope(db, actor_id, key, item.discipline, write=True)
        if item.state != "unknown":
            return item.state
        state = await readback_state(db, actor_id, item, reader)
        if state == "confirmed":
            await record_transition(db, item, actor_id, state, reconciled=True)
        return state


async def finalize_confirmed(sessions, actor_id, batch_id, reader: ReadCurrent):
    """Explicit cleanup of an unchanged, fully selected, fully confirmed source only.

    Partial selection/outcomes or edits preserve the entire draft. No route/worker calls this
    yet. Reader has the same raw configured, current eligibility contract as send_pending.
    """
    async with sessions.begin() as db:
        await db.scalar(select(User.id).where(User.id == actor_id).with_for_update())
        batch = await db.scalar(
            select(UploadBatch).where(
                UploadBatch.id == batch_id,
                UploadBatch.actor_id == actor_id,
            )
        )
        if batch is None:
            raise HTTPException(404, "Upload not found")
        evidence = list(
            (
                await db.scalars(
                    select(AuditEvent)
                    .join(UploadItem)
                    .where(
                        UploadItem.batch_id == batch_id,
                        AuditEvent.event == "prepared",
                    )
                )
            ).all()
        )
        if not evidence or any(not event.details.get("full_selection") for event in evidence):
            return False
        first = evidence[0].details
        draft = await db.scalar(
            select(Draft)
            .where(
                Draft.id == UUID(first["draft_id"]),
                Draft.owner_id == actor_id,
            )
            .with_for_update()
        )
        if draft is None:
            return False
        draft, members = await owned_draft(db, actor_id, draft.id)
        if (
            draft.version != first["draft_version"]
            or member_hash(members) != first["membership_hash"]
        ):
            return False
        items = list(
            (
                await db.scalars(
                    select(UploadItem)
                    .where(
                        UploadItem.batch_id == batch_id,
                    )
                    .with_for_update()
                )
            ).all()
        )
        if (
            len(evidence) != len(items)
            or len(members) != len(items)
            or any(item.connection_id != draft.connection_id for item in items)
            or {str(member.id) for member in members}
            != {event.details["member_id"] for event in evidence}
            or any(item.state != "confirmed" for item in items)
            or any(
                event.details["draft_id"] != str(draft.id)
                or event.details["draft_version"] != draft.version
                or event.details["membership_hash"] != first["membership_hash"]
                or event.details["request_hash"] != batch.request_hash
                for event in evidence
            )
        ):
            return False
        for item in items:
            if await readback_state(db, actor_id, item, reader) != "confirmed":
                return False
        for item in items:
            db.add(
                AuditEvent(
                    upload_item_id=item.id,
                    actor_id=actor_id,
                    event="source_finalized",
                    details={"draft_id": str(draft.id), "draft_version": draft.version},
                )
            )
        await db.delete(draft)
        return True
