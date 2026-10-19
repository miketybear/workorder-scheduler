import asyncio
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import select
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import database, seed
from test_rota_activation import fixture

from app.assignments.models import AssignmentEvent
from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, MaximoConnection, User
from app.main import create_app
from app.rota.activation import capacity, materialize, proposed_days
from app.rota.models import (
    PersonDayCapacity,
    ResourcePerson,
    ResourcePool,
    ResourcePoolGrant,
    ResourcePoolState,
    RotaImport,
)

pytestmark = pytest.mark.integration


def current_receipt(result):
    return {**result, "previous_assignment_revision": result["assignment_revision"]}


def discipline_fixture(pool):
    data = fixture(pool)
    for row in data["source"]["rows"]:
        row["craft"] = "MECH"
    for labor in data["labor"]:
        labor["default_crafts"] = ["MECH"]
    return data


@pytest.mark.parametrize("legacy_mc", [False, True])
def test_assignment_api_lifecycle_capacity_scope_and_replacement(monkeypatch, legacy_mc):
    # PERSON grant sync has its own suites; preserve synthetic grants for scoped WO I/O here.
    monkeypatch.setattr("app.scheduling.routes.sync_person_access", AsyncMock())
    monkeypatch.setattr("app.assignments.routes.sync_person_access", AsyncMock())
    monkeypatch.setattr("app.rota.activation_routes.sync_person_access", AsyncMock())

    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {connections[0].id: config(crew_groups={"MECH": "CREW"})}
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                token, csrf = await issue_session(db, user)
                pool = ResourcePool(
                    connection_id=connection.id, label="Test", orgid="BDPOC", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                stage = RotaImport(
                    pool_id=pool.id,
                    actor_id=user.id,
                    version=2,
                    file_name="fixture.ods",
                    sheet="ROTA_2026",
                    **discipline_fixture(pool),
                )
                state = ResourcePoolState(pool_id=pool.id, version=0)
                db.add_all([stage, state])
                await db.flush()
                proposed, errors = proposed_days(stage, pool)
                assert not errors
                from types import SimpleNamespace

                await materialize(
                    db, stage, pool, state, SimpleNamespace(user_id=user.id), proposed
                )
                person = await db.scalar(
                    select(ResourcePerson).where(
                        ResourcePerson.pool_id == pool.id, ResourcePerson.person_key == "P0"
                    )
                )
            app = create_app(settings)
            app.state.sessions = sessions
            moved = False
            closed = False
            pic_requests = []

            def upstream(request):
                assert request.method == "GET"
                if request.url.path.endswith("/mxpersongroup"):
                    pic_requests.append(request)
                    raise httpx.ReadTimeout("Synthetic PIC service failure")
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            record(
                                bdpocdiscipline="OTHER" if moved else "MECH",
                                status="CLOSE" if closed else "APPR",
                                siteid="OTHER"
                                if 'siteid="OTHER"' in request.url.params.get("oslc.where", "")
                                else "TEST",
                                **(
                                    {}
                                    if 'siteid="OTHER"' in request.url.params.get("oslc.where", "")
                                    else {
                                        "schedstart": "2026-10-01T08:00:00+07:00",
                                        "schedfinish": "2026-10-01T17:00:00+07:00",
                                    }
                                ),
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
                # Pool write access does not grant administrative visibility of other crafts.
                import_url = f"/api/rota-imports/{stage.id}"
                forbidden = [
                    await client.get("/api/rota-imports", params={"pool_id": str(pool.id)}),
                    await client.get(import_url),
                    await client.get(import_url + "/activation-preview"),
                    await client.post(
                        import_url + "/cancel", json={"version": 2}, headers={"x-csrf-token": csrf}
                    ),
                    await client.post(
                        import_url + "/refresh-labor",
                        json={"version": 2},
                        headers={"x-csrf-token": csrf},
                    ),
                    await client.put(
                        import_url + "/mapping",
                        json={"version": 2, "source_row": 18, "labor_key": "key0"},
                        headers={"x-csrf-token": csrf},
                    ),
                    await client.post(
                        import_url + "/activate",
                        json={"version": 2, "pool_version": 1, "confirm_full_replacement": True},
                        headers={"x-csrf-token": csrf},
                    ),
                ]
                assert all(response.status_code == 404 for response in forbidden)
                url = f"/api/resource-pools/{pool.id}/assignments"
                headers = {"x-csrf-token": csrf}
                body = {
                    "connection_id": str(connection.id),
                    "site_id": "TEST",
                    "workorder_id": "100",
                    "discipline": "MECH",
                    "person_id": str(person.id),
                    "date": "2026-10-01",
                    "minutes": 360,
                    "request_id": str(uuid4()),
                }
                assert (await client.post(url, json=body)).status_code == 403
                first = await client.post(url, json=body, headers=headers)
                assert first.status_code == 200, first.text
                assert (
                    await client.post(url, json=body, headers=headers)
                ).json() == current_receipt(first.json())
                assert (
                    await client.get(f"/api/assignment-submissions/{body['request_id']}")
                ).json() == {"result": current_receipt(first.json())}
                assert (
                    await client.post(url, json={**body, "minutes": 300}, headers=headers)
                ).status_code == 409
                second = {**body, "site_id": "OTHER", "minutes": 271, "request_id": str(uuid4())}
                assert (await client.post(url, json=second, headers=headers)).status_code == 409
                second["minutes"] = 270
                accepted = await client.post(url, json=second, headers=headers)
                assert accepted.status_code == 200, accepted.text
                off = {**body, "date": "2026-10-02", "request_id": str(uuid4())}
                assert (await client.post(url, json=off, headers=headers)).status_code == 409
                params = {
                    k: body[k] for k in ("connection_id", "site_id", "workorder_id", "discipline")
                }
                params.update(date_from="2026-10-01", date_before="2026-10-03")
                listing = await client.get(url, params=params)
                assert listing.status_code == 200, listing.text
                # The other site's reservation consumes capacity without exposing its identity.
                assert len(listing.json()["items"]) == 1
                assert listing.json()["rows"][0]["days"][0]["allocated_minutes"] == 630
                timeline_url = f"/api/resource-pools/{pool.id}/assignment-timeline"
                timeline_params = {
                    k: params[k]
                    for k in ("connection_id", "discipline", "date_from", "date_before")
                }
                timeline = await client.get(timeline_url, params=timeline_params)
                assert timeline.status_code == 200, timeline.text
                assert len(timeline.json()["items"]) == 2
                assert len(timeline.json()["work_orders"]) == 2
                assert timeline.json()["work_orders"][0]["eligible"] is True
                by_site = {w["site_id"]: w for w in timeline.json()["work_orders"]}
                assert by_site["TEST"]["schedstart"] == "2026-10-01T08:00:00+07:00"
                assert by_site["TEST"]["schedfinish"] == "2026-10-01T17:00:00+07:00"
                assert by_site["TEST"]["assignedtechname"] == "TEST-PIC"
                # Missing schedule values pass through as null.
                assert by_site["OTHER"]["schedstart"] is None
                assert by_site["OTHER"]["schedfinish"] is None
                assert by_site["OTHER"]["assignedtechname"] == "TEST-PIC"
                assert all(row["craft"] == "MECH" for row in timeline.json()["rows"])
                assert (
                    await client.get(timeline_url, params={**timeline_params, "discipline": "DECK"})
                ).status_code == 404
                assert (
                    await client.get(
                        timeline_url, params={**timeline_params, "date_before": "2026-11-02"}
                    )
                ).status_code == 422
                # An in-scope WO does not authorize an out-of-discipline resource.
                from datetime import date

                from app.assignments.models import Allocation

                async with sessions.begin() as db:
                    day = await db.get(PersonDayCapacity, (pool.id, person.id, date(2026, 10, 1)))
                    day.craft = "DECK"
                forged = {**body, "minutes": 1, "request_id": str(uuid4())}
                assert (await client.post(url, json=forged, headers=headers)).status_code == 404
                assert (
                    await client.patch(
                        f"/api/assignments/{first.json()['id']}",
                        json={**forged, "version": 1},
                        headers=headers,
                    )
                ).status_code == 404
                active_filtered = (
                    await client.get(
                        f"/api/resource-pools/{pool.id}/active-rota",
                        params={"date_from": "2026-10-01", "date_before": "2026-10-03"},
                    )
                ).json()
                assert all(row["craft"] == "MECH" for row in active_filtered["rows"])
                assert active_filtered["latest_activation"] is None
                filtered = (await client.get(timeline_url, params=timeline_params)).json()
                assert all(
                    day["date"] != "2026-10-01"
                    for row in filtered["rows"]
                    if row["person_id"] == str(person.id)
                    for day in row["days"]
                )
                async with sessions.begin() as db:
                    day = await db.get(PersonDayCapacity, (pool.id, person.id, date(2026, 10, 1)))
                    day.craft = "MECH"
                    legacy = await db.get(Allocation, UUID(first.json()["id"]))
                    legacy.craft = "DECK"
                assert (
                    await client.get(f"/api/assignment-submissions/{body['request_id']}")
                ).status_code == 404
                assert (
                    await client.request(
                        "DELETE",
                        f"/api/assignments/{first.json()['id']}",
                        json={"version": 1, "request_id": str(uuid4())},
                        headers=headers,
                    )
                ).status_code == 404
                assert (
                    len((await client.get(timeline_url, params=timeline_params)).json()["items"])
                    == 1
                )
                async with sessions.begin() as db:
                    legacy = await db.get(Allocation, UUID(first.json()["id"]))
                    legacy.craft = "MECH"
                allocation = f"/api/assignments/{first.json()['id']}"
                update = {**body, "minutes": 300, "version": 99, "request_id": str(uuid4())}
                assert (
                    await client.patch(allocation, json=update, headers=headers)
                ).status_code == 409
                update["version"] = 1
                edited = await client.patch(allocation, json=update, headers=headers)
                assert edited.status_code == 200, edited.text
                # Workforce assignments use active-rota labor, independently of PIC groups.
                assert not pic_requests
                if legacy_mc:
                    from datetime import date

                    async with sessions.begin() as db:
                        day = await db.get(
                            PersonDayCapacity, (pool.id, person.id, date(2026, 10, 1))
                        )
                        day.role = "MATERIAL_CONTROLLER"
                    projection = (await client.get(url, params=params)).json()
                    assert all(row["role"] != "MATERIAL_CONTROLLER" for row in projection["rows"])
                    assert all(
                        day["date"] != "2026-10-01"
                        for row in projection["rows"]
                        if row["person_id"] == str(person.id)
                        for day in row["days"]
                    )
                    assert len(projection["items"]) == 1  # Existing reservation remains releasable.
                    active = (
                        await client.get(
                            f"/api/resource-pools/{pool.id}/active-rota",
                            params={"date_from": "2026-10-01", "date_before": "2026-10-03"},
                        )
                    ).json()
                    assert all(row["role"] != "MATERIAL_CONTROLLER" for row in active["rows"])
                    assert (
                        sum(day["capacity_hours"] for row in active["rows"] for day in row["days"])
                        == 10.5
                    )
                    assert (
                        await client.post(
                            url,
                            json={**body, "minutes": 1, "request_id": str(uuid4())},
                            headers=headers,
                        )
                    ).status_code == 409
                    async with sessions() as db:
                        stored = await capacity(db, pool.id, date(2026, 10, 1), date(2026, 10, 3))
                        assert any(day.role == "MATERIAL_CONTROLLER" for day in stored)
                async with sessions.begin() as db:
                    data = discipline_fixture(pool)
                    data["source"]["rows"][0]["days"][0].update(code="AL", capacity_hours=0)
                    replacement = RotaImport(
                        pool_id=pool.id,
                        actor_id=user.id,
                        version=2,
                        file_name="replacement.ods",
                        sheet="ROTA_2026",
                        **data,
                    )
                    db.add(replacement)
                async with sessions.begin() as db:
                    (await db.get(User, user.id)).is_admin = True
                activate = f"/api/rota-imports/{replacement.id}"
                activation_view = (await client.get(activate + "/activation-preview")).json()
                assert not activation_view["can_activate"]
                if legacy_mc:
                    assert "MATERIAL_CONTROLLER" in activation_view["changes"][0]["before_roles"]
                assert (
                    await client.post(
                        activate + "/activate",
                        headers=headers,
                        json={"version": 2, "pool_version": 1, "confirm_full_replacement": True},
                    )
                ).status_code == 409
                moved = True
                assert (await client.get(timeline_url, params=timeline_params)).status_code == 502
                assert (await client.get(url, params=params)).status_code == 502
                assert (
                    await client.request(
                        "DELETE",
                        allocation,
                        json={"version": 2, "request_id": str(uuid4())},
                        headers=headers,
                    )
                ).status_code == 502
                moved = False
                closed = True
                assert (await client.get(url, params=params)).status_code == 200
                assert all(
                    not wo["eligible"]
                    for wo in (await client.get(timeline_url, params=timeline_params)).json()[
                        "work_orders"
                    ]
                )
                assert (
                    await client.post(
                        url, json={**body, "request_id": str(uuid4())}, headers=headers
                    )
                ).status_code == 409
                release = {"version": 2, "request_id": str(uuid4())}
                deleted = await client.request("DELETE", allocation, json=release, headers=headers)
                assert deleted.status_code == 200, deleted.text
                assert deleted.json()["state"] == "released"
                assert (
                    await client.request("DELETE", allocation, json=release, headers=headers)
                ).json() == current_receipt(deleted.json())
                async with sessions.begin() as db:
                    grant = await db.scalar(
                        select(AccessGrant).where(AccessGrant.user_id == user.id)
                    )
                    grant.capability = "read"
                assert (
                    await client.post(
                        url, json={**body, "request_id": str(uuid4())}, headers=headers
                    )
                ).status_code == 404
                async with sessions() as db:
                    assert len((await db.scalars(select(AssignmentEvent))).all()) == 4
                # Even the import admin cannot view planning resources without a WO grant.
                async with sessions.begin() as db:
                    grant = await db.scalar(
                        select(AccessGrant).where(AccessGrant.user_id == user.id)
                    )
                    await db.delete(grant)
                assert (await client.get(timeline_url, params=timeline_params)).status_code == 404
                denied_roster = await client.get(
                    f"/api/resource-pools/{pool.id}/active-rota",
                    params={"date_from": "2026-10-01", "date_before": "2026-10-03"},
                )
                assert denied_roster.status_code == 200
                assert denied_roster.json()["rows"] == []
                assert denied_roster.json()["latest_activation"] is None

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.parametrize("race", ["two_planners", "activation"])
def test_capacity_races_serialize_on_shared_pool_lock(monkeypatch, race):
    from types import SimpleNamespace

    from sqlalchemy import func, text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.assignments.models import Allocation
    from app.db.models import Base, User

    monkeypatch.setattr("app.scheduling.routes.sync_person_access", AsyncMock())
    monkeypatch.setattr("app.assignments.routes.sync_person_access", AsyncMock())
    monkeypatch.setattr("app.rota.activation_routes.sync_person_access", AsyncMock())

    async def scenario():
        settings = integration_settings()
        engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
        schema = "assignment_race_" + uuid4().hex
        try:
            async with engine.begin() as db:
                await db.execute(text(f'CREATE SCHEMA "{schema}"'))
                translated = await db.execution_options(schema_translate_map={None: schema})
                await translated.run_sync(Base.metadata.create_all)
            sessions = async_sessionmaker(
                engine.execution_options(schema_translate_map={None: schema}),
                expire_on_commit=False,
            )
            user, _, connections = await seed(sessions)
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {connections[0].id: config()}
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                second = User(tenant_id=user.tenant_id, object_id=uuid4(), display_name="Second")
                pool = ResourcePool(
                    connection_id=connection.id, label="Race", orgid="BDPOC", enabled=True
                )
                db.add_all([second, pool])
                await db.flush()
                db.add(
                    AccessGrant(
                        user_id=second.id,
                        connection_id=connection.id,
                        discipline="MECH",
                        capability="write",
                    )
                )
                if race == "activation":
                    second.is_admin = True
                tokens = [await issue_session(db, p) for p in (user, second)]
                for p in (user, second):
                    db.add(ResourcePoolGrant(pool_id=pool.id, user_id=p.id, capability="write"))
                stage = RotaImport(
                    pool_id=pool.id,
                    actor_id=user.id,
                    version=2,
                    file_name="old.ods",
                    sheet="ROTA_2026",
                    **discipline_fixture(pool),
                )
                state = ResourcePoolState(pool_id=pool.id, version=0)
                db.add_all([stage, state])
                await db.flush()
                proposed, errors = proposed_days(stage, pool)
                assert not errors
                await materialize(
                    db, stage, pool, state, SimpleNamespace(user_id=user.id), proposed
                )
                person = await db.scalar(
                    select(ResourcePerson).where(
                        ResourcePerson.pool_id == pool.id, ResourcePerson.person_key == "P0"
                    )
                )
                data = discipline_fixture(pool)
                data["source"]["rows"][0]["days"][0].update(code="AL", capacity_hours=0)
                replacement = RotaImport(
                    pool_id=pool.id,
                    actor_id=second.id,
                    version=2,
                    file_name="new.ods",
                    sheet="ROTA_2026",
                    **data,
                )
                db.add(replacement)
            app = create_app(settings)
            app.state.sessions = sessions
            app.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(
                    lambda r: httpx.Response(200, json={"member": [record(bdpocdiscipline="MECH")]})
                )
            )

            # Force both independent transactions to contend, rather than relying on timing.
            from app.rota.activation_routes import pool_lock as real_pool_lock

            arrived = 0
            ready = asyncio.Event()

            async def simultaneous_lock(db, pool_id, write):
                nonlocal arrived
                if write:
                    arrived += 1
                    if arrived == 2:
                        ready.set()
                    await ready.wait()
                await real_pool_lock(db, pool_id, write)

            monkeypatch.setattr("app.assignments.routes.pool_lock", simultaneous_lock)
            monkeypatch.setattr("app.rota.activation_routes.pool_lock", simultaneous_lock)

            async def submit(index):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="https://test.example"
                ) as client:
                    client.cookies.set(SESSION_COOKIE, tokens[index][0])
                    headers = {"x-csrf-token": tokens[index][1]}
                    if race == "activation" and index == 1:
                        return await client.post(
                            f"/api/rota-imports/{replacement.id}/activate",
                            headers=headers,
                            json={
                                "version": 2,
                                "pool_version": 1,
                                "confirm_full_replacement": True,
                            },
                        )
                    return await client.post(
                        f"/api/resource-pools/{pool.id}/assignments",
                        headers=headers,
                        json={
                            "connection_id": str(connection.id),
                            "site_id": "TEST",
                            "workorder_id": "100",
                            "discipline": "MECH",
                            "person_id": str(person.id),
                            "date": "2026-10-01",
                            "minutes": 360,
                            "request_id": str(uuid4()),
                        },
                    )

            responses = await asyncio.gather(submit(0), submit(1))
            assert sorted(r.status_code for r in responses) == [200, 409], [
                r.text for r in responses
            ]
            async with sessions() as db:
                total = await db.scalar(select(func.coalesce(func.sum(Allocation.minutes), 0)))
                assert total == 360 if race == "two_planners" else total in (0, 360)
        finally:
            async with engine.begin() as db:
                await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
