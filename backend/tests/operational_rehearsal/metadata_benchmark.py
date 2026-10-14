"""Two synthetic Planner sessions, isolated PostgreSQL, read-only Maximo metadata."""

import argparse
import asyncio
import json
import ssl
from collections import Counter
from datetime import UTC, datetime
from math import ceil
from pathlib import Path
from statistics import median
from time import perf_counter
from uuid import uuid4

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import MaximoSettings, Settings, integration_settings
from app.db.models import AccessGrant, Base, MaximoConnection, PlannerPermission, User
from app.main import create_app
from app.maximo.contract_probe import authorize_probe
from app.maximo.person import read_person_discipline
from app.maximo.reader import MaximoReadError, query_parameters
from app.maximo.snapshots import SnapshotCache

ROOT = Path(__file__).resolve().parents[2]
DISCIPLINE = "E&I"


def month_range(month):
    year, number = map(int, month.split("-"))
    start = datetime.fromisoformat(f"{year:04d}-{number:02d}-01T00:00:00+07:00")
    end = datetime.fromisoformat(
        f"{year + (number == 12):04d}-{number % 12 + 1:02d}-01T00:00:00+07:00"
    )
    return start, end


def evidence_path(value):
    path = Path(value).resolve()
    if path.suffix != ".json" or not path.is_relative_to(ROOT.parent / "docs" / "evidence"):
        raise ValueError("Evidence must be JSON inside this repository's docs/evidence")
    if path.exists():
        raise ValueError("Use a new evidence filename")
    return path


class ReadClient(httpx.AsyncClient):
    def __init__(self, counters, **kwargs):
        self.counters = counters
        super().__init__(**kwargs)

    async def send(self, request, **kwargs):
        if request.method != "GET":
            raise ValueError("Benchmark upstream is read-only")
        if request.url.path.endswith("/mxperson"):
            kind = "person"
        elif "workorderid in [" in request.url.params.get("oslc.where", ""):
            kind = "scope_guard"
        else:
            kind = "metadata"
        self.counters[kind] += 1
        return await super().send(request, **kwargs)


async def live_configuration(counters):
    """Reads existing application identity/config only; never issues a live session or grant."""
    settings = Settings()
    engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    try:
        async with async_sessionmaker(engine)() as db:
            result = (
                await db.execute(
                    select(User, MaximoConnection)
                    .join(AccessGrant, AccessGrant.user_id == User.id)
                    .join(MaximoConnection, MaximoConnection.id == AccessGrant.connection_id)
                    .where(
                        User.active.is_(True),
                        AccessGrant.discipline == DISCIPLINE,
                        MaximoConnection.system == "onshore",
                        MaximoConnection.environment == "test",
                        MaximoConnection.enabled.is_(True),
                    )
                )
            ).first()
            if not result:
                raise MaximoReadError("No existing approved Onshore Test operator scope")
            user, connection = result
            config, authority = await authorize_probe(
                db, settings, user.id, connection.id, DISCIPLINE, user.tenant_id, user.object_id
            )
        tls = (
            ssl.create_default_context(cafile=str(settings.maximo_ca_bundle))
            if settings.maximo_ca_bundle
            else True
        )
        async with ReadClient(
            counters, verify=tls, trust_env=False, follow_redirects=False
        ) as client:
            if await read_person_discipline(client, config, authority.person_id) != DISCIPLINE:
                raise MaximoReadError("Live operator PERSON discipline does not authorize scope")
        return settings, config.model_copy(deep=True), authority, tls
    finally:
        await engine.dispose()


async def verify_live_authority(settings, config, authority, tls, counters):
    engine = create_async_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    try:
        async with async_sessionmaker(engine)() as db:
            current, identity = await authorize_probe(
                db,
                settings,
                authority.user_id,
                authority.connection_id,
                DISCIPLINE,
                authority.tenant_id,
                authority.object_id,
            )
        if current != config or identity != authority:
            raise MaximoReadError("Live operator authority changed during benchmark")
        async with ReadClient(
            counters, verify=tls, trust_env=False, follow_redirects=False
        ) as client:
            if await read_person_discipline(client, config, authority.person_id) != DISCIPLINE:
                raise MaximoReadError("Live operator PERSON scope changed during benchmark")
    finally:
        await engine.dispose()


