"""BD_WO route API over a real PostgreSQL ledger and a mocked Maximo (no network)."""

import asyncio
import logging
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
import pytest
from route_fakes import MAXAUTH, PASSWORD, ROOT, SECRETS, FakeMaximo, good_process, route_config
from sqlalchemy import select
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import (
    AccessGrant,
    Draft,
    DraftItem,
    MaximoConnection,
    UploadBatch,
    UploadItem,
    WorkflowRouteAttempt,
)
from app.main import create_app
from app.workflow_route.credentials import LoginLimiter
from app.workflow_route.ledger import PostgresLedger, RequestIdReused, RouteBusy

pytestmark = pytest.mark.integration


@asynccontextmanager
async def environment(*, capability="write", discipline="E&I", fake=None):
    fake = fake or FakeMaximo()
    async with database() as sessions:
        user, _, connections = await seed(sessions)
        async with sessions.begin() as db:
            (await db.get(MaximoConnection, connections[0].id)).base_url = ROOT
            grant = await db.scalar(select(AccessGrant).where(AccessGrant.user_id == user.id))
            grant.discipline, grant.capability = discipline, capability
            token, csrf = await issue_session(db, user)
        settings = integration_settings()
        settings.maximo = {connections[0].id: route_config()}
        app = create_app(settings)
        app.state.sessions = sessions
        app.state.maximo_client_factory = fake.client
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://test.example"
        ) as client:
            client.cookies.set(SESSION_COOKIE, token)
            client.headers["X-CSRF-Token"] = csrf
            yield SimpleEnv(client, app, fake, sessions, connections[0].id, user)


class SimpleEnv:
    def __init__(self, client, app, fake, sessions, connection_id, user):
        self.client, self.app, self.fake, self.sessions = client, app, fake, sessions
        self.connection_id, self.user = connection_id, user
        self.responses = []

    @property
    def scope(self):
        return {"connection_id": str(self.connection_id), "discipline": "E&I"}

    async def post(self, path, body, **kwargs):
        response = await self.client.post("/api/workflow" + path, json=body, **kwargs)
        self.responses.append(response.text)
        return response

    async def login(self, password=PASSWORD, username="enisup"):
        return await self.post(
            "/route/session", {**self.scope, "username": username, "password": password}
        )

    def preview_body(self, workorders=("100",)):
        body = self.route_body(workorders)
        body.pop("request_id")
        return body

    def route_body(self, workorders=("100",), request_id=None):
        return {
            **self.scope,
            "request_id": str(request_id or uuid4()),
            "items": [{"site_id": "TEST", "workorder_id": wo} for wo in workorders],
        }


def run(coroutine):
    return asyncio.run(coroutine, loop_factory=asyncio.SelectorEventLoop)


