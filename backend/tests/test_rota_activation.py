import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from test_entra import entra_settings
from test_maximo import config
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import AccessGrant, MaximoConnection, User
from app.main import create_app
from app.rota.activation import difference, proposed_days
from app.rota.models import (
    ResourcePerson,
    ResourcePool,
    ResourcePoolGrant,
    RotaActivation,
    RotaImport,
)
from app.rota.parser import POLICY_VERSION


def fixture(pool, count=2, start="2026-10-01", before="2026-10-03"):
    rows, labor, mapping = [], [], {}
    for i in range(count):
        name = f"Company Person {i}"
        rows.append(
            {
                "source_row": i + 18,
                "name": name,
                "company": "BDPOC",
                "position": "Production technician",
                "craft": "P&P",
                "role": "TECH",
                "issues": [],
                "days": [
                    {"date": start, "code": "1", "capacity_hours": 10.5},
                    {"date": "2026-10-02", "code": "", "capacity_hours": 0},
                ],
            }
        )
        labor.append(
            {
                "labor_key": f"key{i}",
                "connection_id": str(pool.connection_id),
                "orgid": pool.orgid,
                "laborcode": f"L{i}",
                "personid": f"P{i}",
                "displayname": name,
                "default_crafts": ["P&P"],
            }
        )
        mapping[str(i + 18)] = f"key{i}"
    return {
        "source": {
            "rows": rows,
            "policy_version": POLICY_VERSION,
            "source_errors": [],
            "coverage_from": start,
            "coverage_before": before,
        },
        "labor": labor,
        "mapping": mapping,
        "labor_snapshot_at": datetime.now(UTC),
        "labor_error": None,
    }


@pytest.mark.parametrize(
    "case",
    [
        "valid",
        "old_policy",
        "contractor",
        "duplicate",
        "wrong_org",
        "wrong_connection",
        "snapshot_error",
        "snapshot_absent",
        "hours",
        "days",
        "ambiguous",
        "craft",
        "cancelled",
    ],
)
def test_activation_validation(case):
    pool = SimpleNamespace(connection_id=uuid4(), orgid="BDPOC")
    data = fixture(pool)
    stage = SimpleNamespace(
        id=uuid4(),
        pool_id=uuid4(),
        version=2,
        status="staged",
        file_name="x.ods",
        sheet="ROTA_2026",
        created_at=datetime.now(UTC),
        **data,
    )
    if case == "old_policy":
        stage.source["policy_version"] = "v3"
    if case == "contractor":
        stage.source["rows"][0]["company"] = "Contractor"
    if case == "duplicate":
        stage.labor[1]["personid"] = "P0"
    if case == "wrong_org":
        stage.labor[0]["orgid"] = "OTHER"
    if case == "wrong_connection":
        stage.labor[0]["connection_id"] = str(uuid4())
    if case == "snapshot_error":
        stage.labor_error = "Snapshot unavailable"
    if case == "snapshot_absent":
        stage.labor_snapshot_at = None
    if case == "hours":
        stage.source["rows"][0]["days"][0]["capacity_hours"] = 11
    if case == "days":
        stage.source["rows"][0]["days"].pop()
    if case == "ambiguous":
        stage.labor.append({**stage.labor[0], "labor_key": "extra"})
    if case == "craft":
        stage.labor[0]["default_crafts"] = ["MECH"]
    if case == "cancelled":
        stage.status = "cancelled"
    _, errors = proposed_days(stage, pool)
    assert bool(errors) == (case != "valid")


def test_diff_preserves_codes_zero_hours_metadata_and_limits_samples():
    value = {
        "person_key": "P0",
        "name": "Name",
        "code": "",
        "capacity_hours": 0,
        "craft": "P&P",
        "role": "TECH",
        "laborcode": "L0",
    }
    before = {("P0", str(i)): {**value, "date": str(i)} for i in range(30)}
    after = {
        key: {**v, "code": "AL", "role": "SUP", "name": "New name"} for key, v in before.items()
    }
    diff, changes = difference(before, after)
    assert diff["changed_days"] == 30
    assert diff["changed_people"] == 1
    assert changes[0]["day_changes_truncated"]
    assert len(changes[0]["day_changes"]) == 20
    assert changes[0]["before_hours"] == changes[0]["after_hours"] == 0