async def choose_month(config, tls, counters):
    candidates = []
    async with ReadClient(counters, verify=tls, trust_env=False, follow_redirects=False) as client:
        for month in ("2026-09", "2026-10", "2026-11", "2026-12"):
            start, end = month_range(month)
            params = query_parameters(config, DISCIPLINE, start, end)
            params.update({"oslc.pageSize": "1", "oslc.select": "siteid,workorderid"})
            response = await client.get(
                config.collection_url,
                params=params,
                headers={"apikey": config.api_key.get_secret_value()},
            )
            if len(response.content) > config.max_page_bytes:
                raise MaximoReadError("Monthly count response exceeded limit")
            data = response.json() if response.status_code == 200 else {}
            count = data.get("responseInfo", {}).get("totalCount")
            candidates.append(
                dict(
                    month=month,
                    status=response.status_code,
                    total_count=count if type(count) is int and count >= 0 else None,
                )
            )
    known = [row for row in candidates if row["total_count"] is not None]
    if not known:
        raise MaximoReadError("No usable bounded monthly count metadata")
    selected = max(known, key=lambda row: row["total_count"])
    return selected["month"], candidates


def synthetic_config():
    return MaximoSettings(
        collection_url="https://metadata.invalid/maximo/oslc/os/oslcmxwodetail",
        api_key="synthetic",
        open_statuses=["APPR"],
        page_size=200,
        max_rows=5000,
    )


def synthetic_transport(count, month):
    start, _ = month_range(month)
    records = [
        dict(
            siteid="TEST",
            workorderid=i + 1,
            wonum=f"SYN-{i + 1:05d}",
            bdpocdiscipline=DISCIPLINE,
            worktype="CM",
            status="APPR",
            istask=False,
            parent=None,
            targcompdate=start.isoformat(),
            wopriority=i % 4 + 1,
            description="Synthetic metadata benchmark",
        )
        for i in range(count)
    ]

    def handler(request):
        where = request.url.params["oslc.where"]
        if "workorderid in [" in where:
            ids = {int(v) for v in where.split("workorderid in [")[1].split("]")[0].split(",")}
            rows = [row for row in records if row["workorderid"] in ids]
            return httpx.Response(200, json={"member": rows})
        size = int(request.url.params["oslc.pageSize"])
        page = int(request.url.params.get("pageno", "1"))
        rows = records[(page - 1) * size : page * size]
        info = {"totalCount": count}
        if page * size < count:
            info["nextPage"] = f"?pageno={page + 1}"
        return httpx.Response(200, json={"member": rows, "responseInfo": info})

    return httpx.MockTransport(handler)


def phase_summary(samples):
    values = [r["elapsed_ms"] for sample in samples for r in sample["requests"]]
    return dict(
        min_ms=round(min(values), 2),
        median_ms=round(median(values), 2),
        max_ms=round(max(values), 2),
        samples=samples,
    )


def verification(cold, warm_page, warm_search, row_count, page_size):
    phases = cold + warm_page + warm_search
    checks = {
        "all_statuses_200": all(r["status"] == 200 for s in phases for r in s["requests"]),
        "all_pairs_share_snapshot": all(s["same_snapshot"] for s in phases),
        "cold_singleflight_request_budget": all(
            s["upstream_requests"].get("metadata", 0) == ceil(row_count / page_size)
            and s["upstream_requests"].get("scope_guard", 0) == 2
            for s in cold
        ),
        "warm_no_metadata_reload": all(
            s["upstream_requests"].get("metadata", 0) == 0
            and s["upstream_requests"].get("scope_guard", 0) == 2
            for s in warm_page + warm_search
        ),
        "dense_twenty_row_pages_and_exact_totals": all(
            r["count"] == 20 and r["total_count"] == row_count
            for s in cold + warm_page
            for r in s["requests"]
        ),
        "selected_number_search_has_one_match": all(
            r["count"] == 1 and r["total_count"] == 1 for s in warm_search for r in s["requests"]
        ),
    }
    return checks | {"passed": all(checks.values())}


