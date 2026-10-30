import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select
from test_entra import entra_settings
from test_postgres import database, seed

from app.config import integration_settings
from app.db.models import AuthorizationEvent, MaximoConnection
from app.maximo.provision import ConnectionRequest, provision_connection, validated


def request(**overrides):
    return ConnectionRequest(
        **{
            "id": uuid4(),
            "system": "onshore",
            "environment": "production",
            "label": "Onshore",
            "base_url": "https://maximo.invalid/maximo/",
            "timezone": "Asia/Ho_Chi_Minh",
            **overrides,
        }
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"base_url": "http://maximo.invalid/maximo"},
        {"base_url": "https://user:secret@maximo.invalid/maximo"},
        {"base_url": "https://maximo.invalid/maximo?apikey=x"},
        {"timezone": "Mars/Base"},
    ],
)
def test_rejects_unsafe_urls_http_outside_test_and_unknown_zones(overrides):
    with pytest.raises(ValueError):
        validated(request(**overrides))


def test_http_is_allowed_only_for_test_and_trailing_slash_is_normalized():
    assert validated(request(environment="test", base_url="http://m.invalid/maximo/")).base_url == (
        "http://m.invalid/maximo"
    )


@pytest.mark.integration
def test_creates_once_with_audit_then_is_idempotent_and_refuses_changes():
    async def scenario():
        async with database() as sessions:
            user, _admin, _connections = await seed(sessions)
            settings = integration_settings()
            settings.entra = entra_settings().model_copy(update={"tenant_id": user.tenant_id})
            wanted = request()
            async with sessions.begin() as db:
                preview = await provision_connection(
                    db, settings, user.tenant_id, user.object_id, wanted, "reason", execute=False
                )
                assert preview["status"] == "dry-run"
                assert await db.get(MaximoConnection, wanted.id) is None
            async with sessions.begin() as db:
                created = await provision_connection(
                    db, settings, user.tenant_id, user.object_id, wanted, " staging setup "
                )
            assert created["status"] == "created"
            async with sessions.begin() as db:
                row = await db.get(MaximoConnection, wanted.id)
                assert row.base_url == "https://maximo.invalid/maximo"
                assert row.secret_reference == f"WOS_MAXIMO:{wanted.id}"
                assert row.enabled
                events = list(
                    await db.scalars(
                        select(AuthorizationEvent).where(
                            AuthorizationEvent.connection_id == wanted.id
                        )
                    )
                )
                assert [(e.actor_id, e.event, e.details["reason"]) for e in events] == [
                    (user.id, "connection_created", "staging setup")
                ]
                again = await provision_connection(
                    db, settings, user.tenant_id, user.object_id, wanted, "reason"
                )
                assert again["status"] == "unchanged"
                with pytest.raises(ValueError, match="different values"):
                    await provision_connection(
                        db,
                        settings,
                        user.tenant_id,
                        user.object_id,
                        wanted.model_copy(update={"label": "Other"}),
                        "reason",
                    )
                with pytest.raises(ValueError, match="already registered"):
                    await provision_connection(
                        db,
                        settings,
                        user.tenant_id,
                        user.object_id,
                        request(environment="test"),
                        "reason",
                    )
                with pytest.raises(ValueError, match="Actor"):
                    await provision_connection(
                        db, settings, user.tenant_id, uuid4(), request(system="offshore"), "r"
                    )
                with pytest.raises(ValueError, match="tenant"):
                    await provision_connection(
                        db, settings, uuid4(), user.object_id, request(system="offshore"), "r"
                    )

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
