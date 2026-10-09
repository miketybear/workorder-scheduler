import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from test_entra import entra_settings
from test_maximo import config, record
from test_postgres import seed
from test_write_contract_probe import evidence

from app.auth.sessions import issue_session
from app.config import integration_settings
from app.db.models import (
    AuditEvent,
    Base,
    MaximoConnection,
    MaximoPersonBinding,
    PlannerPermission,
    UploadItem,
    User,
)
from app.maximo.field_contract_probe import FieldContractProbe
from app.maximo.reader import MaximoReadError
from app.maximo.write_contract_probe import WriteContractProbe

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("worktype", ["PM", "CFT"])
@pytest.mark.parametrize("case", ["valid", "no_planner"])
def test_field_mode_committed_plan_intent_and_authority_before_schedule_post(worktype, case):
    import json

    async def scenario():
        async with setup(case) as (sessions, settings, user, connection):
            sent = []
            payload = {"schedstart": None, "schedfinish": None}
            source = evidence().model_copy(
                update={
                    "worktype": worktype,
                    "discipline": "MECH",
                    "rowstamp_candidate": "100",
                    "baseline": evidence().baseline.model_copy(update={"worktype": worktype}),
                }
            )

            async def handler(request):
                if request.method == "GET":
                    return httpx.Response(
                        200, json={"member": [{"personid": "probe", "ct_discipline": "MECH"}]}
                    )
                async with sessions() as db:
                    audits = list(
                        await db.scalars(
                            select(AuditEvent).where(AuditEvent.upload_item_id == probe.item_id)
                        )
                    )
                    plan = next(event for event in audits if event.event == "contract_probe")
                    intent = next(event for event in audits if event.event == "contract_intent")
                    assert plan.details["field_mode"] is True
                    assert plan.details["operator_worktype"] == worktype
                    assert plan.details["field_plan"] == [
                        ["original_null_schedule_noop", json.dumps(payload, sort_keys=True)]
                    ]
                    assert intent.details["changes"] == payload
                    assert intent.details["attempt"] == request.headers["transactionid"]
                    assert (await db.get(UploadItem, probe.item_id)).state == "sending"
                sent.append(request)
                return httpx.Response(204)

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                probe = FieldContractProbe(
                    sessions,
                    settings,
                    client,
                    user.id,
                    connection.id,
                    "MECH",
                    "TEST",
                    "100",
                    operator_worktype=worktype,
                )
                probe.field_plan = (
                    ("original_null_schedule_noop", json.dumps(payload, sort_keys=True)),
                )
                if case == "no_planner":
                    with pytest.raises(MaximoReadError):
                        await probe.reserve(source)
                    assert not sent
                    return
                await probe.reserve(source)
                await probe.post_fields(source, "100", payload, "original_null_schedule_noop")
                assert len(sent) == 1
                with pytest.raises(MaximoReadError, match="Target dates"):
                    await probe.post_fields(
                        source, "100", {"targcompdate": None}, "forbidden_target"
                    )
                assert len(sent) == 1

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@asynccontextmanager
async def setup(case="valid"):
    settings = integration_settings()
    schema = "write_probe_" + uuid4().hex
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        hide_parameters=True,
        execution_options={"schema_translate_map": {None: schema}},
    )
    async with engine.begin() as db:
        await db.execute(text(f'CREATE SCHEMA "{schema}"'))
        await db.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    user, admin, connections = await seed(sessions)
    connection = connections[0]
    try:
        settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
        settings.maximo = {
            connection.id: config(
                person_login_domain="example.invalid", crew_groups={"MECH": "CREW"}
            )
        }
        async with sessions.begin() as db:
            stored_user = await db.get(User, user.id)
            stored_user.login_name = "probe@example.invalid"
            stored_connection = await db.get(MaximoConnection, connection.id)
            stored_connection.base_url = "https://maximo.invalid/maximo"
            if case == "production":
                stored_connection.environment = "production"
            db.add(
                MaximoPersonBinding(user_id=user.id, connection_id=connection.id, person_id="probe")
            )
            if case != "no_planner":
                db.add(
                    PlannerPermission(
                        user_id=user.id, connection_id=connection.id, discipline="MECH"
                    )
                )
            if case != "no_session":
                await issue_session(db, stored_user)
        yield sessions, settings, user, connection
    finally:
        # UUID schema is isolated inside integration_settings' guarded scheduler_test
        # database. No append-only application audit rows are deleted for cleanup.
        async with engine.begin() as db:
            await db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()