async def benchmark(config, month, *, tls=True, transport=None, authorize_stage=None):
    integration = integration_settings()  # Only isolated 127.0.0.1:55432/scheduler_test allowed.
    engine = create_async_engine(integration.database_url.get_secret_value(), hide_parameters=True)
    schema = "metadata_bench_" + uuid4().hex
    counters = Counter()
    try:
        async with engine.begin() as db:
            await db.execute(text(f'CREATE SCHEMA "{schema}"'))
            isolated = await db.execution_options(schema_translate_map={None: schema})
            await isolated.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(
            engine.execution_options(schema_translate_map={None: schema}), expire_on_commit=False
        )
        connection_id, tenant_id = uuid4(), uuid4()
        # Generated identities have explicit test grants; no real Entra callback is exercised.
        local_config = config.model_copy(update={"person_login_domain": None}, deep=True)
        app_settings = integration.model_copy(
            update={"entra": None, "maximo": {connection_id: local_config}}
        )
        async with sessions.begin() as db:
            db.add(
                MaximoConnection(
                    id=connection_id,
                    system="onshore",
                    environment="test",
                    label="Synthetic benchmark connection",
                    timezone="Asia/Ho_Chi_Minh",
                    base_url=config.collection_url.rsplit("/oslc/os/", 1)[0],
                    secret_reference="benchmark-memory-only",
                    enabled=True,
                )
            )
            users = [
                User(tenant_id=tenant_id, object_id=uuid4(), display_name=f"Synthetic Planner {i}")
                for i in (1, 2)
            ]
            db.add_all(users)
            await db.flush()
            tokens = []
            for user in users:
                db.add(
                    AccessGrant(
                        user_id=user.id,
                        connection_id=connection_id,
                        discipline=DISCIPLINE,
                        capability="write",
                    )
                )
                db.add(
                    PlannerPermission(
                        user_id=user.id, connection_id=connection_id, discipline=DISCIPLINE
                    )
                )
                token, _ = await issue_session(db, user)
                tokens.append(token)
        app = create_app(app_settings)
        app.state.sessions = sessions
        app.state.maximo_client_factory = lambda: ReadClient(
            counters, verify=tls, transport=transport, trust_env=False, follow_redirects=False
        )
        start, end = month_range(month)
        params = dict(
            connection_id=str(connection_id),
            discipline=DISCIPLINE,
            target_from=start.isoformat(),
            target_before=end.isoformat(),
            view="all",
        )
        clients = [
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://benchmark.invalid"
            )
            for _ in (1, 2)
        ]
        for client, token in zip(clients, tokens, strict=True):
            client.cookies.set(SESSION_COOKIE, token)

        async def pair(queries):
            before = counters.copy()
            gate = asyncio.Event()

            async def fetch(index):
                await gate.wait()
                started = perf_counter()
                response = await clients[index].get(
                    "/api/work-orders/page", params={**params, **queries[index]}
                )
                elapsed = round((perf_counter() - started) * 1000, 2)
                data = response.json()
                return data, dict(
                    planner="A" if index == 0 else "B",
                    status=response.status_code,
                    elapsed_ms=elapsed,
                    count=data.get("count"),
                    total_count=data.get("total_count"),
                )

            tasks = [asyncio.create_task(fetch(index)) for index in (0, 1)]
            gate.set()
            results = await asyncio.gather(*tasks)
            bodies = [r[0] for r in results]
            sample = dict(
                requests=[r[1] for r in results],
                upstream_requests=dict(counters - before),
                same_snapshot=bool(bodies[0].get("snapshot_id"))
                and bodies[0].get("snapshot_id") == bodies[1].get("snapshot_id"),
            )
            return bodies, sample

        try:

            async def check_stage():
                if authorize_stage:
                    await authorize_stage()

            await check_stage()
            cold = []
            for _ in range(3):
                await app.state.work_order_snapshots.close()
                app.state.work_order_snapshots = SnapshotCache(
                    app_settings.work_order_snapshot_ttl_seconds,
                    app_settings.work_order_snapshot_max_entries,
                    app_settings.work_order_snapshot_max_rows,
                    app_settings.work_order_snapshot_max_bytes,
                )
                initial, sample = await pair([{}, {}])
                cold.append(sample)
            await check_stage()
            if any(r["status"] != 200 for sample in cold for r in sample["requests"]):
                return dict(
                    month=month,
                    cold=phase_summary(cold),
                    status="cold_failed",
                    verification={"passed": False},
                )
            warm_page, warm_search = [], []
            cursors = [body.get("next_cursor") for body in initial]
            searches = [
                body["items"][0]["wonum"] if body.get("items") else "NO_MATCH" for body in initial
            ]
            await check_stage()
            for _ in range(5):
                _, sample = await pair(
                    [dict(cursor=cursor) if cursor else {} for cursor in cursors]
                )
                warm_page.append(sample)
            await check_stage()
            await check_stage()
            for _ in range(5):
                _, sample = await pair([dict(search=search) for search in searches])
                warm_search.append(sample)
            await check_stage()
            checks = verification(
                cold, warm_page, warm_search, initial[0]["total_count"], config.page_size
            )
            return dict(
                month=month,
                status="verified" if checks["passed"] else "verification_failed",
                metadata_rows=initial[0]["total_count"],
                cold=phase_summary(cold),
                warm_page=phase_summary(warm_page),
                warm_search=phase_summary(warm_search),
                upstream_total=dict(counters),
                verification=checks,
                live_authority_rechecked_before_after_each_stage=authorize_stage is not None,
            )
        finally:
            for client in clients:
                await client.aclose()
            await app.state.work_order_snapshots.close()
    finally:
        async with engine.begin() as db:
            await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()