def test_login_session_status_limits_and_logout(caplog):
    caplog.set_level(logging.DEBUG)

    async def scenario():
        async with environment() as env:
            client = env.client
            status = await client.get("/api/workflow/route/status", params=env.scope)
            assert status.json() == {
                "enabled": True,
                "can_route": True,
                "personid": "ENISUP",
                "session": {"active": False, "expires_at": None},
            }
            assert status.headers["Cache-Control"] == "no-store"
            no_csrf = await client.post(
                "/api/workflow/route/session",
                json={**env.scope, "username": "ENISUP", "password": PASSWORD},
                headers={"X-CSRF-Token": "x" * 43},
            )
            assert no_csrf.status_code == 403
            mismatch = await env.login(username="MECHSUP")
            assert (mismatch.status_code, mismatch.json()["detail"]["code"]) == (
                422,
                "username_mismatch",
            )
            assert env.fake.of("whoami") == []  # nothing is sent for a wrong account name
            invalid = await client.post("/api/workflow/route/session", json={"password": PASSWORD})
            assert invalid.status_code == 422 and PASSWORD not in invalid.text
            wrong = await env.login(password="wrong-Pass-1")
            assert wrong.status_code == 422
            assert wrong.json()["detail"] == {
                "code": "maximo_login_failed",
                "remaining_attempts": 2,
            }
            assert "wrong-Pass-1" not in wrong.text
            await env.login(password="wrong-Pass-2")
            await env.login(password="wrong-Pass-3")
            limited = await env.login(password=PASSWORD)  # even the right password waits
            assert limited.status_code == 429
            assert limited.json()["detail"]["code"] == "login_rate_limited"
            assert int(limited.headers["Retry-After"]) > 0
            assert len(env.fake.of("whoami")) == 3
            env.app.state.workflow_route_limiter = LoginLimiter()
            ok = await env.login()
            assert ok.status_code == 200 and ok.json()["personid"] == "ENISUP", ok.text
            assert ok.json()["session"]["active"]
            assert all(MAXAUTH not in text and PASSWORD not in text for text in env.responses)
            assert len(env.app.state.workflow_route_credentials) == 1
            status = await client.get("/api/workflow/route/status", params=env.scope)
            assert status.json()["session"]["active"]
            other = await client.get(
                "/api/workflow/route/status",
                params={**env.scope, "discipline": "MECH"},
            )
            assert other.status_code == 404  # no grant for this discipline
            assert (
                await client.delete("/api/workflow/route/session", params=env.scope)
            ).status_code == 204
            assert not env.app.state.workflow_route_credentials._items
            await env.login()
            assert len(env.app.state.workflow_route_credentials) == 1
            assert (await client.post("/api/auth/logout")).status_code == 204
            assert len(env.app.state.workflow_route_credentials) == 0
        for secret in SECRETS:
            assert secret not in caplog.text

    run(scenario())


def test_viewer_without_write_cannot_log_in_preview_or_route():
    async def scenario():
        async with environment(capability="read") as env:
            status = await env.client.get("/api/workflow/route/status", params=env.scope)
            assert status.json()["can_route"] is False and status.json()["personid"] is None
            for path, body in (
                ("/route/session", {**env.scope, "username": "ENISUP", "password": PASSWORD}),
                ("/route/preview", env.preview_body()),
                ("/route", env.route_body()),
            ):
                response = await env.post(path, body)
                assert response.status_code == 404, (path, response.text)
            assert env.fake.calls == []

    run(scenario())


def test_route_requires_a_session_then_routes_once_and_replays():
    async def scenario():
        async with environment() as env:
            body = env.route_body()
            blocked = await env.post("/route", body)
            assert (blocked.status_code, blocked.json()["detail"]["code"]) == (
                409,
                "route_session_required",
            )
            assert env.fake.writes == []
            await env.login()
            routed = await env.post("/route", body)
            assert routed.status_code == 200, routed.text
            payload = routed.json()
            assert payload["complete"] is True and payload["counts"] == {"confirmed": 1}
            item = payload["items"][0]
            assert (item["state"], item["code"], item["assigned_to"]) == (
                "confirmed",
                None,
                "TECH1",
            )
            assert item["wonum"] == "PM-100" and item["wfassignment_id_after"] == "901"
            assert len(env.fake.of("complete")) == len(env.fake.of("choose")) == 1
            replay = await env.post("/route", body)
            assert replay.status_code == 200 and replay.json()["items"] == payload["items"]
            assert len(env.fake.of("complete")) == 1
            extra = await env.post("/route", env.route_body(["100", "101"], body["request_id"]))
            assert [(i["workorder_id"], i["state"]) for i in extra.json()["items"]] == [
                ("100", "confirmed"),
                ("101", "not_attempted"),
            ] and extra.json()["complete"] is False
            different = await env.post("/route", env.route_body(["101"], body["request_id"]))
            assert different.json()["detail"]["code"] == "request_id_conflict"
            assert len(env.fake.of("complete")) == 1
            receipt = await env.client.get(f"/api/workflow/route-submissions/{body['request_id']}")
            assert receipt.json()["items"] == payload["items"]
            missing = await env.client.get(f"/api/workflow/route-submissions/{uuid4()}")
            assert missing.status_code == 404
            async with env.sessions() as db:
                rows = list(await db.scalars(select(WorkflowRouteAttempt)))
            assert [(r.state, r.actor_user_id, r.node_id) for r in rows] == [
                ("confirmed", env.user.id, 40)
            ]
            assert rows[0].chosen_action_id == 437 and rows[0].evidence["complete_status"] == 200
            assert all(MAXAUTH not in text and PASSWORD not in text for text in env.responses)
            assert PASSWORD not in repr(rows[0].evidence)

    run(scenario())


