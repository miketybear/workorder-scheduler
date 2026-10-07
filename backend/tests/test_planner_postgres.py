import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.person_access import replace_person_grants
from app.auth.planner import PlannerChange, change_planner
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import (
    AccessGrant,
    AuthorizationEvent,
    LoginSession,
    MaximoConnection,
    PlannerPermission,
    User,
)
from app.main import create_app

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "case", ["lifecycle", "revoked", "person-moved", "expired", "baseline", "pm", "cft"]
)
def test_person_planner_draft_api(case):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            connection = connections[0]
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {
                connection.id: config(
                    person_login_domain="biendongpoc.vn", crew_groups={"MECH": "CREW"}
                )
            }
            change = PlannerChange(
                user_id=user.id,
                connection_id=connection.id,
                discipline="MECH",
                enabled=True,
                reason="Draft test",
            )
            async with sessions.begin() as db:
                stored = await db.get(User, user.id)
                stored.login_name = "planner@biendongpoc.vn"
                (
                    await db.get(MaximoConnection, connection.id)
                ).base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, stored)
                await change_planner(db, settings, admin.id, change)
            discipline = "MECH"
            saving = False
            app = create_app(settings)
            app.state.sessions = sessions

            async def upstream(request):
                nonlocal discipline
                assert request.method == "GET"
                if request.url.path.endswith("mxperson"):
                    member = [{"personid": "PLANNER", "ct_discipline": discipline}]
                elif request.url.path.endswith("mxpersongroup"):
                    member = [{"persongroup": "CREW", "persongroupteam": [{"respparty": "TECH"}]}]
                else:
                    member = [
                        record(
                            bdpocdiscipline="MECH",
                            worktype=case.upper() if case in {"pm", "cft"} else "CM",
                            estdur=10 if saving and case == "baseline" else 8,
                        )
                    ]
                    if saving and case == "revoked":
                        async with sessions.begin() as db:
                            await change_planner(
                                db, settings, admin.id, change.model_copy(update={"enabled": False})
                            )
                    if saving and case == "person-moved":
                        discipline = "E&I"
                    if saving and case == "expired":
                        async with sessions.begin() as db:
                            session = await db.scalar(
                                select(LoginSession).where(LoginSession.user_id == user.id)
                            )
                            session.created_at = datetime.now(UTC) - timedelta(hours=9)
                            session.expires_at = datetime.now(UTC) - timedelta(hours=1)
                return httpx.Response(200, json={"member": member})

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"X-CSRF-Token": csrf}
                key = dict(
                    connection_id=str(connection.id),
                    discipline="MECH",
                    site_id="TEST",
                    workorder_id="100",
                )
                detail = await client.get("/api/work-orders/detail", params=key)
                assert detail.status_code == 200
                payload = {
                    **key,
                    "baseline_token": detail.json()["baseline_token"],
                    "request_id": str(uuid4()),
                    "changes": {"estdur": "9", "assignedtechname": "TECH"},
                }
                if case in {"pm", "cft"}:
                    payload["changes"].update(
                        change_target=True, targcompdate="2026-10-02T00:00:00+07:00"
                    )
                saving = True
                response = await client.post("/api/drafts", json=payload, headers=headers)
                assert (
                    response.status_code
                    == {
                        "lifecycle": 201,
                        "revoked": 404,
                        "person-moved": 404,
                        "expired": 401,
                        "baseline": 409,
                        "pm": 422,
                        "cft": 422,
                    }[case]
                ), response.text
                if case != "lifecycle":
                    return
                url = "/api/drafts/" + response.json()["draft_id"]
                assert (await client.get(url)).json()["items"][0]["changes"]["estdur"] == "9"
                updated = {
                    **payload,
                    "version": 1,
                    "request_id": str(uuid4()),
                    "changes": {"estdur": "10"},
                }
                assert (await client.put(url, json=updated, headers=headers)).json()["version"] == 2
                assert (
                    await client.delete(url, params={"version": 2}, headers=headers)
                ).status_code == 204
                assert (await client.get(url)).status_code == 404

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_planner_intersects_scope_and_revocation_is_durable():
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            connection = connections[0]
            settings = integration_settings()
            settings.maximo = {connection.id: config(person_login_domain="biendongpoc.vn")}
            change = PlannerChange(
                user_id=user.id,
                connection_id=connection.id,
                discipline="MECH",
                enabled=True,
                reason="Approved test",
            )
            async with sessions.begin() as db:
                await replace_person_grants(db, user.id, connection.id, "MECH", "test")
                assert await change_planner(db, settings, admin.id, change)
                assert not await change_planner(db, settings, admin.id, change)
                grant = await db.scalar(select(AccessGrant).where(AccessGrant.user_id == user.id))
                assert grant.capability == "read"
            for discipline, capability in [
                ("MECH", "write"),
                ("E&I", "read"),
                (None, None),
                ("MECH", "write"),
            ]:
                async with sessions.begin() as db:
                    await replace_person_grants(db, user.id, connection.id, discipline, "test")
                async with sessions() as db:
                    grants = list(
                        await db.scalars(
                            select(AccessGrant).where(
                                AccessGrant.user_id == user.id,
                                AccessGrant.connection_id == connection.id,
                            )
                        )
                    )
                    assert [(g.discipline, g.capability) for g in grants] == (
                        [(discipline, capability)] if discipline else []
                    )
                    assert (
                        await db.get(PlannerPermission, (user.id, connections[1].id, "MECH"))
                        is None
                    )
            async with sessions.begin() as db:
                await change_planner(
                    db, settings, admin.id, change.model_copy(update={"enabled": False})
                )
                grant = await db.scalar(select(AccessGrant).where(AccessGrant.user_id == user.id))
                assert grant.capability == "read"
                await replace_person_grants(db, user.id, connection.id, "MECH", "test")
                assert grant.capability == "read"
                events = list(
                    await db.scalars(
                        select(AuthorizationEvent).where(
                            AuthorizationEvent.event == "planner_permission"
                        )
                    )
                )
                assert len(events) == 2
                assert all(
                    e.actor_id == admin.id and e.details["user_id"] == str(user.id) for e in events
                )
                assert {e.details["after"] for e in events} == {False, True}

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.parametrize(
    "case,expected",
    [
        ("admin", 204),
        ("viewer", 403),
        ("csrf", 403),
        ("anonymous", 401),
        ("unknown-user", 404),
        ("unmanaged", 404),
        ("extra-field", 422),
        ("blank-reason", 422),
    ],
)
def test_planner_api_requires_admin_csrf_and_valid_scope(case, expected):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            settings = integration_settings()
            settings.maximo = {connections[0].id: config(person_login_domain="biendongpoc.vn")}
            if case == "unmanaged":
                settings.maximo = {}
            async with sessions.begin() as db:
                token, csrf = await issue_session(db, user if case == "viewer" else admin)
            app = create_app(settings)
            app.state.sessions = sessions
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                if case != "anonymous":
                    client.cookies.set(SESSION_COOKIE, token)
                payload = dict(
                    user_id=str(uuid4() if case == "unknown-user" else user.id),
                    connection_id=str(connections[0].id),
                    discipline="MECH",
                    enabled=True,
                    reason=" " if case == "blank-reason" else "Approved",
                )
                if case == "extra-field":
                    payload["is_admin"] = True
                response = await client.put(
                    "/api/admin/planner-permissions",
                    json=payload,
                    headers={} if case == "csrf" else {"X-CSRF-Token": csrf},
                )
                assert response.status_code == expected
            async with sessions() as db:
                permissions = list(await db.scalars(select(PlannerPermission)))
                assert len(permissions) == int(expected == 204)

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