async def run(output):
    report = dict(
        recorded_at=datetime.now(UTC).isoformat(),
        method="Actual FastAPI route via ASGITransport",
        authentication="Two generated database-backed Planner sessions; not genuine Entra accounts",
        safety="Isolated guarded scheduler_test schema; live app DB read-only; Maximo GET only",
        sampling="3 cold pairs, 5 warm page pairs, 5 warm search pairs; no percentile/SLO claim",
        limitations=[
            "ASGI transport excludes browser/network-server/Entra login latency",
            "Synthetic grants in isolated DB; live operator PERSON separately verified",
        ],
    )
    authority_counts = Counter()
    try:
        settings, config, authority, tls = await live_configuration(authority_counts)
        month, candidates = await choose_month(config, tls, authority_counts)
        report["month_counts"] = candidates

        async def authorize_stage():
            await verify_live_authority(settings, config, authority, tls, authority_counts)

        report["live_onshore_test"] = await benchmark(
            config, month, tls=tls, authorize_stage=authorize_stage
        )
        await verify_live_authority(settings, config, authority, tls, authority_counts)
        report["authority_and_count_probe_requests"] = dict(authority_counts)
        report["live_scope_verified_before_and_after"] = True
    except (MaximoReadError, httpx.HTTPError, ValueError) as error:
        report["live_unavailable"] = type(error).__name__
        report["live_scope_verified_before_and_after"] = False
    live_count = report.get("live_onshore_test", {}).get("metadata_rows", 0)
    if live_count < 500:
        report["synthetic_5000"] = await benchmark(
            synthetic_config(), "2026-10", transport=synthetic_transport(5000, "2026-10")
        )
        report["limitations"].append(
            "Synthetic 5000-WO stress: in-process MockTransport; no artificial network delay"
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if any(
        not report[key]["verification"]["passed"]
        for key in ("live_onshore_test", "synthetic_5000")
        if key in report
    ):
        raise RuntimeError("Benchmark verification failed; inspect safe evidence")
    print(
        json.dumps(
            {
                "evidence": str(output),
                "live_rows": live_count,
                "synthetic_stress": "synthetic_5000" in report,
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=evidence_path)
    args = parser.parse_args()
    try:
        asyncio.run(run(args.output), loop_factory=asyncio.SelectorEventLoop)
    except Exception as error:
        print(
            json.dumps(
                {
                    "error_type": type(error).__name__,
                    "detail": "Benchmark failed; raw data and credentials withheld",
                }
            )
        )
        raise SystemExit(1) from None
