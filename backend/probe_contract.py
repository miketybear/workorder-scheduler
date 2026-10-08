"""Trusted operator read-only CM contract probe; no writes, migrations or new grants."""

import argparse
import asyncio
import ssl
from uuid import UUID

import httpx
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.maximo.contract_probe import authorize_probe, probe_contract
from app.maximo.person import read_person_discipline
from app.maximo.reader import MaximoReadError


async def run(args):
    settings = Settings()
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        hide_parameters=True,
        connect_args={"connect_timeout": 3},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            config, authority = await authorize_probe(
                db, settings, args.user, args.connection, args.discipline, args.tenant, args.object
            )
        tls = (
            ssl.create_default_context(cafile=str(settings.maximo_ca_bundle))
            if settings.maximo_ca_bundle
            else True
        )
        async with httpx.AsyncClient(verify=tls, trust_env=False, follow_redirects=False) as client:
            if await read_person_discipline(client, config, authority.person_id) != args.discipline:
                raise MaximoReadError("Current PERSON discipline does not authorize probe scope")
            evidence = await probe_contract(
                client, config, args.site, args.workorder_id, args.discipline
            )
            if await read_person_discipline(client, config, authority.person_id) != args.discipline:
                raise MaximoReadError("PERSON scope changed during probe")
        async with sessions() as db:
            current_config, current_authority = await authorize_probe(
                db, settings, args.user, args.connection, args.discipline, args.tenant, args.object
            )
        if current_config != config or current_authority != authority:
            raise MaximoReadError("Contract probe authority changed during retrieval")
        print(
            '{"authority":'
            + authority.model_dump_json()
            + ',"evidence":'
            + evidence.model_dump_json()
            + "}"
        )
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("user", "tenant", "object", "connection"):
        parser.add_argument("--" + name, type=UUID, required=True)
    parser.add_argument("--discipline", required=True)
    parser.add_argument("--site", required=True)
    parser.add_argument("--workorder-id", required=True)
    args = parser.parse_args()
    try:
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(run(args))
    except MaximoReadError as error:
        parser.exit(1, str(error) + "\n")
    except SQLAlchemyError:
        parser.exit(1, "Contract probe database unavailable\n")


if __name__ == "__main__":
    main()