@pytest.mark.integration
@pytest.mark.parametrize(
    "case",
    [
        "lifecycle",
        "runtime",
        "stale_import",
        "stale_pool",
        "csrf",
        "confirmation",
        "revoked",
        "tenant",
        "cancelled",
        "rollback",
    ],
)
def test_activation_postgres(case, monkeypatch):
    from unittest.mock import AsyncMock

    monkeypatch.setattr("app.rota.activation_routes.sync_person_access", AsyncMock())

    async def scenario():
        async with database() as sessions:
            user, _, connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {connections[0].id: config()}
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                (await db.get(User, user.id)).is_admin = True
                db.add(
                    AccessGrant(
                        user_id=user.id,
                        connection_id=connection.id,
                        discipline="P&P",
                        capability="read",
                    )
                )
                token, csrf = await issue_session(db, user)
                pool = ResourcePool(
                    connection_id=connection.id, label="Synthetic", orgid="BDPOC", enabled=True
                )
                db.add(pool)
                await db.flush()
                db.add(ResourcePoolGrant(pool_id=pool.id, user_id=user.id, capability="write"))
                stage = RotaImport(
                    pool_id=pool.id,
                    actor_id=user.id,
                    version=2,
                    status="cancelled" if case == "cancelled" else "staged",
                    file_name="synthetic.ods",
                    sheet="ROTA_2026",
                    **fixture(pool),
                )
                db.add(stage)
            if case == "runtime":
                role = "rota_runtime_" + uuid4().hex
                async with sessions.begin() as db:
                    await db.execute(text(f'CREATE ROLE "{role}" NOLOGIN'))
                    await db.execute(text(f'GRANT USAGE ON SCHEMA public TO "{role}"'))
                    await db.execute(
                        text(f'GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{role}"')
                    )
                    await db.execute(text(f'GRANT UPDATE(display_name) ON app_user TO "{role}"'))
                    await db.execute(
                        text(
                            "GRANT UPDATE ON login_session, rota_import, "
                            f'resource_pool_state TO "{role}"'
                        )
                    )
                    await db.execute(
                        text(
                            "GRANT INSERT ON resource_pool_state, resource_person, "
                            f'rota_activation, person_day_capacity, rota_event TO "{role}"'
                        )
                    )
                    await db.execute(text(f'GRANT DELETE ON person_day_capacity TO "{role}"'))
                    await db.execute(text(f'SET LOCAL ROLE "{role}"'))
                    assert not await db.scalar(
                        text("SELECT has_table_privilege(current_user, 'resource_pool', 'UPDATE')")
                    )
                    assert not await db.scalar(
                        text(
                            "SELECT has_table_privilege(current_user, 'rota_activation', 'UPDATE')"
                        )
                    )
            if case == "runtime":
                import app.rota.activation_routes as activation_routes

                original_authority = activation_routes.authority
                runtime_calls = []

                async def runtime_authority(db, request, pool_id, write=False):
                    # Assert in the HTTP handler's own session, not only setup.
                    assert await db.scalar(text("SELECT current_user")) == role
                    assert not await db.scalar(
                        text("SELECT has_table_privilege(current_user, 'resource_pool', 'UPDATE')")
                    )
                    runtime_calls.append((request.url.path, write))
                    return await original_authority(db, request, pool_id, write)

                original_import_authority = activation_routes.import_authority

                async def runtime_import_authority(db, request, pool_id, write=False):
                    await runtime_authority(db, request, pool_id, write)
                    return await original_import_authority(db, request, pool_id, write)

                monkeypatch.setattr(activation_routes, "authority", runtime_authority)
                monkeypatch.setattr(activation_routes, "import_authority", runtime_import_authority)
            app = create_app(settings)
            app.state.sessions = sessions
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://test.example"
            ) as client:
                client.cookies.set(SESSION_COOKIE, token)
                url = f"/api/rota-imports/{stage.id}"
                view = (await client.get(url + "/activation-preview")).json()
                assert view["diff"]["added_people"] == 2
                assert view["activation_receipt"] is None
                body = {"version": 2, "pool_version": 0, "confirm_full_replacement": True}
                headers = {"x-csrf-token": csrf}
                if case == "stale_import":
                    body["version"] = 1
                if case == "stale_pool":
                    body["pool_version"] = 1
                if case == "csrf":
                    headers = {}
                if case == "confirmation":
                    body["confirm_full_replacement"] = 1
                if case == "revoked":
                    async with sessions.begin() as db:
                        await db.delete(await db.get(ResourcePoolGrant, (pool.id, user.id)))
                        (await db.get(User, user.id)).is_admin = False
                if case == "tenant":
                    settings.entra = settings.entra.model_copy(update={"tenant_id": uuid4()})
                if case == "rollback":
                    import app.rota.activation_routes as routes

                    original = routes.materialize

                    async def fail(*args):
                        await original(*args)
                        raise RuntimeError("Synthetic failure after capacity flush")

                    monkeypatch.setattr(routes, "materialize", fail)
                    with pytest.raises(RuntimeError):
                        await client.post(url + "/activate", json=body, headers=headers)
                    async with sessions() as db:
                        assert (
                            await db.scalar(
                                select(RotaActivation).where(RotaActivation.import_id == stage.id)
                            )
                            is None
                        )
                        assert (await db.get(RotaImport, stage.id)).status == "staged"
                    return
                response = await client.post(url + "/activate", json=body, headers=headers)
                if case not in {"lifecycle", "runtime"}:
                    assert response.status_code == (
                        422
                        if case == "confirmation"
                        else 403
                        if case in {"csrf", "tenant"}
                        else 404
                        if case == "revoked"
                        else 409
                    ), response.text
                    return
                assert response.status_code == 200, response.text
                first = response.json()
                if case == "runtime":
                    runtime_active = await client.get(
                        f"/api/resource-pools/{pool.id}/active-rota",
                        params={"date_from": "2026-10-01", "date_before": "2026-10-03"},
                    )
                    assert runtime_active.status_code == 200, runtime_active.text
                    assert runtime_active.json()["pool_version"] == 1
                    recovery = await client.get(url + "/activation-preview")
                    assert recovery.status_code == 200, recovery.text
                    assert recovery.json()["activation_receipt"] == first
                    assert any(
                        path.endswith("/activate") and write for path, write in runtime_calls
                    )
                    assert any(path.endswith("/active-rota") for path, _ in runtime_calls)
                    assert any(path.endswith("/activation-preview") for path, _ in runtime_calls)
                    assert (
                        await client.post(url + "/activate", json=body, headers=headers)
                    ).json() == first
                    return
                assert (
                    first["person_count"] == 2
                    and first["day_count"] == 4
                    and first["total_hours"] == 21
                )
                assert (
                    await client.post(url + "/activate", json=body, headers=headers)
                ).json() == first
                view = (await client.get(url + "/activation-preview")).json()
                assert not view["can_activate"] and view["activation_receipt"] == first
                for action in ("cancel", "refresh-labor"):
                    assert (
                        await client.post(url + "/" + action, json={"version": 3}, headers=headers)
                    ).status_code == 409
                activeurl = (
                    f"/api/resource-pools/{pool.id}/active-rota"
                    "?date_from=2026-10-01&date_before=2026-10-03"
                )
                active = (await client.get(activeurl)).json()
                person_id = active["rows"][0]["person_id"]
                async with sessions.begin() as db:
                    data = fixture(pool, 1)
                    data["source"]["coverage_from"] = "2026-10-02"
                    data["source"]["rows"][0]["days"] = [
                        {"date": "2026-10-02", "code": "OT", "capacity_hours": 10.5}
                    ]
                    data["source"]["rows"][0]["name"] = "Changed Name"
                    data["labor"][0]["displayname"] = "Changed Name"
                    replacement = RotaImport(
                        pool_id=pool.id,
                        actor_id=user.id,
                        version=2,
                        file_name="new.ods",
                        sheet="ROTA_2026",
                        **data,
                    )
                    db.add(replacement)
                secondurl = f"/api/rota-imports/{replacement.id}"
                view = (await client.get(secondurl + "/activation-preview")).json()
                assert view["diff"]["removed_people"] == 1 and view["diff"]["changed_people"] == 1
                second = await client.post(
                    secondurl + "/activate", json={**body, "pool_version": 1}, headers=headers
                )
                assert second.status_code == 200, second.text
                active = (await client.get(activeurl)).json()
                assert active["pool_version"] == 2
                assert sum(len(r["days"]) for r in active["rows"]) == 3
                assert all(
                    r["person_id"] == person_id for r in active["rows"] if r["person_key"] == "P0"
                )
                assert (
                    await client.post(url + "/activate", json=body, headers=headers)
                ).json() == first
                async with sessions() as db:
                    assert (
                        len(
                            (
                                await db.scalars(
                                    select(ResourcePerson).where(ResourcePerson.pool_id == pool.id)
                                )
                            ).all()
                        )
                        == 2
                    )
                for statement in (
                    "UPDATE rota_activation SET total_hours=0 WHERE id=:id",
                    "DELETE FROM rota_activation WHERE id=:id",
                    "UPDATE rota_import SET version=99 WHERE id=:stage",
                ):
                    with pytest.raises(DBAPIError):
                        async with sessions.begin() as db:
                            await db.execute(
                                text(statement), {"id": first["id"], "stage": str(stage.id)}
                            )

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.integration
def test_two_admins_competing_imports_have_one_winner(monkeypatch):
    from unittest.mock import AsyncMock

    monkeypatch.setattr("app.rota.activation_routes.sync_person_access", AsyncMock())
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.db.models import Base, User

    async def scenario():
        settings = integration_settings()
        engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
        schema = "rota_concurrency_" + uuid4().hex
        try:
            async with engine.begin() as db:
                await db.execute(text(f'CREATE SCHEMA "{schema}"'))
                translated = await db.execution_options(schema_translate_map={None: schema})
                await translated.run_sync(Base.metadata.create_all)
            isolated = engine.execution_options(schema_translate_map={None: schema})
            sessions = async_sessionmaker(isolated, expire_on_commit=False)
            user, _, connections = await seed(sessions)
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            settings.maximo = {connections[0].id: config()}
            async with sessions.begin() as db:
                connection = await db.get(MaximoConnection, connections[0].id)
                connection.base_url = "https://maximo.invalid/maximo"
                second = User(
                    tenant_id=user.tenant_id, object_id=uuid4(), display_name="Second planner"
                )
                pool = ResourcePool(
                    connection_id=connection.id, label="Synthetic race", orgid="BDPOC", enabled=True
                )
                db.add_all([second, pool])
                await db.flush()
                (await db.get(User, user.id)).is_admin = True
                second.is_admin = True
                tokens = [await issue_session(db, person) for person in (user, second)]
                stages = []
                for person in (user, second):
                    db.add(
                        ResourcePoolGrant(pool_id=pool.id, user_id=person.id, capability="write")
                    )
                    stage = RotaImport(
                        pool_id=pool.id,
                        actor_id=person.id,
                        version=2,
                        file_name="synthetic.ods",
                        sheet="ROTA_2026",
                        **fixture(pool),
                    )
                    db.add(stage)
                    stages.append(stage)
            app = create_app(settings)
            app.state.sessions = sessions

            async def submit(stage, credentials):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="https://test.example"
                ) as client:
                    client.cookies.set(SESSION_COOKIE, credentials[0])
                    return await client.post(
                        f"/api/rota-imports/{stage.id}/activate",
                        json={"version": 2, "pool_version": 0, "confirm_full_replacement": True},
                        headers={"x-csrf-token": credentials[1]},
                    )

            responses = await asyncio.gather(
                *(
                    submit(stage, credentials)
                    for stage, credentials in zip(stages, tokens, strict=True)
                )
            )
            assert sorted(r.status_code for r in responses) == [200, 409]
            async with sessions() as db:
                assert len((await db.scalars(select(RotaActivation))).all()) == 1
                assert sorted((await db.scalars(select(RotaImport.status))).all()) == [
                    "activated",
                    "staged",
                ]
        finally:
            async with engine.begin() as db:
                await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_unique_exact_title_disambiguation_allows_activation():
    pool = SimpleNamespace(connection_id=uuid4(), orgid="BDPOC")
    data = fixture(pool)
    data["labor"][0]["title"] = "Production Technician"
    data["labor"].append(
        {
            **data["labor"][0],
            "labor_key": "extra",
            "personid": "EXTRA",
            "title": "Material Controller",
        }
    )
    stage = SimpleNamespace(
        id=uuid4(),
        pool_id=uuid4(),
        version=2,
        status="staged",
        file_name="x.ods",
        sheet="ROTA_2026",
        created_at=datetime.now(UTC),
        **data,
    )
    proposed, errors = proposed_days(stage, pool)
    assert not errors
    assert len(proposed) == 4
    # Missing title leaves a prior persisted mapping unusable.
    data["labor"][0]["title"] = None
    _, errors = proposed_days(stage, pool)
    assert errors


def test_old_policy_material_controller_staging_requires_reupload():
    pool = SimpleNamespace(connection_id=uuid4(), orgid="BDPOC")
    data = fixture(pool)
    data["source"]["policy_version"] = "rota-2026-10-11-v4"
    data["source"]["rows"][1]["position"] = "Material Controller"
    data["source"]["rows"][1]["role"] = "MATERIAL_CONTROLLER"
    stage = SimpleNamespace(
        id=uuid4(),
        pool_id=uuid4(),
        version=2,
        status="staged",
        file_name="x.ods",
        sheet="ROTA_2026",
        created_at=datetime.now(UTC),
        **data,
    )
    proposed, errors = proposed_days(stage, pool)
    assert any("Upload again" in error for error in errors)
    assert all(key[0] != "P1" for key in proposed)
