import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from test_maximo import config, record
from test_postgres import database, seed, snapshot
from test_upload_service import key, run

from app.audit.uploads import recover_stale_sends
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import (
    AccessGrant,
    AuditEvent,
    Base,
    Draft,
    DraftItem,
    MaximoConnection,
    UploadBatch,
    UploadItem,
)
from app.main import create_app
from app.maximo.detail import current_snapshot
from app.maximo.reader import WorkOrder
from app.scheduling.changes import ScheduleChanges, WorkOrderBaseline
from app.scheduling.drafts import WorkOrderKey, create_draft
from app.scheduling.upload_service import (
    ConditionalConflict,
    UncertainWrite,
    WriteRejected,
    create_upload,
    finalize_confirmed,
    prepare_upload,
    reconcile_unknown,
    send_pending,
)

pytestmark = pytest.mark.integration


class FakeTransport:
    """Synthetic conditional server; never opens a socket."""

    def __init__(self, current, mode="success"):
        self.current = current
        self.mode = mode
        self.calls = []

    async def read(self, key):
        assert key == self.current.key
        return self.current

    async def write(self, key, revision, changes):
        self.calls.append((key, revision, changes))
        if revision != self.current.revision or self.mode == "conflict":
            raise ConditionalConflict()
        if self.mode == "failed":
            raise WriteRejected()
        if self.mode == "cancel":
            raise asyncio.CancelledError()
        if self.mode in {"success", "timeout-after"}:
            self.current = replace(
                self.current,
                revision="v2",
                baseline=WorkOrderBaseline.model_validate(
                    {
                        **self.current.baseline.model_dump(mode="json"),
                        **changes,
                    }
                ),
            )
        if self.mode.startswith("timeout"):
            raise UncertainWrite()


async def batch_for(sessions, user, current, *, changes=None):
    async with sessions.begin() as db:
        draft = await create_draft(db, user.id, current, changes or ScheduleChanges(estdur=9))
    fake = FakeTransport(current)
    async with sessions.begin() as db:
        prepared = await prepare_upload(db, user.id, draft.id, 1, [key(current)], fake.read)
    request_id = uuid4()
    batch_id = await create_upload(sessions, user.id, request_id, prepared, prepared.preview_hash)
    async with sessions() as db:
        item_id = await db.scalar(select(UploadItem.id).where(UploadItem.batch_id == batch_id))
    return draft, prepared, request_id, batch_id, item_id, fake


@pytest.mark.parametrize(
    "mode,expected",
    [
        ("success", "confirmed"),
        ("conflict", "conflict"),
        ("failed", "failed"),
        ("timeout-before", "unknown"),
        ("timeout-after", "unknown"),
        ("mismatch", "unknown"),
    ],
)
def test_send_requires_durable_intent_and_readback_no_resend(mode, expected):
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            draft, prepared, request_id, batch_id, item_id, fake = await batch_for(
                sessions, user, snapshot(connections[0])
            )
            fake.mode = mode
            original_write = fake.write

            async def write(key, revision, changes):
                async with sessions() as db:
                    assert (
                        await db.scalar(select(UploadItem.state).where(UploadItem.id == item_id))
                        == "sending"
                    )
                    assert await db.scalar(
                        select(AuditEvent.id).where(
                            AuditEvent.upload_item_id == item_id, AuditEvent.event == "intent"
                        )
                    )
                await original_write(key, revision, changes)

            fake.write = write
            assert await send_pending(sessions, user.id, item_id, fake.read, fake) == expected
            assert len(fake.calls) == 1
            assert await send_pending(sessions, user.id, item_id, fake.read, fake) == expected
            assert len(fake.calls) == 1
            assert (
                await create_upload(sessions, user.id, request_id, prepared, prepared.preview_hash)
                == batch_id
            )
            async with sessions() as db:
                assert await db.get(Draft, draft.id) is not None  # Cleanup deliberately deferred.
                evidence = await db.scalar(
                    select(AuditEvent).where(
                        AuditEvent.upload_item_id == item_id, AuditEvent.event == "prepared"
                    )
                )
                assert evidence.details["draft_id"] == str(draft.id)
                assert evidence.details["draft_version"] == 1
                assert evidence.details["member_id"] == str(prepared.items[0].member_id)
                assert await db.scalar(select(func.count()).select_from(UploadBatch)) == 1
            if expected == "unknown":
                confirmed = mode == "timeout-after"
                assert await reconcile_unknown(sessions, user.id, item_id, fake.read) == (
                    "confirmed" if confirmed else "unknown"
                )
                assert len(fake.calls) == 1

    run(scenario())


