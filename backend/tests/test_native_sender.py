import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from test_maximo import config
from test_write_contract_probe import evidence

from app.maximo.sender import NativeTestTransport, write_enabled
from app.scheduling.drafts import WorkOrderKey
from app.scheduling.upload_service import ConditionalConflict, UncertainWrite, WriteRejected


@pytest.mark.parametrize("worktype", ["UNKNOWN", "MOD", "general", "pm"])
def test_unsupported_contract_type_never_opens_native_application_sender(worktype):
    async def main():
        sent = []
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: sent.append(request))
        ) as client:
            key = WorkOrderKey(uuid4(), "TEST", "100")
            transport = NativeTestTransport(None, uuid4(), key.connection_id, "E&I", client)

            async def authorize():
                return config()

            transport.authorize = authorize
            source = evidence()
            transport.evidence[key] = source.model_copy(
                update={
                    "worktype": worktype,
                    "rowstamp_candidate": "100",
                    "baseline": source.baseline.model_copy(update={"worktype": worktype}),
                }
            )
            transport.attempt_id = uuid4()
            with pytest.raises(WriteRejected):
                await transport.write(key, "100", {"estdur": "3"})
            assert not sent

    asyncio.run(main())


@pytest.mark.parametrize("case", ["target", "clear", "mismatched-type", "revoked"])
@pytest.mark.parametrize("worktype", ["PM", "CFT"])
def test_pm_cft_transport_rejects_protected_payload_or_changed_authority(case, worktype):
    async def main():
        sent = []

        def handler(request):
            if request.method == "POST":
                sent.append(request)
            return httpx.Response(
                200,
                json={
                    "member": [{"persongroup": "CREW", "persongroupteam": [{"respparty": "VALID"}]}]
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            key = WorkOrderKey(uuid4(), "TEST", "100")
            transport = NativeTestTransport(None, uuid4(), key.connection_id, "E&I", client)
            calls = 0

            async def authorize():
                nonlocal calls
                calls += 1
                if case == "revoked" and calls == 2:
                    from fastapi import HTTPException

                    raise HTTPException(404, "Work order not found")
                return config(crew_groups={"E&I": "CREW"})

            transport.authorize = authorize
            source = evidence()
            transport.evidence[key] = source.model_copy(
                update={
                    "worktype": worktype,
                    "rowstamp_candidate": "100",
                    "baseline": source.baseline.model_copy(
                        update={"worktype": "CM" if case == "mismatched-type" else worktype}
                    ),
                }
            )
            transport.attempt_id = uuid4()
            changes = (
                {"targstartdate": "2026-10-10T00:00:00+07:00"}
                if case == "target"
                else {"assignedtechname": None}
                if case == "clear"
                else {"estdur": "3"}
            )
            with pytest.raises(WriteRejected):
                await transport.write(key, "100", changes)
            assert sent == []

    asyncio.run(main())


@pytest.mark.parametrize(
    "field,value",
    [
        ("environment", "production"),
        ("environment", "staging"),
        ("system", "offshore"),
        ("enabled", False),
        ("contract", None),
        ("app_environment", "production"),
        ("app_environment", "staging"),
    ],
)
def test_native_gate_only_explicit_approved_nonproduction_onshore_test(field, value):
    identifier = uuid4()
    connection = SimpleNamespace(id=identifier, system="onshore", environment="test", enabled=True)
    settings = SimpleNamespace(
        environment="development",
        maximo={identifier: config(conditional_write_contract="native_rowstamp_test")},
    )
    assert write_enabled(settings, connection)
    if field == "app_environment":
        settings.environment = value
    elif field == "contract":
        settings.maximo[identifier].conditional_write_contract = value
    elif field == "environment":
        connection.environment = value
    else:
        setattr(connection, field, value)
    assert not write_enabled(settings, connection)


@pytest.mark.parametrize("value", ["1e1000", "1.123456789123456789"])
def test_unserializable_duration_is_known_rejected_before_post(value):
    async def main():
        writes = []

        def handler(request):
            if request.method == "POST":
                writes.append(request)
            return httpx.Response(
                200,
                json={
                    "member": [{"persongroup": "CREW", "persongroupteam": [{"respparty": "VALID"}]}]
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            key = WorkOrderKey(uuid4(), "TEST", "100")
            transport = NativeTestTransport(None, uuid4(), key.connection_id, "E&I", client)

            async def authorize():
                return config(crew_groups={"E&I": "CREW"})

            transport.authorize = authorize
            transport.evidence[key] = evidence().model_copy(update={"rowstamp_candidate": "100"})
            transport.attempt_id = uuid4()
            with pytest.raises(WriteRejected):
                await transport.write(key, "100", {"estdur": value})
        assert writes == []

    asyncio.run(main())


@pytest.mark.parametrize(
    "status,code,mbo,expected",
    [
        (412, "BMXAA8229W", None, ConditionalConflict),
        (412, "BMXAA8229W", "INVRESERVE", UncertainWrite),
        (400, "BMXAA8229W", "WORKORDER", ConditionalConflict),
        (201, None, None, UncertainWrite),
        (403, None, None, WriteRejected),
    ],
)
def test_native_response_classification_never_proves_child_or_unexpected_success(
    status, code, mbo, expected
):
    async def main():
        def handler(request):
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            {"persongroup": "CREW", "persongroupteam": [{"respparty": "VALID"}]}
                        ]
                    },
                )
            return httpx.Response(
                status, json={"Error": {"reasonCode": code, "message": f"Record {mbo} : private"}}
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            key = WorkOrderKey(uuid4(), "TEST", "100")
            transport = NativeTestTransport(None, uuid4(), key.connection_id, "E&I", client)

            async def authorize():
                return config(crew_groups={"E&I": "CREW"})

            transport.authorize = authorize
            transport.evidence[key] = evidence().model_copy(update={"rowstamp_candidate": "100"})
            transport.attempt_id = uuid4()
            with pytest.raises(expected):
                await transport.write(key, "100", {"estdur": "3"})
            assert "private" not in str(transport.outcome)

    asyncio.run(main())
