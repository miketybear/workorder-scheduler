"""Audited Onshore TEST conditional-duration probe; never a production upload path."""

import argparse
import asyncio
import json
import ssl
from uuid import UUID

import httpx
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.maximo.contract_probe import OPERATOR_WORKTYPES
from app.maximo.field_contract_probe import FieldContractProbe
from app.maximo.reader import MaximoReadError
from app.maximo.write_contract_probe import WriteContractProbe


async def run(args):
    settings = Settings()
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        hide_parameters=True,
        connect_args={"connect_timeout": 3},
    )
    try:
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        tls = (
            ssl.create_default_context(cafile=str(settings.maximo_ca_bundle))
            if settings.maximo_ca_bundle
            else True
        )
        async with httpx.AsyncClient(verify=tls, trust_env=False, follow_redirects=False) as client:
            probe_class = FieldContractProbe if args.field_contract else WriteContractProbe
            probe = probe_class(
                sessions,
                settings,
                client,
                args.user,
                args.connection,
                args.discipline,
                args.site,
                args.workorder_id,
                **({} if args.field_contract else {"token_source": args.token_source}),
                diagnostic_only=args.diagnostic_only,
                operator_worktype=args.operator_worktype,
            )
            if args.restore_field_duration_item:
                result = await probe.restore_field_item(
                    args.restore_field_duration_item, duration_phase=True
                )
            elif args.restore_field_item:
                result = await probe.restore_field_item(args.restore_field_item)
            elif args.reconcile_item:
                result = await probe.reconcile(args.reconcile_item)
            else:
                result = await probe.run()
            print(json.dumps({"upload_item_id": str(probe.item_id), **result}))
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("user", "connection"):
        parser.add_argument("--" + name, type=UUID, required=True)
    parser.add_argument("--discipline", required=True)
    parser.add_argument("--site", required=True)
    parser.add_argument("--workorder-id", required=True)
    recovery = parser.add_mutually_exclusive_group()
    recovery.add_argument(
        "--restore-field-item",
        type=UUID,
        help="One audited exact-original recovery of an owned stopped field probe",
    )
    recovery.add_argument(
        "--restore-field-duration-item",
        type=UUID,
        help="One duration-only phase after a known 204 exact-date field recovery",
    )
    parser.add_argument(
        "--operator-worktype",
        choices=sorted(OPERATOR_WORKTYPES),
        default="CM",
        help="Exact TEST WO type; non-CM is native-body duration-only, never an app gate",
    )
    parser.add_argument(
        "--field-contract",
        action="store_true",
        help="Audited TEST six-field contract and exact restoration",
    )
    parser.add_argument(
        "--diagnostic-only",
        action="store_true",
        help="One audited wrong-token no-op, safe MBO error classification, no positive mutation",
    )
    parser.add_argument(
        "--token-source",
        choices=["advertised_etag", "rowstamp_candidate", "rowstamp_body_candidate"],
        default="advertised_etag",
        help="Explicit TEST candidate; never automatic fallback",
    )
    parser.add_argument(
        "--reconcile-item",
        type=UUID,
        help="Remote reads only; release actor-owned probe if original state is exact",
    )
    args = parser.parse_args()
    if args.field_contract and args.diagnostic_only:
        parser.error("--field-contract cannot be combined with --diagnostic-only")
    if (args.restore_field_item or args.restore_field_duration_item) and (
        not args.field_contract or args.diagnostic_only or args.reconcile_item
    ):
        parser.error(
            "--restore-field-item requires --field-contract and excludes diagnostics/reconcile"
        )
    try:
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(run(args))
    except MaximoReadError as error:
        parser.exit(1, str(error) + "\n")
    except SQLAlchemyError:
        parser.exit(
            1, "Probe database error; inspect persisted reservation before any further write\n"
        )


if __name__ == "__main__":
    main()