@pytest.mark.parametrize(
    "case", ["baseline", "revision", "moved", "revoked", "pic", "tampered", "no-token", "wildcard"]
)
def test_preflight_changes_never_send(case):
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            current = snapshot(connections[0])
            if case in {"no-token", "wildcard"}:
                current = replace(current, revision=None if case == "no-token" else "*")
            changes = ScheduleChanges(assignedtechname="PIC") if case == "pic" else None
            _, _, _, _, item_id, fake = await batch_for(sessions, user, current, changes=changes)
            if case == "baseline":
                fake.current = replace(
                    current, baseline=WorkOrderBaseline(worktype="CM", estdur=10)
                )
            if case == "revision":
                fake.current = replace(current, revision="v2")
            if case == "moved":
                fake.current = replace(current, discipline="ELEC")
            if case == "pic":
                fake.current = replace(current, allowed_pics=frozenset())
            if case in {"revoked", "tampered"}:
                async with sessions.begin() as db:
                    if case == "revoked":
                        await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
                    else:
                        item = await db.get(UploadItem, item_id)
                        item.changes = {"estdur": "99"}
            if case in {"moved", "revoked", "tampered"}:
                with pytest.raises(HTTPException):
                    await send_pending(sessions, user.id, item_id, fake.read, fake)
            else:
                assert await send_pending(sessions, user.id, item_id, fake.read, fake) in {
                    "conflict",
                    "failed",
                }
            assert fake.calls == []

    run(scenario())


def test_active_reservation_source_version_and_idempotency():
    async def scenario():
        async with database() as sessions:
            user, other, connections = await seed(sessions)
            current = snapshot(connections[0])
            draft, prepared, request_id, batch_id, _, fake = await batch_for(
                sessions, user, current
            )
            with pytest.raises(HTTPException) as error:
                await create_upload(sessions, user.id, uuid4(), prepared, prepared.preview_hash)
            assert error.value.status_code == 409
            changed = replace(prepared, version=2)
            with pytest.raises(HTTPException):
                await create_upload(sessions, user.id, request_id, changed, changed.preview_hash)
            async with sessions.begin() as db:
                stored = await db.get(Draft, draft.id)
                stored.version += 1
            with pytest.raises(HTTPException):
                await create_upload(sessions, user.id, uuid4(), prepared, prepared.preview_hash)
            assert (
                await create_upload(sessions, user.id, request_id, prepared, prepared.preview_hash)
                == batch_id
            )
            async with sessions.begin() as db:
                with pytest.raises(HTTPException):
                    await prepare_upload(db, other.id, draft.id, 2, [key(current)], fake.read)

    run(scenario())


def test_cancelled_send_recovers_unknown_and_never_retries():
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            _, _, _, _, item_id, fake = await batch_for(sessions, user, snapshot(connections[0]))
            fake.mode = "cancel"
            with pytest.raises(asyncio.CancelledError):
                await send_pending(sessions, user.id, item_id, fake.read, fake)
            assert (
                await recover_stale_sends(sessions, datetime.now(UTC) + timedelta(seconds=1)) == 1
            )
            assert await send_pending(sessions, user.id, item_id, fake.read, fake) == "unknown"
            assert len(fake.calls) == 1

    run(scenario())


