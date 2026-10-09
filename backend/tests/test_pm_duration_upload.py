from dataclasses import replace
from decimal import Decimal

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from test_maximo import config, record
from test_postgres import database, seed, snapshot
from test_upload_postgres import batch_for, committed_database
from test_upload_service import prepared, run

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AuditEvent, Draft, MaximoConnection, UploadItem
from app.main import create_app
from app.scheduling.changes import ScheduleChanges, WorkOrderBaseline
from app.scheduling.upload_service import (
    UncertainWrite,
    finalize_confirmed,
    preview_warnings,
    reconcile_unknown,
    send_pending,
)


def scheduled(current, worktype="PM"):
    return replace(
        current,
        baseline=WorkOrderBaseline(
            worktype=worktype,
            estdur=25,
            schedstart="2026-10-30T06:30:00+07:00",
            schedfinish="2026-10-31T17:30:00+07:00",
        ),
    )


def test_preview_warning_requires_ready_pm_actual_schedule_change():
    from test_upload_service import current

    item = prepared(scheduled(current()))
    for changes in ({"schedstart": "date"}, {"schedfinish": "date", "estdur": "26"}):
        assert preview_warnings(replace(item, changes=changes)) == ["pm_duration_recalculation"]
    assert preview_warnings(item) == []
    assert preview_warnings(replace(item, changes={"schedstart": "date"}, code="conflict")) == []
    assert preview_warnings(replace(item, before={**item.before, "worktype": "CFT"})) == []


@pytest.mark.integration
@pytest.mark.parametrize(
    "case,expected",
    [
        ("derived", "confirmed"),
        ("explicit", "unknown"),
        ("explicit-noop", "confirmed"),
        ("timeout", "unknown"),
        ("other-field", "unknown"),
        ("CM", "unknown"),
        ("CFT", "unknown"),
        ("REC", "unknown"),
        ("negative", "unknown"),
        ("too-large", "unknown"),
        ("null", "unknown"),
        ("bad-status", "unknown"),
    ],
)
def test_pm_duration_classification_and_pinned_finalization(case, expected):
    async def scenario():
        async with committed_database() if case == "derived" else database() as sessions:
            user, other, connections = await seed(sessions)
            current = scheduled(
                snapshot(connections[0]), case if case in {"CM", "CFT", "REC"} else "PM"
            )
            changes = ScheduleChanges(schedstart="2026-10-30T07:37:13+07:00")
            if case == "explicit":
                changes = ScheduleChanges(schedstart=changes.schedstart, estdur=26)
            if case == "explicit-noop":
                changes = ScheduleChanges(schedstart=changes.schedstart, estdur=25)
            draft, _, _, batch_id, item_id, fake = await batch_for(
                sessions, user, current, changes=changes
            )
            original_write = fake.write
            fake.contract = "native_rowstamp_test"
            fake.outcome = None

            async def write(key, revision, payload):
                async with sessions() as db:
                    assert await db.scalar(
                        select(AuditEvent.id).where(
                            AuditEvent.upload_item_id == item_id, AuditEvent.event == "intent"
                        )
                    )
                await original_write(key, revision, payload)
                duration = {
                    "negative": Decimal(-1),
                    "too-large": Decimal(100001),
                    "null": None,
                }.get(case, Decimal(21))
                actual = fake.current.baseline.model_copy(update={"estdur": duration})
                if case == "other-field":
                    actual = actual.model_copy(update={"assignedtechname": "UNEXPECTED"})
                fake.current = replace(fake.current, baseline=actual)
                if case == "timeout":
                    raise UncertainWrite()
                fake.outcome = {"status": 201 if case == "bad-status" else 204}

            fake.write = write
            assert await send_pending(sessions, user.id, item_id, fake.read, fake) == expected
            assert len(fake.calls) == 1
            assert await reconcile_unknown(sessions, user.id, item_id, fake.read) == expected
            assert await send_pending(sessions, user.id, item_id, fake.read, fake) == expected
            assert len(fake.calls) == 1
            with pytest.raises(HTTPException):
                await reconcile_unknown(sessions, other.id, item_id, fake.read)
            async with sessions() as db:
                event = await db.scalar(
                    select(AuditEvent).where(
                        AuditEvent.upload_item_id == item_id,
                        AuditEvent.event == "pm_duration_result",
                    )
                )
                if case in {"timeout", "CM", "CFT", "REC", "bad-status"}:
                    assert event is None
                else:
                    assert event.actor_id == user.id
                    assert event.details["code"] == (
                        "pm_duration_recalculated"
                        if expected == "confirmed"
                        else "pm_duration_mismatch"
                    )
                    assert event.details["requested"]["estdur"] == (
                        "26" if case == "explicit" else "25"
                    )
                    assert event.details["observed_revision"] == "v2"
                    if case in {"negative", "too-large", "null"}:
                        assert event.details["actual"] is None
                item = await db.get(UploadItem, item_id)
                assert (item.state in {"pending", "sending", "unknown"}) == (expected == "unknown")
            if expected == "confirmed":
                pinned = fake.current
                fake.current = replace(
                    pinned, baseline=pinned.baseline.model_copy(update={"estdur": Decimal(22)})
                )
                assert not await finalize_confirmed(sessions, user.id, batch_id, fake.read)
                fake.current = pinned
                assert await finalize_confirmed(sessions, user.id, batch_id, fake.read)
                async with sessions() as db:
                    assert await db.get(Draft, draft.id) is None
            else:
                assert not await finalize_confirmed(sessions, user.id, batch_id, fake.read)
                async with sessions() as db:
                    assert await db.get(Draft, draft.id) is not None
                if case == "explicit":
                    fake.current = replace(
                        fake.current,
                        baseline=WorkOrderBaseline.model_validate(
                            {
                                **current.baseline.model_dump(mode="json"),
                                **fake.calls[0][2],
                            }
                        ),
                    )
                    assert (
                        await reconcile_unknown(sessions, user.id, item_id, fake.read)
                        == "confirmed"
                    )
                    assert await finalize_confirmed(sessions, user.id, batch_id, fake.read)
                    async with sessions() as db:
                        historical = await db.scalar(
                            select(AuditEvent).where(
                                AuditEvent.upload_item_id == item_id,
                                AuditEvent.event == "pm_duration_result",
                            )
                        )
                        assert historical.details["code"] == "pm_duration_mismatch"
                    async with sessions.begin() as db:
                        (
                            await db.get(MaximoConnection, connections[0].id)
                        ).base_url = "https://maximo.invalid/maximo"
                        token, _ = await issue_session(db, user)
                    settings = integration_settings()
                    settings.maximo = {connections[0].id: config(crew_groups={"MECH": "CREW"})}
                    app = create_app(settings)
                    app.state.sessions = sessions
                    app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                        transport=httpx.MockTransport(
                            lambda _: httpx.Response(
                                200,
                                json={"member": [record(bdpocdiscipline="MECH", worktype="PM")]},
                            )
                        )
                    )
                    async with httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=app), base_url="https://test.example"
                    ) as client:
                        client.cookies.set(SESSION_COOKIE, token)
                        response = await client.get(f"/api/uploads/{batch_id}")
                        assert response.status_code == 200, response.text
                        assert response.json()["items"][0]["duration_result"] is None
                        assert response.json()["source_finalized"] is True

    run(scenario())
