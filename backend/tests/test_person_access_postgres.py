import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import (
    AccessGrant,
    AuthorizationEvent,
    MaximoConnection,
    MaximoPersonBinding,
    User,
)
from app.main import create_app

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "case",
    [
        "read-only",
        "null",
        "missing",
        "changed",
        "unavailable",
        "wrong-domain",
        "other-tenant",
        "no-claim",
        "collision",
        "renamed",
        "config-mismatch",
        "connection-changed",
        "anonymous",
    ],
)
def test_person_grants_use_server_profile_and_fail_closed(case):
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            connection = connections[0]
            async with sessions.begin() as db:
                stored_user = await db.get(User, user.id)
                stored_user.login_name = "nhatnh@biendongpoc.vn"
                if case == "wrong-domain":
                    stored_user.login_name = "nhatnh@other.vn"
                if case == "no-claim":
                    stored_user.login_name = None
                stored_connection = await db.get(MaximoConnection, connection.id)
                stored_connection.base_url = "https://maximo.invalid/maximo"
                token, _ = await issue_session(db, stored_user)
                if case == "collision":
                    other = User(tenant_id=user.tenant_id, object_id=uuid4(), display_name="Other")
                    db.add(other)
                    await db.flush()
                    db.add(
                        MaximoPersonBinding(
                            user_id=other.id, connection_id=connection.id, person_id="nhatnh"
                        )
                    )
                if case == "renamed":
                    db.add(
                        MaximoPersonBinding(
                            user_id=user.id, connection_id=connection.id, person_id="oldname"
                        )
                    )
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            if case == "other-tenant":
                settings.entra.tenant_id = uuid4()
            settings.maximo = {connection.id: config(person_login_domain="biendongpoc.vn")}
            if case == "config-mismatch":
                settings.maximo[
                    connection.id
                ].collection_url = "https://other.invalid/oslc/os/oslcmxwodetail"
            discipline = "MECH"
            calls = []

            async def upstream(request):
                calls.append(request)
                if case == "unavailable":
                    return httpx.Response(500, text="private")
                if case == "connection-changed":
                    async with sessions.begin() as db:
                        (await db.get(MaximoConnection, connection.id)).enabled = False
                members = (
                    []
                    if case == "missing"
                    else [
                        {
                            "personid": "NHATNH",
                            "ct_discipline": None if case == "null" else discipline,
                        }
                    ]
                )
                return httpx.Response(200, json={"member": members})

            request = SimpleNamespace(
                app=SimpleNamespace(
                    state=SimpleNamespace(
                        sessions=sessions,
                        settings=settings,
                        maximo_client_factory=lambda: httpx.AsyncClient(
                            transport=httpx.MockTransport(upstream)
                        ),
                    )
                )
            )
            if case in {"unavailable", "config-mismatch", "connection-changed", "anonymous"}:
                with pytest.raises(HTTPException) as error:
                    await sync_person_access(request, None if case == "anonymous" else token)
                assert error.value.status_code == (401 if case == "anonymous" else 503)
            else:
                await sync_person_access(request, token)
            if case == "changed":
                discipline = "E&I"
                await sync_person_access(request, token)
            async with sessions() as db:
                grants = list(
                    await db.scalars(
                        select(AccessGrant).where(
                            AccessGrant.user_id == user.id,
                            AccessGrant.connection_id == connection.id,
                        )
                    )
                )
                expected = case in {"read-only", "changed", "anonymous"}
                assert len(grants) == int(expected)
                if grants:
                    assert grants[0].capability == ("write" if case == "anonymous" else "read")
                    assert grants[0].discipline == discipline
                if case != "anonymous":
                    assert list(await db.scalars(select(AuthorizationEvent)))
                assert not (await db.get(User, user.id)).is_admin

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_authorization_audit_is_append_only():
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            async with sessions.begin() as db:
                db.add(
                    AuthorizationEvent(
                        actor_id=user.id, connection_id=connections[0].id, event="test", details={}
                    )
                )
            for statement in (
                "DELETE FROM authorization_event",
                "UPDATE authorization_event SET event='x'",
                "TRUNCATE authorization_event",
            ):
                with pytest.raises(DBAPIError, match="append-only"):
                    async with sessions.begin() as db:
                        await db.execute(text(statement))

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.parametrize("case", ["allowed", "wrong-scope", "revoked-during-read"])
def test_wo_api_rechecks_person_discipline_before_releasing_data(case):
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            connection = connections[0]
            async with sessions.begin() as db:
                (await db.get(User, user.id)).login_name = "nhatnh@biendongpoc.vn"
                (
                    await db.get(MaximoConnection, connection.id)
                ).base_url = "https://maximo.invalid/maximo"
                token, _ = await issue_session(db, user)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {connection.id: config(person_login_domain="biendongpoc.vn")}
            app = create_app(settings)
            app.state.sessions = sessions
            discipline = "MECH"
            wo_calls = []

            def upstream(request):
                nonlocal discipline
                if request.url.path.endswith("/mxperson"):
                    return httpx.Response(
                        200,
                        json={
                            "member": [
                                {
                                    "personid": "NHATNH",
                                    "ct_discipline": discipline,
                                }
                            ]
                        },
                    )
                wo_calls.append(request)
                if case == "revoked-during-read":
                    discipline = "E&I"
                return httpx.Response(200, json={"member": [record(bdpocdiscipline="MECH")]})

            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                response = await client.get(
                    "/api/work-orders",
                    params={
                        "connection_id": str(connection.id),
                        "discipline": "E&I" if case == "wrong-scope" else "MECH",
                        "target_from": "2026-09-01T00:00:00+07:00",
                        "target_before": "2026-10-01T00:00:00+07:00",
                    },
                )
                assert response.status_code == (200 if case == "allowed" else 404)
                assert len(wo_calls) == (0 if case == "wrong-scope" else 1)
                if case != "allowed":
                    assert "DEMO" not in response.text

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
