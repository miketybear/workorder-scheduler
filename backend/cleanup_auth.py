"""Count expired auth records; delete only with --execute. No business retention policy."""

import argparse
import asyncio
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.db.models import LoginFlow, LoginSession


async def cleanup_auth(db, *, execute=False, cutoff=None):
    cutoff = cutoff or datetime.now(UTC)
    if cutoff.tzinfo is None or cutoff > datetime.now(UTC):
        raise ValueError("Cleanup cutoff must be an aware instant no later than now")
    counts = {}
    for model in (LoginSession, LoginFlow):
        expired = model.expires_at <= cutoff
        if execute:
            result = await db.execute(delete(model).where(expired))
            counts[model.__tablename__] = result.rowcount
        else:
            counts[model.__tablename__] = await db.scalar(
                select(func.count()).select_from(model).where(expired)
            )
    return counts


async def run(args):
    settings = Settings()
    engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    try:
        async with async_sessionmaker(engine).begin() as db:
            counts = await cleanup_auth(db, execute=args.execute)
        print({"mode": "execute" if args.execute else "dry-run", "expired_auth_records": counts})
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(run(args))


if __name__ == "__main__":
    main()