@pytest.mark.parametrize(
    "token_source,worktype",
    [("advertised_etag", "CM"), ("rowstamp_candidate", "CM")]
    + [
        ("rowstamp_body_candidate", worktype)
        for worktype in ("CM", "PM", "CFT", "REC", "OVERHAUL", "MoD", "General", "Routine")
    ],
)
def test_real_commit_precedes_each_post_and_one_reservation_blocks_other_probe(
    token_source, worktype
):
    async def scenario():
        async with setup() as (sessions, settings, user, connection):
            sent = []

            async def handler(request):
                if request.method == "GET":
                    return httpx.Response(
                        200, json={"member": [{"personid": "probe", "ct_discipline": "MECH"}]}
                    )
                # Independent pooled connection sees committed per-attempt intent.
                async with sessions() as db:
                    intent = await db.scalar(
                        select(AuditEvent)
                        .where(
                            AuditEvent.upload_item_id == probe.item_id,
                            AuditEvent.event == "contract_intent",
                        )
                        .order_by(AuditEvent.created_at.desc())
                    )
                    assert intent.details["attempt"] == request.headers["transactionid"]
                    assert intent.details["token_source"] == token_source
                    assert intent.details["operator_worktype"] == worktype
                    if token_source == "rowstamp_body_candidate":
                        import json

                        assert "if-match" not in request.headers
                        assert intent.details["precondition"]["channel"] == "json_body"
                        assert (
                            intent.details["precondition"]["value"]
                            == json.loads(request.content)["_rowstamp"]
                        )
                        assert set(intent.details["changes"]) == {"estdur"}
                    item = await db.get(UploadItem, probe.item_id)
                    assert item.state == "sending"
                sent.append(request)
                return httpx.Response(412)

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                probe = WriteContractProbe(
                    sessions,
                    settings,
                    client,
                    user.id,
                    connection.id,
                    "MECH",
                    "TEST",
                    "100",
                    token_source=token_source,
                    operator_worktype=worktype,
                )
                source = evidence().model_copy(
                    update={
                        "discipline": "MECH",
                        "worktype": worktype,
                        "baseline": evidence().baseline.model_copy(update={"worktype": worktype}),
                    }
                )
                if token_source != "advertised_etag":
                    source = source.model_copy(
                        update={"resource_etag": "0", "rowstamp_candidate": "100"}
                    )
                await probe.reserve(source)
                await probe.post(source, "101", source.baseline.estdur, "wrong_token")
                await probe.post(source, "101", source.baseline.estdur, "wrong_token_second")
                other = WriteContractProbe(
                    sessions, settings, client, user.id, connection.id, "MECH", "TEST", "100"
                )
                with pytest.raises(IntegrityError):
                    await other.reserve(source)
                assert len(sent) == 2
                async with sessions() as db:
                    assert (await db.get(UploadItem, probe.item_id)).state == "sending"

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.parametrize("case", ["no_session", "no_planner", "production", "person_changed"])
def test_real_authority_guard_prevents_any_mutation(case):
    async def scenario():
        async with setup(case) as (sessions, settings, user, connection):
            writes = []

            def handler(request):
                if request.method != "GET":
                    writes.append(request)
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            {
                                "personid": "probe",
                                "ct_discipline": "OTHER" if case == "person_changed" else "MECH",
                            }
                        ]
                    },
                )

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                probe = WriteContractProbe(
                    sessions, settings, client, user.id, connection.id, "MECH", "TEST", "100"
                )
                with pytest.raises(MaximoReadError):
                    await probe.reserve(evidence())
            assert not writes

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.parametrize("modified", [False, True])
def test_scoped_reconciliation_only_releases_exact_original_with_no_remote_write(modified):
    async def scenario():
        async with setup() as (sessions, settings, user, connection):
            calls = []
            source = evidence().model_copy(update={"discipline": "MECH"})
            source = source.model_copy(
                update={
                    "baseline": source.baseline.model_copy(
                        update={"targcompdate": datetime.fromisoformat("2026-09-30T23:59:59+07:00")}
                    )
                }
            )
            raw = record(
                href="https://maximo.invalid/maximo/oslc/os/oslcmxwodetail/_TEST",
                orgid="ORG",
                wonum="W100",
                bdpocdiscipline="MECH",
                estdur=2.25 if modified else 2,
                assignedtechname=None,
            )

            def handler(request):
                calls.append(request.method)
                assert request.method == "GET"
                if request.url.path.endswith("mxperson"):
                    return httpx.Response(
                        200, json={"member": [{"personid": "probe", "ct_discipline": "MECH"}]}
                    )
                if request.url.path.endswith("_TEST"):
                    return httpx.Response(200, json=raw, headers={"ETag": "102"})
                return httpx.Response(200, json={"member": [raw]})

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                probe = WriteContractProbe(
                    sessions, settings, client, user.id, connection.id, "MECH", "TEST", "100"
                )
                await probe.reserve(source)
                await probe.finish("unknown")
                result = await probe.reconcile(probe.item_id)
                assert result["reservation_released"] == (not modified)
                async with sessions() as db:
                    item = await db.get(UploadItem, probe.item_id)
                    assert item.state == ("unknown" if modified else "failed")
                    assert await db.scalar(
                        select(AuditEvent.id).where(
                            AuditEvent.upload_item_id == probe.item_id,
                            AuditEvent.event == "contract_reconcile",
                        )
                    )
            assert calls and set(calls) == {"GET"}

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_reconcile_refuses_sending_reservation_even_if_original_state_is_unchanged():
    async def scenario():
        async with setup() as (sessions, settings, user, connection):

            def handler(request):
                assert request.url.path.endswith("mxperson")
                return httpx.Response(
                    200, json={"member": [{"personid": "probe", "ct_discipline": "MECH"}]}
                )

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                probe = WriteContractProbe(
                    sessions, settings, client, user.id, connection.id, "MECH", "TEST", "100"
                )
                await probe.reserve(evidence().model_copy(update={"discipline": "MECH"}))
                with pytest.raises(MaximoReadError, match="reservation unavailable"):
                    await probe.reconcile(probe.item_id)
                async with sessions() as db:
                    assert (await db.get(UploadItem, probe.item_id)).state == "sending"

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
