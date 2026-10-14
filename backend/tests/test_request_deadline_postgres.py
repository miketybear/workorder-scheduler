import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, AsyncSessionTransaction
from test_maximo import config, record
from test_postgres import seed
from test_upload_postgres import committed_database

from app.auth import person_access
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import (
    AccessGrant,
    AuthorizationEvent,
    Draft,
    DraftItem,
    DraftSubmission,
    MaximoConnection,
)
from app.main import create_app
from app.scheduling import routes

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("kind", ["single", "batch"])
@pytest.mark.parametrize("pause_at", ["sql", "transaction_exit"])
def test_deadline_rollback_receipts_and_restore_list_delete(monkeypatch, kind, pause_at):
    async def scenario():
        # Independent committed transactions in a UUID schema in scheduler_test.
        async with committed_database() as sessions:
            user, _, connections = await seed(sessions)
            async with sessions.begin() as db:
                (
                    await db.get(MaximoConnection, connections[0].id)
                ).base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
            settings = integration_settings()
            settings.read_draft_request_timeout_seconds = 1
            settings.maximo = {connections[0].id: config(crew_groups={"MECH": "CREW"})}
            app = create_app(settings)
            app.state.sessions = sessions

            def upstream(request):
                assert request.method == "GET"
                member = (
                    [{"persongroup": "CREW", "persongroupteam": [{"respparty": "TECH"}]}]
                    if request.url.path.endswith("mxpersongroup")
                    else [record(bdpocdiscipline="MECH")]
                )
                return httpx.Response(200, json={"member": member})

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"X-CSRF-Token": csrf}
                scope = {"connection_id": str(connections[0].id), "discipline": "MECH"}
                key = {**scope, "site_id": "TEST", "workorder_id": "100"}
                detail = await client.get("/api/work-orders/detail", params=key)
                assert detail.status_code == 200, detail.text
                edit = {
                    "site_id": "TEST",
                    "workorder_id": "100",
                    "baseline_token": detail.json()["baseline_token"],
                    "changes": {"estdur": "9"},
                }
                payload = {
                    **scope,
                    "request_id": str(uuid4()),
                    **(edit if kind == "single" else {"items": [edit]}),
                }
                endpoint = "/api/drafts" if kind == "single" else "/api/draft-batches"
                flushed = False
                original_flush = AsyncSession.flush
                original_exit = AsyncSessionTransaction.__aexit__
                pending_exits = 0

                async def slow_flush(db, *args, **kwargs):
                    nonlocal flushed
                    await original_flush(db, *args, **kwargs)
                    # Pause after draft item + receipt have been inserted, before commit.
                    if await db.scalar(select(func.count()).select_from(DraftItem)):
                        flushed = True
                        await db.execute(text("SELECT pg_sleep(10)"))

                async def slow_exit(transaction, exc_type, value, traceback):
                    nonlocal flushed, pending_exits
                    if exc_type is None:
                        flushed = True
                        pending_exits += 1
                        try:
                            # Reproduce a delayed commit context exit: no transaction
                            # worker may survive the timeout response and commit later.
                            await asyncio.sleep(2)
                        finally:
                            pending_exits -= 1
                    return await original_exit(transaction, exc_type, value, traceback)

                def patch_pause(patch):
                    if pause_at == "sql":
                        patch.setattr(AsyncSession, "flush", slow_flush)
                    else:
                        patch.setattr(AsyncSessionTransaction, "__aexit__", slow_exit)

                with monkeypatch.context() as patch:
                    patch_pause(patch)
                    response = await client.post(endpoint, json=payload, headers=headers)
                assert flushed
                assert pending_exits == 0
                assert not any(
                    "_AsyncSessionContextManager.__aexit__.<locals>.go"
                    in task.get_coro().__qualname__
                    for task in asyncio.all_tasks()
                )
                assert response.status_code == 504, response.text
                assert response.headers["Cache-Control"] == "no-store"
                async with sessions() as db:
                    for model in (Draft, DraftItem, DraftSubmission):
                        assert await db.scalar(select(func.count()).select_from(model)) == 0
                saved = await client.post(endpoint, json=payload, headers=headers)
                assert saved.status_code == 201, saved.text
                replay = await client.post(endpoint, json=payload, headers=headers)
                assert replay.json() == saved.json()
                async with sessions() as db:
                    for model in (Draft, DraftItem, DraftSubmission):
                        assert await db.scalar(select(func.count()).select_from(model)) == 1

                # Each local draft endpoint includes slow upstream rechecks in the
                # same outer budget and leaves an existing draft unchanged on timeout.
                url = "/api/drafts/" + saved.json()["draft_id"]
                update_payload = {**payload, "request_id": str(uuid4()), "version": 1}
                if kind == "single":
                    update_payload["changes"] = {"estdur": "10"}
                else:
                    update_payload["items"] = [{**edit, "changes": {"estdur": "10"}}]
                with monkeypatch.context() as patch:
                    patch_pause(patch)
                    response = await client.put(
                        endpoint + "/" + saved.json()["draft_id"],
                        json=update_payload,
                        headers=headers,
                    )
                assert response.status_code == 504, response.text
                assert pending_exits == 0
                async with sessions() as db:
                    draft = await db.scalar(select(Draft))
                    item = await db.scalar(select(DraftItem))
                    assert draft.version == 1
                    assert item.changes == {"estdur": "9"}
                    assert await db.scalar(select(func.count()).select_from(DraftSubmission)) == 1
                for operation in ("restore", "list", "delete"):
                    cancelled = False

                    async def slow_snapshot(*args, **kwargs):
                        nonlocal cancelled
                        try:
                            await asyncio.sleep(10)
                        finally:
                            cancelled = True

                    with monkeypatch.context() as patch:
                        patch.setattr(routes, "retrieve_snapshot", slow_snapshot)
                        if operation == "list":
                            from app.scheduling import draft_list

                            patch.setattr(draft_list, "fresh_page", slow_snapshot)
                        if operation == "delete":
                            response = await client.delete(
                                url, params={"version": 1}, headers=headers
                            )
                        elif operation == "list":
                            response = await client.get("/api/drafts", params=scope)
                        else:
                            response = await client.get(url)
                    assert response.status_code == 504, response.text
                    assert cancelled
                    restored = await client.get(url)
                    assert restored.status_code == 200, restored.text
                    assert restored.json()["version"] == 1
                    assert restored.json()["items"][0]["changes"] == {"estdur": "9"}

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_person_grant_commit_cannot_continue_after_deadline_response(monkeypatch):
    async def scenario():
        async with committed_database() as sessions:
            user, _, connections = await seed(sessions)
            async with sessions.begin() as db:
                token, _ = await issue_session(db, user)
            settings = integration_settings()
            settings.read_draft_request_timeout_seconds = 1
            settings.maximo = {connections[0].id: config(person_login_domain="company.example")}
            app = create_app(settings)
            app.state.sessions = sessions
            pending_exits = 0
            original_exit = AsyncSessionTransaction.__aexit__

            async def scope(*args):
                return "OTHER", "synthetic_person_discipline", False

            async def slow_exit(transaction, exc_type, value, traceback):
                nonlocal pending_exits
                if exc_type is None:
                    pending_exits += 1
                    try:
                        await asyncio.sleep(2)
                    finally:
                        pending_exits -= 1
                return await original_exit(transaction, exc_type, value, traceback)

            with monkeypatch.context() as patch:
                patch.setattr(person_access, "verified_person_scope", scope)
                patch.setattr(AsyncSessionTransaction, "__aexit__", slow_exit)
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="https://test.example"
                ) as client:
                    client.cookies.set(SESSION_COOKIE, token)
                    response = await client.get(
                        "/api/work-orders/detail",
                        params={
                            "connection_id": str(connections[0].id),
                            "discipline": "OTHER",
                            "site_id": "TEST",
                            "workorder_id": "100",
                        },
                    )
            assert response.status_code == 504, response.text
            assert pending_exits == 0
            assert not any(
                "_AsyncSessionContextManager.__aexit__.<locals>.go" in task.get_coro().__qualname__
                for task in asyncio.all_tasks()
            )
            async with sessions() as db:
                grant = await db.scalar(select(AccessGrant).where(AccessGrant.user_id == user.id))
                assert (grant.discipline, grant.capability) == ("MECH", "write")
                assert await db.scalar(select(func.count()).select_from(AuthorizationEvent)) == 0

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