def test_upload_preview_submit_gate_and_scoped_status():
    async def scenario():
        async with database() as sessions:
            user, other, connections = await seed(sessions)
            current = current_snapshot(
                WorkOrderKey(connections[0].id, "TEST", "100"),
                WorkOrder.model_validate(record(bdpocdiscipline="MECH")),
                frozenset({"TECH"}),
            )
            draft, _, _, batch_id, _, _ = await batch_for(sessions, user, current)
            async with sessions.begin() as db:
                (
                    await db.get(MaximoConnection, connections[0].id)
                ).base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
                other_token, _ = await issue_session(db, other)
            settings = integration_settings()
            settings.maximo = {connections[0].id: config(crew_groups={"MECH": "CREW"})}
            app = create_app(settings)
            app.state.sessions = sessions
            moved = False
            closed = False
            requests = []

            def upstream(request):
                requests.append(request)
                assert request.method == "GET"
                if request.url.path.endswith("/mxpersongroup"):
                    if closed:
                        return httpx.Response(503)
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {"persongroup": "CREW", "persongroupteam": [{"respparty": "TECH"}]}
                            ]
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            record(
                                bdpocdiscipline="OTHER" if moved else "MECH",
                                status="CLOSE" if closed else "APPR",
                            )
                        ]
                    },
                )

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                body = {"version": 1, "items": [{"site_id": "TEST", "workorder_id": "100"}]}
                url = f"/api/drafts/{draft.id}"
                assert (await client.post(url + "/upload-preview", json=body)).status_code == 403
                preview = await client.post(
                    url + "/upload-preview", json=body, headers={"X-CSRF-Token": csrf}
                )
                assert preview.status_code == 200, preview.text
                assert preview.headers["Cache-Control"] == "no-store"
                assert preview.json()["items"][0]["changes"] == {"estdur": "9"}
                submit = await client.post(
                    url + "/uploads",
                    json={
                        **body,
                        "request_id": str(uuid4()),
                        "preview_hash": preview.json()["preview_hash"],
                    },
                    headers={"X-CSRF-Token": csrf},
                )
                assert submit.status_code == 409
                assert submit.json()["detail"]["code"] == "write_contract_unverified"
                assert submit.headers["Cache-Control"] == "no-store"
                response = await client.get(f"/api/uploads/{batch_id}")
                assert response.status_code == 200, response.text
                assert response.json()["counts"] == {"pending": 1}
                assert "before" not in response.text and "changes" not in response.text
                # Status survives closing the WO and failure of its configured crew endpoint.
                closed = True
                before = len(requests)
                response = await client.get(f"/api/uploads/{batch_id}")
                assert response.status_code == 200
                assert all(
                    not request.url.path.endswith("/mxpersongroup") for request in requests[before:]
                )
                client.cookies.set(SESSION_COOKIE, other_token)
                before = len(requests)
                assert (await client.get(f"/api/uploads/{batch_id}")).status_code == 404
                assert len(requests) == before
                client.cookies.set(SESSION_COOKIE, token)
                moved = True
                assert (await client.get(f"/api/uploads/{batch_id}")).status_code == 502
                async with sessions() as db:
                    assert await db.scalar(select(func.count()).select_from(UploadBatch)) == 1

    run(scenario())