def test_contract_drift_refuses_routing_with_409():
    async def scenario():
        async with environment() as env:
            await env.login()
            process = good_process()
            process["wfnode"][2]["wfassignment"][0]["condition"] = ":&APPNAME&='PLUSGWO'"
            env.fake.process = process
            blocked = await env.post("/route", env.route_body())
            assert blocked.status_code == 409
            assert blocked.json()["detail"] == {
                "code": "workflow_contract_changed",
                "problem": "node_34_condition_present",
            }
            assert env.fake.writes == []
            preview = await env.post("/route/preview", env.preview_body())
            assert preview.json()["contract"] == {
                "ok": False,
                "problem": "node_34_condition_present",
            }
            assert preview.json()["items"][0]["code"] == "contract_changed"

    run(scenario())


def test_preview_is_read_only_and_hides_out_of_scope_work_orders():
    async def scenario():
        async with environment() as env:
            preview = await env.post("/route/preview", env.preview_body(["100", "999"]))
            assert preview.status_code == 200
            ready, hidden = preview.json()["items"]
            assert (ready["ready"], ready["code"], ready["node_id"]) == (True, "ready", 40)
            assert ready["supervisor"] == {"current": "SUP1", "will_set": None}
            assert (hidden["ready"], hidden["code"], hidden["wonum"]) == (
                False,
                "out_of_scope",
                None,
            )
            assert env.fake.writes == [] and env.fake.of("whoami") == []
            env.fake.wo["bdpocdiscipline"] = "MECH"
            moved = await env.post("/route/preview", env.preview_body(["100"]))
            assert moved.json()["items"][0] == {**hidden, "workorder_id": "100"}
            async with env.sessions() as db:
                assert list(await db.scalars(select(WorkflowRouteAttempt))) == []

    run(scenario())


def test_one_route_in_flight_per_position_account():
    async def scenario():
        async with environment() as env:
            await env.login()
            entered, release = asyncio.Event(), asyncio.Event()

            async def hold():
                entered.set()
                await release.wait()

            env.fake.on_complete = hold
            first = asyncio.create_task(env.post("/route", env.route_body(["100"])))
            await asyncio.wait_for(entered.wait(), 5)
            second = await env.post("/route", env.route_body(["101"]))
            assert (second.status_code, second.json()["detail"]["code"]) == (
                409,
                "route_account_busy",
            )
            release.set()
            assert (await first).json()["counts"] == {"confirmed": 1}
            assert len(env.fake.of("complete")) == 1

    run(scenario())


def test_reconcile_resolves_an_unknown_attempt_by_reading_only():
    async def scenario():
        fake = FakeMaximo()
        fake.choose_error = httpx.ReadTimeout("slow")
        async with environment(fake=fake) as env:
            await env.login()
            body = env.route_body()
            routed = await env.post("/route", body)
            assert routed.json()["items"][0]["state"] == "unknown"
            assert len(fake.of("choose")) == 1
            # The late choice lands in Maximo; the user asks for a re-check, never a resend.
            fake.assignments.append(
                {
                    "wfassignmentid": "901",
                    "processname": "BD_WO",
                    "processrev": 27,
                    "nodeid": 34,
                    "assignstatus": "ACTIVE",
                    "assigncode": "TECH1",
                }
            )
            fresh = await env.post(f"/route-submissions/{body['request_id']}/reconcile", {})
            assert fresh.status_code == 200, fresh.text
            assert fresh.json()["items"][0]["state"] == "confirmed"
            assert len(fake.of("choose")) == 1 and len(fake.of("complete")) == 1

    run(scenario())


