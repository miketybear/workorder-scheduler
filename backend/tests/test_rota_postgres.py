import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from test_entra import entra_settings
from test_labor_reader import record
from test_maximo import config
from test_postgres import database, seed
from test_rota_parser import fixture_ods

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import MaximoConnection, PlannerPermission, User
from app.main import create_app
from app.rota.models import ResourcePool, ResourcePoolGrant, RotaEvent

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "case", ["lifecycle", "revoked", "failure", "wrong_pool", "contractor", "material_controller"]
)
def test_durable_rota_api(case):
    async def scenario():
        async with database() as sessions:
            user, admin, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {connections[0].id: config()}
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                (await db.get(User, user.id)).is_admin = True
                token, csrf = await issue_session(db, user)
                pool = ResourcePool(
                    connection_id=connection.id, label="Test pool", orgid="BDPOC", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
            app = create_app(settings)
            app.state.sessions = sessions

            async def upstream(request):
                if case == "failure":
                    raise httpx.ReadTimeout("Synthetic timeout")
                if case == "revoked":
                    async with sessions.begin() as db:
                        grant = await db.get(ResourcePoolGrant, (pool.id, user.id))
                        await db.delete(grant)
                        (await db.get(User, user.id)).is_admin = False
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            record(
                                person=[{"displayname": "Nguyen Van A"}],
                                laborcraftrate=[{"craft": "P&P", "defaultcraft": True}],
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
                assert (await client.get("/api/resource-pools")).status_code == 401
                client.cookies.set(SESSION_COOKIE, token)
                assert (await client.get("/api/resource-pools")).json()["items"][0]["id"] == str(
                    pool.id
                )
                url = f"/api/rota-imports?pool_id={pool.id}&filename=rota.ods"
                assert (
                    await client.post(
                        url,
                        content=fixture_ods(),
                        headers={"content-type": "application/octet-stream"},
                    )
                ).status_code == 403
                headers = {"content-type": "application/octet-stream", "x-csrf-token": csrf}
                response = await client.post(
                    url,
                    content=fixture_ods(
                        company="Contractor" if case == "contractor" else "BD POC",
                        mechanic_position="Material Controller"
                        if case == "material_controller"
                        else "Mechanical Technician",
                    ),
                    headers=headers,
                )
                if case == "revoked":
                    assert response.status_code == 404
                    assert (
                        await client.get("/api/rota-imports", params={"pool_id": str(pool.id)})
                    ).status_code == 404
                    return
                assert response.status_code == 200, response.text
                stage = response.json()
                assert stage["version"] == 2
                assert len(stage["rows"]) == (
                    0 if case == "contractor" else 4 if case == "material_controller" else 5
                )
                if case == "material_controller":
                    assert stage["excluded_position_count"] == 1
                    assert stage["summary"]["capacity_hours"] == 42
                    rejected = await client.put(
                        f"/api/rota-imports/{stage['id']}/mapping",
                        json={"version": 2, "source_row": 13, "labor_key": None},
                        headers=headers,
                    )
                    assert rejected.status_code == 422
                if case == "contractor":
                    assert stage["excluded_company_count"] == 5
                    assert stage["excluded_labor_count"] == 1
                    assert stage["summary"]["rota_people"] == 0
                    assert stage["summary"]["mapped_people"] == 0
                    assert stage["summary"]["capacity_hours"] == 0
                if case == "failure":
                    assert stage["labor_error"]
                    assert all(not r["candidates"] for r in stage["rows"])
                detail = f"/api/rota-imports/{stage['id']}"
                assert (await client.get(detail)).json() == stage
                if case == "wrong_pool":
                    async with sessions.begin() as db:
                        grant = await db.get(ResourcePoolGrant, (pool.id, user.id))
                        await db.delete(grant)
                        (await db.get(User, user.id)).is_admin = False
                    assert (await client.get(detail)).status_code == 404
                    assert (await client.get(f"/api/rota-imports/{uuid4()}")).status_code == 404
                    return
                assert (
                    await client.post(
                        detail + "/cancel", json={"version": 1}, headers={"x-csrf-token": csrf}
                    )
                ).status_code == 409
                cancelled = await client.post(
                    detail + "/cancel", json={"version": 2}, headers={"x-csrf-token": csrf}
                )
                assert cancelled.status_code == 200
                assert cancelled.json()["status"] == "cancelled"
                assert (
                    await client.post(
                        detail + "/refresh-labor",
                        json={"version": 3},
                        headers={"x-csrf-token": csrf},
                    )
                ).status_code == 409
                async with sessions() as db:
                    events = (
                        await db.scalars(select(RotaEvent).where(RotaEvent.pool_id == pool.id))
                    ).all()
                    assert {e.event for e in events} == {"upload", "labor_snapshot", "cancel"}

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.parametrize("role", ["admin", "planner", "wrong_connection", "none"])
def test_role_access_without_explicit_pool_grant(role):
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {connections[0].id: config()}
            async with sessions.begin() as db:
                stored = await db.get(User, user.id)
                stored.is_admin = role == "admin"
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                if role in {"planner", "wrong_connection"}:
                    db.add(
                        PlannerPermission(
                            user_id=user.id,
                            connection_id=connections[1 if role == "wrong_connection" else 0].id,
                            discipline="E&I",
                        )
                    )
                pool = ResourcePool(
                    connection_id=connection.id,
                    label="Common five crafts",
                    orgid="BDPOC",
                    enabled=True,
                )
                db.add(pool)
                await db.flush()
                token, csrf = await issue_session(db, stored)
            app = create_app(settings)
            app.state.sessions = sessions
            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, json={"member": []})
                )
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                response = await client.get("/api/resource-pools")
                assert len(response.json()["items"]) == (1 if role in {"admin", "planner"} else 0)
                upload = await client.post(
                    f"/api/rota-imports?pool_id={pool.id}&filename=rota.ods",
                    content=fixture_ods(),
                    headers={"content-type": "application/octet-stream", "x-csrf-token": csrf},
                )
                assert upload.status_code == (200 if role == "admin" else 404)
                if upload.status_code == 200:
                    async with sessions.begin() as db:
                        if role == "admin":
                            (await db.get(User, user.id)).is_admin = False
                        else:
                            permission = await db.get(
                                PlannerPermission, (user.id, connection.id, "E&I")
                            )
                            await db.delete(permission)
                    assert (
                        await client.get("/api/rota-imports/" + upload.json()["id"])
                    ).status_code == 404

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_refresh_failure_preserves_mapping_and_snapshot():
    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {connections[0].id: config()}
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                pool = ResourcePool(
                    connection_id=connection.id, orgid="BDPOC", label="Test", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                (await db.get(User, user.id)).is_admin = True
                token, csrf = await issue_session(db, user)
            fail = False
            displayname = "Nguyen Van A"
            labor_craft = "P&P"
            ambiguous = False
            title = None

            def upstream(request):
                if fail:
                    raise httpx.ReadTimeout("Timeout")
                member = record(
                    person=[{"displayname": displayname, "title": title}],
                    laborcraftrate=[{"craft": labor_craft, "defaultcraft": True}],
                )
                members = [member]
                if ambiguous:
                    members.append(
                        {
                            **member,
                            "laborcode": "LAB2",
                            "personid": "P2",
                            "person": [
                                {"displayname": displayname, "title": "Material Controller"}
                            ],
                        }
                    )
                return httpx.Response(200, json={"member": members})

            app = create_app(settings)
            app.state.sessions = sessions
            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                headers = {"x-csrf-token": csrf}
                stage = (
                    await client.post(
                        f"/api/rota-imports?pool_id={pool.id}&filename=rota.ods",
                        content=fixture_ods(),
                        headers={**headers, "content-type": "application/octet-stream"},
                    )
                ).json()
                detail = "/api/rota-imports/" + stage["id"]
                row = stage["rows"][0]
                mapped = (
                    await client.put(
                        detail + "/mapping",
                        json={
                            "version": 2,
                            "source_row": row["source_row"],
                            "labor_key": row["candidates"][0]["labor_key"],
                        },
                        headers=headers,
                    )
                ).json()
                fail = True
                failed = (
                    await client.post(
                        detail + "/refresh-labor", json={"version": 3}, headers=headers
                    )
                ).json()
                assert failed["labor_error"]
                assert failed["rows"][0]["mapping"] == mapped["rows"][0]["mapping"]
                assert failed["labor_snapshot_at"] == mapped["labor_snapshot_at"]
                fail = False
                recovered = (
                    await client.post(
                        detail + "/refresh-labor", json={"version": 4}, headers=headers
                    )
                ).json()
                assert recovered["labor_error"] is None
                assert recovered["rows"][0]["mapping"] == mapped["rows"][0]["mapping"]
                displayname = "Different Person"
                changed = (
                    await client.post(
                        detail + "/refresh-labor", json={"version": 5}, headers=headers
                    )
                ).json()
                assert changed["rows"][0]["mapping"] is None
                assert changed["rows"][0]["candidates"] == []
                assert any(issue["kind"] == "mapping" for issue in changed["rows"][0]["issues"])
                # Fixes on Maximo are applied by refresh, without uploader mapping.
                displayname = "Nguyen Van A"
                fixed = (
                    await client.post(
                        detail + "/refresh-labor", json={"version": 6}, headers=headers
                    )
                ).json()
                assert fixed["rows"][0]["mapping"]["laborcode"] == "LAB1"
                assert fixed["rows"][0]["issues"] == []
                assert (await client.get(detail)).json() == fixed
                labor_craft = "MECH"
                mismatch = (
                    await client.post(
                        detail + "/refresh-labor", json={"version": 7}, headers=headers
                    )
                ).json()
                assert mismatch["rows"][0]["mapping"] is None
                assert "MECH" in mismatch["rows"][0]["issues"][0]["message"]
                labor_craft = "P&P"
                ambiguous = True
                duplicate = (
                    await client.post(
                        detail + "/refresh-labor", json={"version": 8}, headers=headers
                    )
                ).json()
                assert duplicate["rows"][0]["mapping"] is None
                message = duplicate["rows"][0]["issues"][0]["message"]
                assert "LAB1" in message and "LAB2" in message
                rejected = await client.put(
                    detail + "/mapping",
                    json={
                        "version": 9,
                        "source_row": row["source_row"],
                        "labor_key": duplicate["rows"][0]["candidates"][0]["labor_key"],
                    },
                    headers=headers,
                )
                assert rejected.status_code == 422
                title = "Control RM Engineer"
                exact = (
                    await client.post(
                        detail + "/refresh-labor", json={"version": 9}, headers=headers
                    )
                ).json()
                assert len(exact["rows"][0]["candidates"]) == 2
                assert exact["rows"][0]["mapping"]["title"] == title
                assert exact["rows"][0]["issues"] == []
                wrong = await client.put(
                    detail + "/mapping",
                    json={
                        "version": 10,
                        "source_row": row["source_row"],
                        "labor_key": exact["rows"][0]["candidates"][1]["labor_key"],
                    },
                    headers=headers,
                )
                assert wrong.status_code == 422
                ambiguous = False
                resolved = (
                    await client.post(
                        detail + "/refresh-labor", json={"version": 10}, headers=headers
                    )
                ).json()
                assert resolved["rows"][0]["mapping"]["laborcode"] == "LAB1"
                assert resolved["rows"][0]["issues"] == []

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