@pytest.mark.parametrize(
    "case",
    [
        "success",
        "partial-selection",
        "partial-outcome",
        "draft-version",
        "member-changes",
        "moved",
        "revoked",
        "readback-mismatch",
    ],
)
def test_finalizer_only_removes_exact_complete_confirmed_source(case):
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            first = snapshot(connections[0])
            second = replace(first, key=replace(first.key, workorder_id="101"), wonum="WO101")
            fakes = {first.key: FakeTransport(first), second.key: FakeTransport(second)}
            async with sessions.begin() as db:
                draft = await create_draft(db, user.id, first, ScheduleChanges(estdur=9))
                member = DraftItem(
                    draft_id=draft.id,
                    site_id=second.key.site_id,
                    workorder_id=second.key.workorder_id,
                    wonum=second.wonum,
                    discipline=second.discipline,
                    upstream_revision=second.revision,
                    baseline=second.baseline.model_dump(mode="json"),
                    changes={"estdur": "9"},
                )
                db.add(member)

            async def reader(key):
                return await fakes[key].read(key)

            keys = [key(first)] if case == "partial-selection" else [key(first), key(second)]
            async with sessions.begin() as db:
                prepared = await prepare_upload(db, user.id, draft.id, 1, keys, reader)
            request_id = uuid4()
            batch_id = await create_upload(
                sessions, user.id, request_id, prepared, prepared.preview_hash
            )
            async with sessions() as db:
                items = list(
                    (
                        await db.scalars(select(UploadItem).where(UploadItem.batch_id == batch_id))
                    ).all()
                )
            for item in items:
                fake = fakes[WorkOrderKey(item.connection_id, item.site_id, item.workorder_id)]
                if case == "partial-outcome" and item.workorder_id == "101":
                    fake.mode = "timeout-before"
                await send_pending(sessions, user.id, item.id, reader, fake)
            if case in {"draft-version", "member-changes", "revoked"}:
                async with sessions.begin() as db:
                    if case == "draft-version":
                        (await db.get(Draft, draft.id)).version += 1
                    elif case == "member-changes":
                        (await db.get(DraftItem, member.id)).changes = {"estdur": "12"}
                    else:
                        await db.execute(delete(AccessGrant).where(AccessGrant.user_id == user.id))
            if case == "moved":
                fakes[first.key].current = replace(fakes[first.key].current, discipline="ELEC")
            if case == "readback-mismatch":
                fakes[first.key].current = replace(first, revision="v3")
            assert await finalize_confirmed(sessions, user.id, batch_id, reader) == (
                case == "success"
            )
            async with sessions() as db:
                assert (await db.get(Draft, draft.id) is None) == (case == "success")
                if case == "partial-outcome":
                    assert set(
                        (
                            await db.scalars(
                                select(UploadItem.state).where(UploadItem.batch_id == batch_id)
                            )
                        ).all()
                    ) == {"confirmed", "unknown"}
            if case == "success":
                # A durable replay survives deletion of its source; it never recreates the draft.
                assert (
                    await create_upload(
                        sessions, user.id, request_id, prepared, prepared.preview_hash
                    )
                    == batch_id
                )
                assert not await finalize_confirmed(sessions, user.id, batch_id, reader)

    run(scenario())


@asynccontextmanager
async def committed_database():
    # Real commits are necessary for concurrency/intent visibility. Audit cannot be deleted;
    # use only an exact UUID-named schema in the guarded synthetic database for cleanup.
    settings = integration_settings()
    schema = "p7_test_" + uuid4().hex
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        hide_parameters=True,
        connect_args={"connect_timeout": 3},
    )
    scoped = engine.execution_options(schema_translate_map={None: schema})
    try:
        async with engine.begin() as db:
            await db.execute(text(f'CREATE SCHEMA "{schema}"'))
        async with scoped.begin() as db:
            await db.run_sync(Base.metadata.create_all)
            await db.execute(
                text(
                    f"CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE "
                    f'OR TRUNCATE ON "{schema}".audit_event FOR EACH STATEMENT '
                    "EXECUTE FUNCTION public.reject_audit_mutation()"
                )
            )
        yield async_sessionmaker(scoped, expire_on_commit=False)
    finally:
        await scoped.dispose()
        async with engine.begin() as db:
            await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()


def test_concurrent_duplicate_reservation_and_send_have_real_commits():
    async def scenario():
        async with committed_database() as sessions:
            user, other, connections = await seed(sessions)
            current = snapshot(connections[0])
            fake = FakeTransport(current)
            async with sessions.begin() as db:
                draft = await create_draft(db, user.id, current, ScheduleChanges(estdur=9))
                db.add(
                    AccessGrant(
                        user_id=other.id,
                        connection_id=connections[0].id,
                        discipline="MECH",
                        capability="write",
                    )
                )
                other_draft = await create_draft(db, other.id, current, ScheduleChanges(estdur=10))
            async with sessions.begin() as db:
                prepared = await prepare_upload(db, user.id, draft.id, 1, [key(current)], fake.read)
                other_prepared = await prepare_upload(
                    db, other.id, other_draft.id, 1, [key(current)], fake.read
                )
            request_id = uuid4()
            batches = await asyncio.gather(
                *[
                    create_upload(sessions, user.id, request_id, prepared, prepared.preview_hash)
                    for _ in range(2)
                ]
            )
            assert batches[0] == batches[1]
            with pytest.raises(HTTPException) as error:
                await create_upload(
                    sessions, other.id, uuid4(), other_prepared, other_prepared.preview_hash
                )
            assert error.value.status_code == 409
            async with sessions() as db:
                item_id = await db.scalar(
                    select(UploadItem.id).where(UploadItem.batch_id == batches[0])
                )
                assert await db.scalar(select(func.count()).select_from(UploadBatch)) == 1
            original_write = fake.write

            async def write(key, revision, changes):
                # A different pooled connection observes committed intent before fake mutation.
                async with sessions() as db:
                    assert (
                        await db.scalar(select(UploadItem.state).where(UploadItem.id == item_id))
                        == "sending"
                    )
                    assert await db.scalar(
                        select(AuditEvent.id).where(
                            AuditEvent.upload_item_id == item_id, AuditEvent.event == "intent"
                        )
                    )
                await asyncio.sleep(0.05)
                await original_write(key, revision, changes)

            fake.write = write
            states = await asyncio.gather(
                *[send_pending(sessions, user.id, item_id, fake.read, fake) for _ in range(2)]
            )
            assert "confirmed" in states and set(states) <= {"sending", "confirmed"}
            assert len(fake.calls) == 1
            assert await finalize_confirmed(sessions, user.id, batches[0], fake.read)

    run(scenario())


