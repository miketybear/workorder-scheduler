import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, Draft, DraftItem, UploadBatch, UploadItem
from app.main import create_app
from app.maximo import home_routes
from app.maximo.home_routes import count_orders
from app.maximo.reader import MaximoReadError

NOW = datetime(2026, 11, 15, tzinfo=UTC)


def order(**fields):
    base = {
        "schedstart": NOW,
        "schedfinish": NOW,
        "assignedto": "TECH1",
        "targcompdate": NOW + timedelta(days=1),
        "actfinish": None,
    }
    return SimpleNamespace(**{**base, **fields})


def test_count_orders_counts_each_gap_independently():
    orders = [
        order(),
        order(schedfinish=None),
        order(assignedto=None, schedstart=None),
        order(targcompdate=NOW - timedelta(days=1)),
        order(targcompdate=NOW - timedelta(days=1), actfinish=NOW),
    ]
    assert count_orders(orders, NOW) == {
        "total": 5,
        "missing_schedule": 2,
        "missing_pic": 1,
        "overdue": 1,
    }


async def session_with_grant(sessions):
    user, _, connections = await seed(sessions)
    async with sessions.begin() as db:
        grant = await db.scalar(select(AccessGrant).where(AccessGrant.user_id == user.id))
        token, _ = await issue_session(db, user)
    return user, grant, token, connections


def params(grant, discipline=None):
    return {
        "connection_id": str(grant.connection_id),
        "discipline": discipline or grant.discipline,
        "target_from": "2026-11-01T00:00:00+07:00",
        "target_before": "2026-12-01T00:00:00+07:00",
    }


@pytest.mark.integration
@pytest.mark.parametrize("outcome", ["ok", "other-discipline", "anonymous", "maximo-down"])
def test_summary_is_scoped_and_counts_only_own_work(monkeypatch, outcome):
    async def scenario():
        async with database() as sessions:
            user, grant, token, connections = await session_with_grant(sessions)
            async with sessions.begin() as db:
                draft = Draft(owner_id=user.id, connection_id=grant.connection_id)
                batch = UploadBatch(
                    actor_id=user.id, idempotency_key=uuid4(), request_hash="a" * 64
                )
                db.add_all([draft, batch])
                await db.flush()
                db.add(
                    DraftItem(
                        draft_id=draft.id,
                        site_id="S",
                        workorder_id="1",
                        wonum="W1",
                        discipline=grant.discipline,
                        baseline={},
                        changes={},
                    )
                )
                for number, state in enumerate(["unknown", "confirmed"]):
                    db.add(
                        UploadItem(
                            batch_id=batch.id,
                            connection_id=grant.connection_id,
                            site_id="S",
                            workorder_id=str(number),
                            wonum=f"W{number}",
                            discipline=grant.discipline,
                            before={},
                            changes={},
                            state=state,
                        )
                    )

            async def read(client, settings, discipline, start, end):
                if outcome == "maximo-down":
                    raise MaximoReadError("Maximo is unavailable")
                return [order(), order(assignedto=None)]

            async def no_sync(request, token):
                return None

            monkeypatch.setattr(home_routes, "read_open_orders", read)
            monkeypatch.setattr(home_routes, "sync_person_access", no_sync)
            monkeypatch.setattr(home_routes, "configured_connection", lambda *args: None)
            settings = integration_settings()
            app = create_app(settings)
            app.state.sessions = sessions
            app.state.maximo_client_factory = httpx.AsyncClient
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                if outcome != "anonymous":
                    client.cookies.set(SESSION_COOKIE, token)
                discipline = "NOT-GRANTED" if outcome == "other-discipline" else None
                response = await client.get("/api/home/summary", params=params(grant, discipline))
            if outcome == "ok":
                body = response.json()
                assert response.status_code == 200, response.text
                assert response.headers["Cache-Control"] == "no-store"
                assert (body["total"], body["missing_pic"], body["missing_schedule"]) == (2, 1, 0)
                assert (body["drafts"], body["unresolved_uploads"]) == (1, 1)
                assert body["unresolved_routes"] == 0
            else:
                expected = {"other-discipline": 404, "anonymous": 401, "maximo-down": 502}
                assert response.status_code == expected[outcome], response.text

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
