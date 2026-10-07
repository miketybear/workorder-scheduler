"""Trusted operator: bootstrap the first existing Entra account as administrator."""

import argparse
import asyncio
from uuid import UUID

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.bootstrap import bootstrap_admin
from app.config import Settings


async def run(args):
    settings = Settings()
    engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    try:
        async with async_sessionmaker(engine).begin() as db:
            preview = await bootstrap_admin(
                db,
                settings,
                args.tenant,
                args.user_object,
                args.operator,
                args.reason,
                execute=args.execute,
            )
        print({"mode": "execute" if args.execute else "dry-run", "authority_change": preview})
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant", type=UUID, required=True)
    parser.add_argument("--user-object", type=UUID, required=True)
    parser.add_argument("--operator", required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument(
        "--execute", action="store_true", help="Commit authority and audit atomically"
    )
    args = parser.parse_args()
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(run(args))


if __name__ == "__main__":
    main()