def test_concurrent_overlapping_actors_reserve_only_one_wo():
    async def scenario():
        async with committed_database() as sessions:
            user, other, connections = await seed(sessions)
            current = snapshot(connections[0])
            fake = FakeTransport(current)
            async with sessions.begin() as db:
                db.add(
                    AccessGrant(
                        user_id=other.id,
                        connection_id=connections[0].id,
                        discipline="MECH",
                        capability="write",
                    )
                )
                first = await create_draft(db, user.id, current, ScheduleChanges(estdur=9))
                second = await create_draft(db, other.id, current, ScheduleChanges(estdur=10))
            async with sessions.begin() as db:
                p1 = await prepare_upload(db, user.id, first.id, 1, [key(current)], fake.read)
                p2 = await prepare_upload(db, other.id, second.id, 1, [key(current)], fake.read)
            results = await asyncio.gather(
                create_upload(sessions, user.id, uuid4(), p1, p1.preview_hash),
                create_upload(sessions, other.id, uuid4(), p2, p2.preview_hash),
                return_exceptions=True,
            )
            assert sum(isinstance(result, HTTPException) for result in results) == 1
            assert (
                next(result for result in results if isinstance(result, HTTPException)).status_code
                == 409
            )
            async with sessions() as db:
                assert await db.scalar(select(func.count()).select_from(UploadBatch)) == 1
                assert await db.scalar(select(func.count()).select_from(UploadItem)) == 1

    run(scenario())


def test_failed_intent_commit_prevents_transport_call():
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            _, _, _, _, item_id, fake = await batch_for(sessions, user, snapshot(connections[0]))

            class FailedCommit:
                @asynccontextmanager
                async def begin(self):
                    async with sessions.begin() as db:
                        yield db
                        raise RuntimeError("synthetic commit failure")

            with pytest.raises(RuntimeError, match="synthetic commit failure"):
                await send_pending(FailedCommit(), user.id, item_id, fake.read, fake)
            assert fake.calls == []
            async with sessions() as db:
                assert (
                    await db.scalar(select(UploadItem.state).where(UploadItem.id == item_id))
                    == "pending"
                )
                assert (
                    await db.scalar(
                        select(func.count())
                        .select_from(AuditEvent)
                        .where(AuditEvent.event == "intent")
                    )
                    == 0
                )

    run(scenario())


def test_readback_normalizes_offset_and_decimal():
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            current = replace(
                snapshot(connections[0]),
                baseline=WorkOrderBaseline(
                    worktype="CM",
                    estdur="8.00",
                    schedstart="2026-10-08T00:00:00+07:00",
                    schedfinish="2026-10-08T08:00:00+07:00",
                ),
            )
            _, _, _, _, item_id, fake = await batch_for(sessions, user, current)
            original_write = fake.write

            async def write(key, revision, changes):
                await original_write(key, revision, changes)
                fake.current = replace(
                    fake.current,
                    baseline=WorkOrderBaseline(
                        worktype="CM",
                        estdur="9.000",
                        schedstart="2026-10-07T17:00:00Z",
                        schedfinish="2026-10-08T01:00:00Z",
                    ),
                )

            fake.write = write
            assert await send_pending(sessions, user.id, item_id, fake.read, fake) == "confirmed"

    run(scenario())