def test_ledger_enforces_the_work_order_lock_and_request_idempotency():
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            ledger = PostgresLedger(sessions)
            identity = {
                "actor_user_id": user.id,
                "connection_id": connections[0].id,
                "site_id": "TEST",
                "workorder_id": "100",
                "discipline": "E&I",
                "process": "BD_WO",
                "revision": 27,
            }
            first = await ledger.reserve(request_id=uuid4(), wonum="W", **identity)
            with pytest.raises(RouteBusy):
                await ledger.reserve(request_id=uuid4(), **identity)
            other_wo = {**identity, "workorder_id": "101"}
            assert await ledger.reserve(request_id=uuid4(), **other_wo)  # per-WO, not global
            assert await ledger.update(first.id, ("pending",), state="sending", node_id=40)
            with pytest.raises(RouteBusy):
                await ledger.reserve(request_id=uuid4(), **identity)
            assert not await ledger.update(first.id, ("pending",), state="failed")
            assert await ledger.update(first.id, ("sending",), state="unknown", error_code="x")
            second = await ledger.reserve(request_id=uuid4(), **identity)  # lock released
            rejected = await ledger.reject("status_not_routable", request_id=uuid4(), **identity)
            assert rejected.state == "rejected" and rejected.error_code == "status_not_routable"
            with pytest.raises(RequestIdReused):
                await ledger.reject("x", request_id=second.request_id, **identity)
            with pytest.raises(ValueError):
                await ledger.update(second.id, ("pending",), actor_user_id=uuid4())
            rows = await ledger.for_request(user.id, first.request_id)
            assert [(r.state, r.node_id, r.error_code) for r in rows] == [("unknown", 40, "x")]
            assert await ledger.for_request(uuid4(), first.request_id) == []

    run(scenario())


@pytest.mark.parametrize(
    "has_draft,upload_state,expected",
    [
        (False, None, "ready"),
        (True, None, "not_synced"),
        *[
            (draft, state, "upload_pending")
            for draft in (False, True)
            for state in ("pending", "sending", "unknown")
        ],
        *[(False, state, "ready") for state in ("confirmed", "failed", "conflict")],
    ],
)
def test_preview_and_route_distinguish_draft_from_unresolved_upload(
    has_draft, upload_state, expected
):
    async def scenario():
        async with environment() as env:
            async with env.sessions.begin() as db:
                if has_draft:
                    draft = Draft(owner_id=env.user.id, connection_id=env.connection_id)
                    db.add(draft)
                    await db.flush()
                    db.add(
                        DraftItem(
                            draft_id=draft.id,
                            site_id="TEST",
                            workorder_id="100",
                            wonum="PM-100",
                            discipline="E&I",
                            baseline={},
                            changes={},
                        )
                    )
                if upload_state:
                    batch = UploadBatch(
                        actor_id=env.user.id, idempotency_key=uuid4(), request_hash="a" * 64
                    )
                    db.add(batch)
                    await db.flush()
                    db.add(
                        UploadItem(
                            batch_id=batch.id,
                            connection_id=env.connection_id,
                            site_id="TEST",
                            workorder_id="100",
                            wonum="PM-100",
                            discipline="E&I",
                            before={},
                            changes={},
                            state=upload_state,
                        )
                    )
            ledger = PostgresLedger(env.sessions)
            code = await ledger.unsynced(env.user.id, env.connection_id, "TEST", "100")
            assert code == (None if expected == "ready" else expected)
            # Only the actor's own draft blocks, but unresolved uploads block every actor.
            other_code = await ledger.unsynced(uuid4(), env.connection_id, "TEST", "100")
            assert other_code == ("upload_pending" if expected == "upload_pending" else None)
            assert await ledger.unsynced(env.user.id, env.connection_id, "OTHER", "100") is None
            assert await ledger.unsynced(env.user.id, uuid4(), "TEST", "100") is None
            assert await ledger.unsynced(env.user.id, env.connection_id, "TEST", "101") is None
            response = await env.post("/route/preview", env.preview_body())
            assert response.status_code == 200, response.text
            item = response.json()["items"][0]
            assert (item["code"], item["ready"]) == (expected, expected == "ready")
            if expected != "ready":
                await env.login()
                blocked = await env.post("/route", env.route_body())
                assert blocked.status_code == 200, blocked.text
                result = blocked.json()["items"][0]
                assert (result["state"], result["code"]) == ("rejected", expected)
                assert env.fake.writes == []

    run(scenario())
