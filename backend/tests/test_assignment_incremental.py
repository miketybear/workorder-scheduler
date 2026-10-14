import asyncio
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

from app.assignments.incremental import metadata, receipt_metadata, transaction_authority
from app.auth.sessions import SESSION_COOKIE
from app.scheduling.drafts import WorkOrderKey


class ScalarRows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


async def run_metadata_reuses_validation_snapshot_and_current_ledger(monkeypatch):
    pool, person, connection, actor = uuid4(), uuid4(), uuid4(), uuid4()
    key = WorkOrderKey(connection, "SITE", "100")
    day = SimpleNamespace(
        craft="E&I", laborcode="PERSON", date=date(2026, 10, 1), code="1", capacity_hours=10.5
    )
    local = SimpleNamespace(
        id=uuid4(),
        laborcode="PERSON",
        date=day.date,
        assignment_id="200",
        sync_state="local",
        minutes=300,
    )
    db = SimpleNamespace(
        scalars=AsyncMock(return_value=ScalarRows([local])), get=AsyncMock(return_value=day)
    )
    settings = SimpleNamespace(task_load_contract="bdsched_assignment_test")
    request = SimpleNamespace(
        state=SimpleNamespace(
            assignment_load_snapshots=[(connection, {"PERSON"}, day.date, date(2026, 10, 2), {})]
        ),
        app=SimpleNamespace(
            state=SimpleNamespace(settings=SimpleNamespace(assignment_summary_ttl_seconds=300))
        ),
    )
    monkeypatch.setattr(
        "app.assignments.incremental.transaction_authority",
        AsyncMock(return_value=(SimpleNamespace(user_id=actor), settings)),
    )
    monkeypatch.setattr(
        "app.assignments.incremental.authority",
        AsyncMock(return_value=(SimpleNamespace(user_id=actor), None, None, None)),
    )
    monkeypatch.setattr("app.assignments.incremental.revision", AsyncMock(return_value="revision"))
    monkeypatch.setattr(
        "app.assignments.incremental.planning_summary", AsyncMock(return_value={"state": "partial"})
    )
    remote = AsyncMock()
    monkeypatch.setattr("app.assignments.incremental.remote_load", remote)
    result = await metadata(request, db, settings, key, "E&I", pool, [(person, day.date)])
    assert result["affected_days"][0]["allocated_minutes"] == 300
    assert result["affected_days"][0]["remaining_minutes"] == 330
    assert result["affected_days"][0]["load_complete"] is True
    assert result["previous_assignment_revision"] == result["assignment_revision"] == "revision"
    remote.assert_not_awaited()


async def run_receipt_preserves_proof_and_requests_current_rows(monkeypatch):
    identity = uuid4()
    person = uuid4()
    result = {
        "items": [
            {"id": str(identity), "person_id": str(person), "date": "2026-10-01", "version": 1}
        ],
        "affected_days": [{"person_id": str(person), "date": "2026-09-30"}],
    }
    current = {
        "allocation_updates": [{"id": str(identity), "version": 2, "state": "released"}],
        "assignment_revision": "new",
        "affected_days": [],
    }
    loader = AsyncMock(return_value=current)
    monkeypatch.setattr("app.assignments.incremental.metadata", loader)
    refreshed = await receipt_metadata(None, None, None, None, "E&I", None, result)
    assert refreshed["items"] == result["items"]
    assert refreshed["allocation_updates"][0]["state"] == "released"
    assert loader.call_args.args[-1] == [identity]
    assert loader.call_args.kwargs["write"] is False
    assert loader.call_args.args[-2] == {(person, date(2026, 9, 30)), (person, date(2026, 10, 1))}


def test_metadata_reuses_validation_snapshot_and_current_ledger(monkeypatch):
    asyncio.run(run_metadata_reuses_validation_snapshot_and_current_ledger(monkeypatch))


def test_receipt_preserves_proof_and_requests_current_rows(monkeypatch):
    asyncio.run(run_receipt_preserves_proof_and_requests_current_rows(monkeypatch))


def test_auth_recheck_uses_existing_transaction_and_preserves_write_guards(monkeypatch):
    async def scenario():
        connection_id, pool_id, user_id = uuid4(), uuid4(), uuid4()
        key = WorkOrderKey(connection_id, "SITE", "100")
        identity = SimpleNamespace(user_id=user_id)
        settings = object()
        factory = Mock(side_effect=AssertionError("Nested authorization session is forbidden"))
        request = SimpleNamespace(
            cookies={SESSION_COOKIE: "session"},
            headers={"X-CSRF-Token": "csrf"},
            app=SimpleNamespace(state=SimpleNamespace(settings=settings, sessions=factory)),
        )
        db = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(enabled=True)))
        resolver = AsyncMock(return_value=identity)
        csrf = Mock()
        scope = AsyncMock()
        pool = SimpleNamespace(connection_id=connection_id)
        pool_check = AsyncMock(return_value=(identity, pool, None, None))
        configured = Mock(return_value=settings)
        monkeypatch.setattr("app.assignments.incremental.resolve_session", resolver)
        monkeypatch.setattr("app.assignments.incremental.verify_csrf", csrf)
        monkeypatch.setattr("app.assignments.incremental.require_scope", scope)
        monkeypatch.setattr("app.assignments.incremental.authority", pool_check)
        monkeypatch.setattr("app.assignments.incremental.configured_connection", configured)
        result = await transaction_authority(request, db, key, "E&I", pool_id, write=True)
        assert result == (identity, settings)
        factory.assert_not_called()
        assert resolver.call_args.args[0] is db
        csrf.assert_called_once_with(identity, "csrf")
        scope.assert_awaited_once_with(db, user_id, key, "E&I", write=True)
        pool_check.assert_awaited_once_with(db, request, pool_id, True)
        assert db.get.call_args.kwargs == {"populate_existing": True}

    asyncio.run(scenario())
