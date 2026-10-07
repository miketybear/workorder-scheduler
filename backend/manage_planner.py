"""Trusted database operator entrypoint; never grants administrative or Maximo access alone."""

import argparse
import asyncio
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.planner import PlannerChange, change_planner
from app.config import Settings
from app.db.models import User


async def run(args):
    settings = Settings()
    engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    try:
        async with async_sessionmaker(engine).begin() as db:
            actor = await db.scalar(
                select(User).where(
                    User.tenant_id == args.tenant,
                    User.object_id == args.actor_object,
                    User.active.is_(True),
                )
            )
            target = await db.scalar(
                select(User).where(
                    User.tenant_id == args.tenant,
                    User.object_id == args.user_object,
                )
            )
            if actor is None or target is None:
                raise ValueError("Actor and target must be existing Entra identities")
            changed = await change_planner(
                db,
                settings,
                actor.id,
                PlannerChange(
                    user_id=target.id,
                    connection_id=args.connection,
                    discipline=args.discipline,
                    enabled=args.action == "grant",
                    reason=args.reason,
                ),
                source="trusted_database_operator",
            )
        print("Planner permission updated with audit." if changed else "No permission change.")
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["grant", "revoke"])
    parser.add_argument("--tenant", type=UUID, required=True)
    parser.add_argument("--actor-object", type=UUID, required=True)
    parser.add_argument("--user-object", type=UUID, required=True)
    parser.add_argument("--connection", type=UUID, required=True)
    parser.add_argument("--discipline", required=True)
    parser.add_argument("--reason", required=True)
    args = parser.parse_args()
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(run(args))


if __name__ == "__main__":
    main()
