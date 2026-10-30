"""Trusted operator: register an approved Maximo connection in the database, with audit.

Run with the owner (migration) DSN; the runtime role cannot write maximo_connection.
The key and per-connection settings stay in WOS_MAXIMO under the same UUID.
"""

import argparse
import asyncio
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import MaximoSettings, Settings
from app.db.models import AuthorizationEvent, MaximoConnection, User


class ConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: UUID
    system: Literal["onshore", "offshore"]
    environment: Literal["test", "production"]
    label: str = Field(min_length=1, max_length=100)
    base_url: str = Field(max_length=500)
    timezone: str = Field(min_length=1, max_length=100)


def validated(request: ConnectionRequest) -> ConnectionRequest:
    base_url = request.base_url.rstrip("/")
    # Reuse the registry URL checks so the DB row can never point somewhere WOS_MAXIMO could not.
    MaximoSettings(
        base_url=base_url, api_key="unused", open_statuses=["unused"], allow_http_for_test=True
    )
    if base_url.startswith("http://") and request.environment != "test":
        raise ValueError("HTTP Maximo is allowed only for test connections")
    try:
        ZoneInfo(request.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown timezone") from None
    return request.model_copy(update={"base_url": base_url})


def same(row: MaximoConnection, request: ConnectionRequest) -> bool:
    return (
        row.system == request.system
        and row.environment == request.environment
        and row.label == request.label
        and row.base_url == request.base_url
        and row.timezone == request.timezone
        and row.enabled
    )


async def provision_connection(
    db,
    settings,
    tenant: UUID,
    actor_object: UUID,
    request: ConnectionRequest,
    reason: str,
    *,
    execute=True,
):
    reason = reason.strip()
    if not reason or len(reason) > 500:
        raise ValueError("A reason is required (500 characters maximum)")
    if not settings.entra or tenant != settings.entra.tenant_id:
        raise ValueError("Operator action requires the configured Entra tenant")
    request = validated(request)
    actor = await db.scalar(
        select(User).where(
            User.tenant_id == tenant, User.object_id == actor_object, User.active.is_(True)
        )
    )
    if actor is None:
        raise ValueError("Actor must be an existing active Entra identity (sign in once first)")
    existing = await db.get(MaximoConnection, request.id)
    if existing is not None:
        if not same(existing, request):
            raise ValueError("Connection exists with different values; nothing overwritten")
        return {"status": "unchanged", "connection_id": str(request.id)}
    taken = await db.scalar(
        select(MaximoConnection.id).where(
            MaximoConnection.system == request.system,
            MaximoConnection.environment == request.environment,
        )
    )
    if taken is not None:
        raise ValueError(f"{request.system}/{request.environment} is already registered as {taken}")
    preview = {"status": "created" if execute else "dry-run", **request.model_dump(mode="json")}
    if not execute:
        return preview
    db.add(
        MaximoConnection(
            id=request.id,
            system=request.system,
            environment=request.environment,
            label=request.label,
            base_url=request.base_url,
            timezone=request.timezone,
            secret_reference=f"WOS_MAXIMO:{request.id}",
            enabled=True,
        )
    )
    await db.flush()
    db.add(
        AuthorizationEvent(
            actor_id=actor.id,
            connection_id=request.id,
            event="connection_created",
            details={
                "system": request.system,
                "environment": request.environment,
                "base_url": request.base_url,
                "timezone": request.timezone,
                "reason": reason,
                "source": "trusted_database_operator",
            },
        )
    )
    await db.flush()
    return preview


async def run(args):
    settings = Settings()
    engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    request = ConnectionRequest(
        id=args.id,
        system=args.system,
        environment=args.environment,
        label=args.label,
        base_url=args.base_url,
        timezone=args.timezone,
    )
    try:
        async with async_sessionmaker(engine).begin() as db:
            result = await provision_connection(
                db,
                settings,
                args.tenant,
                args.actor_object,
                request,
                args.reason,
                execute=args.execute,
            )
        print(result)
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", type=UUID, required=True, help="Same UUID as the WOS_MAXIMO key")
    parser.add_argument("--system", choices=["onshore", "offshore"], required=True)
    parser.add_argument("--environment", choices=["test", "production"], required=True)
    parser.add_argument("--label", required=True, help="Name shown in Settings")
    parser.add_argument("--base-url", required=True, help="e.g. https://host/maximo")
    parser.add_argument("--timezone", default="Asia/Ho_Chi_Minh")
    parser.add_argument("--tenant", type=UUID, required=True)
    parser.add_argument("--actor-object", type=UUID, required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--execute", action="store_true", help="Write the row and audit")
    args = parser.parse_args()
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(run(args))


if __name__ == "__main__":
    main()
