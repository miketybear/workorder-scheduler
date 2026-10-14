"""Opt-in disposable Docker/PostgreSQL HTTP operational rehearsal, no live Maximo."""

import asyncio
import json
import math
import subprocess
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT.parent / ".cache" / "operational-rehearsal"
RUN = uuid4().hex
NETWORK = f"wos-rehearsal-{RUN}"
PG = f"{NETWORK}-pg"
API = f"{NETWORK}-api"
DATABASE = f"rehearsal_{RUN}"
PORT = 58039
REPORT = CACHE / f"report-{RUN}.json"
CONFIG = CACHE / f"private-{RUN}.json"
IMAGE = "workorder-scheduler-backend:local-check"
PG_IMAGE = (
    "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"
)


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, check=False)
    if check and result.returncode:
        raise RuntimeError(f"Docker {args[0]} failed (exit {result.returncode})")
    return result.stdout.strip()


def api_start():
    return docker(
        "run",
        "-d",
        "--name",
        API,
        "--network",
        NETWORK,
        "-p",
        f"127.0.0.1:{PORT}:8000",
        "--mount",
        f"type=bind,src={ROOT},dst=/src,readonly",
        "--mount",
        f"type=bind,src={CACHE},dst=/evidence",
        "-w",
        "/src",
        "-e",
        "PYTHONPATH=/src",
        IMAGE,
        "python",
        "tests/operational_rehearsal/runner.py",
        f"/evidence/{CONFIG.name}",
    )


async def ready(client):
    for _ in range(100):
        try:
            if (await client.get("/api/health/ready")).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        await asyncio.sleep(0.2)
    raise RuntimeError("Runner did not become ready")


def percentile(values, p):
    return sorted(values)[max(0, math.ceil(len(values) * p) - 1)]


async def scenario(data, report):
    samples = report["requests"]
    base = f"http://127.0.0.1:{PORT}"
    clients = [httpx.AsyncClient(base_url=base, timeout=60, trust_env=False) for _ in range(11)]
    control = httpx.AsyncClient(base_url=base, timeout=10, trust_env=False)
    users = data["users"]
    actors = [*users, {**users[0], **data["same_actor_session"]}]

    async def request(i, phase, method, url, expected, **kwargs):
        actor = actors[i]
        headers = {"Cookie": f"__Host-wos-session={actor['token']}", "X-CSRF-Token": actor["csrf"]}
        start = time.perf_counter()
        response = await clients[i].request(method, url, headers=headers, **kwargs)
        samples.append(
            dict(
                phase=phase,
                actor=i,
                method=method,
                status=response.status_code,
                elapsed_ms=round((time.perf_counter() - start) * 1000, 3),
                expected=response.status_code in expected,
            )
        )
        assert response.status_code in expected, (phase, response.status_code)
        return response

    def scope(i):
        return {k: users[i][k] for k in ("connection_id", "discipline")}

    async def counts(request_id=None):
        sql = (
            "SELECT json_build_object('drafts',(SELECT count(*) FROM draft),'items',"
            "(SELECT count(*) FROM draft_item),'receipts',(SELECT count(*) FROM draft_submission))"
        )
        if request_id:
            sql = f"SELECT count(*) FROM draft_submission WHERE request_id='{request_id}'"
        raw = await asyncio.to_thread(
            docker, "exec", PG, "psql", "-U", "rehearsal", "-d", DATABASE, "-Atc", sql
        )
        return json.loads(raw)

    async def knob(**changes):
        response = await control.post("/__rehearsal/control", json=changes)
        response.raise_for_status()
        return response.json()

    async def overlap(before, minimum=1):
        for _ in range(100):
            state = (await control.get("/__rehearsal/state")).json()
            if state["entered"] >= before + minimum and state["active"] >= minimum:
                return state
            await asyncio.sleep(0.02)
        raise RuntimeError("Upstream barrier not reached")

    try:
        await ready(control)
        for i in range(10):
            await request(i, "warmup", "GET", "/api/auth/session", {200})
        singles, batches, edits_by_actor = [], [], []
        for round_no in range(3):
            prefix = f"load_round_{round_no + 1}"
            responses = await asyncio.gather(
                *[
                    request(
                        i,
                        prefix + "_retrieve",
                        "GET",
                        "/api/work-orders",
                        {200},
                        params={
                            **scope(i),
                            "target_from": "2026-09-01T00:00:00+07:00",
                            "target_before": "2026-10-01T00:00:00+07:00",
                        },
                    )
                    for i in range(10)
                ]
            )
            assert all(r.json()["count"] == 200 for r in responses)
            details = await asyncio.gather(
                *[
                    request(
                        i,
                        prefix + "_open",
                        "GET",
                        "/api/work-orders/detail",
                        {200},
                        params={**scope(i), "site_id": "TEST", "workorder_id": "1000"},
                    )
                    for i in range(10)
                ]
            )
            single_payloads = [
                {
                    **scope(i),
                    "site_id": "TEST",
                    "workorder_id": "1000",
                    "baseline_token": details[i].json()["baseline_token"],
                    "changes": {"estdur": "9"},
                    "request_id": str(uuid4()),
                }
                for i in range(10)
            ]
            created = await asyncio.gather(
                *[
                    request(
                        i,
                        prefix + "_single_save",
                        "POST",
                        "/api/drafts",
                        {201},
                        json=single_payloads[i],
                    )
                    for i in range(10)
                ]
            )
            singles = [r.json() for r in created]
            keys = [{"site_id": "TEST", "workorder_id": str(i)} for i in range(1000, 1200)]
            prepared = await asyncio.gather(
                *[
                    request(
                        i,
                        prefix + "_prepare200",
                        "POST",
                        "/api/draft-batches/prepare",
                        {200},
                        json={**scope(i), "items": keys},
                    )
                    for i in range(10)
                ]
            )
            edits_by_actor = [
                [
                    {**key, "baseline_token": item["baseline_token"], "changes": {"estdur": "9"}}
                    for key, item in zip(keys, r.json()["items"], strict=True)
                ]
                for r in prepared
            ]
            created = await asyncio.gather(
                *[
                    request(
                        i,
                        prefix + "_batch_save200",
                        "POST",
                        "/api/draft-batches",
                        {201},
                        json={**scope(i), "items": edits_by_actor[i], "request_id": str(uuid4())},
                    )
                    for i in range(10)
                ]
            )
            batches = [r.json() for r in created]
            await asyncio.gather(
                *[
                    request(
                        i,
                        prefix + "_batch_restore200",
                        "GET",
                        "/api/draft-batches/" + batches[i]["draft_id"],
                        {200},
                    )
                    for i in range(10)
                ]
            )
            changed = await asyncio.gather(
                *[
                    request(
                        i,
                        prefix + "_batch_update200",
                        "PUT",
                        "/api/draft-batches/" + batches[i]["draft_id"],
                        {200},
                        json={
                            **scope(i),
                            "items": [
                                {**e, "changes": {"estdur": "10"}} for e in edits_by_actor[i]
                            ],
                            "version": 1,
                            "request_id": str(uuid4()),
                        },
                    )
                    for i in range(10)
                ]
            )
            assert all(r.json()["version"] == 2 for r in changed)
            await asyncio.gather(
                *[
                    request(i, prefix + "_status", "GET", "/api/drafts", {200}, params=scope(i))
                    for i in range(10)
                ]
            )
            expanded = await asyncio.gather(
                *[
                    request(
                        i,
                        prefix + "_status_expanded",
                        "GET",
                        "/api/drafts",
                        {200},
                        params={**scope(i), "include_items": "true"},
                    )
                    for i in range(10)
                ]
            )
            for result in expanded:
                drafts = result.json()["items"]
                assert len(drafts) == 2 * (round_no + 1)
                assert sorted(len(draft["items"]) for draft in drafts) == (
                    [1] * (round_no + 1) + [200] * (round_no + 1)
                )
            report["completed_load_rounds"] = round_no + 1

        # Ownership and mandatory scope; identical WO IDs exist on both connections.
        await request(2, "wrong_owner", "GET", "/api/drafts/" + singles[0]["draft_id"], {404})
        await request(
            0,
            "wrong_connection",
            "GET",
            "/api/work-orders/detail",
            {404},
            params={**scope(1), "site_id": "TEST", "workorder_id": "1000"},
        )
        await request(
            0,
            "wrong_discipline",
            "GET",
            "/api/work-orders/detail",
            {404},
            params={**scope(0), "discipline": "OTHER", "site_id": "TEST", "workorder_id": "1000"},
        )
        await request(0, "unknown_draft", "GET", "/api/drafts/" + str(uuid4()), {404})
        await knob(moved=True)
        await request(0, "moved_upstream", "GET", "/api/drafts/" + singles[0]["draft_id"], {502})
        await knob(moved=False)

        # Same identity, two independent authenticated DB sessions, held upstream overlap.
        detail = await request(
            0,
            "race_baseline",
            "GET",
            "/api/work-orders/detail",
            {200},
            params={**scope(0), "site_id": "TEST", "workorder_id": "1000"},
        )
        edit = {
            **scope(0),
            "site_id": "TEST",
            "workorder_id": "1000",
            "baseline_token": detail.json()["baseline_token"],
            "changes": {"estdur": "12"},
        }
        await request(
            2,
            "wrong_owner_update",
            "PUT",
            "/api/drafts/" + singles[0]["draft_id"],
            {404},
            json={**edit, "version": 1, "request_id": str(uuid4())},
        )
        state = await knob(hold=True)
        race = [
            asyncio.create_task(
                request(
                    i,
                    "version_race",
                    "PUT",
                    "/api/drafts/" + singles[0]["draft_id"],
                    {200, 409},
                    json={**edit, "version": 1, "request_id": str(uuid4())},
                )
            )
            for i in (0, 10)
        ]
        await overlap(state["entered"], 2)
        await knob(hold=False)
        responses = await asyncio.gather(*race)
        assert sorted(r.status_code for r in responses) == [200, 409]
        report["version_race"] = [r.status_code for r in responses]
        duplicate_id = str(uuid4())
        state = await knob(hold=True)
        duplicate = [
            asyncio.create_task(
                request(
                    i,
                    "duplicate_race",
                    "POST",
                    "/api/drafts",
                    {201},
                    json={**edit, "request_id": duplicate_id},
                )
            )
            for i in (0, 10)
        ]
        await overlap(state["entered"], 2)
        await knob(hold=False)
        responses = await asyncio.gather(*duplicate)
        assert responses[0].json() == responses[1].json()
        assert await counts(duplicate_id) == 1
        report["duplicate_race"] = dict(equal_responses=True, persisted_receipts=1)

        # Whole-request timeout must cancel all held upstream children before any receipt.
        timeout_id = str(uuid4())
        before = await counts()
        state = await knob(hold=True, deadline=1)
        await request(
            0,
            "deadline_cancel",
            "POST",
            "/api/draft-batches",
            {504},
            json={**scope(0), "items": edits_by_actor[0], "request_id": timeout_id},
        )
        after_timeout = (await control.get("/__rehearsal/state")).json()
        await knob(hold=False, deadline=180)
        await asyncio.sleep(0.2)
        assert before == await counts() and await counts(timeout_id) == 0
        assert after_timeout["active"] == 0 and after_timeout["cancelled"] >= 4
        report["timeout"] = dict(
            status=504,
            counts_unchanged=True,
            receipt=0,
            active=after_timeout["active"],
            cancelled=after_timeout["cancelled"],
        )

        # Stop only UUID-owned PG, demonstrate 503 and recovery against same runner.
        await asyncio.to_thread(docker, "stop", "-t", "3", PG)
        await request(0, "database_outage", "GET", "/api/auth/session", {503})
        await asyncio.to_thread(docker, "start", PG)
        await ready(control)
        await request(0, "database_recovered", "GET", "/api/auth/session", {200})
        report["database_outage"] = dict(status=503, recovered=True)

        old_id = docker("inspect", "--format", "{{.Id}}", API)
        await asyncio.to_thread(docker, "stop", "-t", "10", API)
        docker("rm", API)
        new_id = api_start()
        await ready(control)
        await request(0, "restart_session", "GET", "/api/auth/session", {200})
        restored = await request(
            0, "restart_draft", "GET", "/api/draft-batches/" + batches[0]["draft_id"], {200}
        )
        assert restored.json()["version"] == 2 and len(restored.json()["items"]) == 200
        report["restart"] = dict(
            distinct_process_containers=old_id != new_id,
            session_restored=True,
            draft_version=2,
            draft_items=200,
        )
        before_replay = await counts()
        replay = await request(
            0,
            "duplicate_after_restart",
            "POST",
            "/api/drafts",
            {201},
            json={**edit, "request_id": duplicate_id},
        )
        assert replay.json() == responses[0].json() and await counts() == before_replay
        report["duplicate_after_restart"] = dict(exact_result=True, counts_unchanged=True)

        # Genuine Linux SIGTERM: admitted mutation drains and commits before process exit.
        drain_id = str(uuid4())
        state = await knob(delay=2)
        task = asyncio.create_task(
            request(
                0,
                "sigterm_drain",
                "POST",
                "/api/drafts",
                {201},
                json={**edit, "request_id": drain_id},
            )
        )
        await overlap(state["entered"])
        await asyncio.to_thread(docker, "kill", "--signal=SIGTERM", API)
        response = await task
        await asyncio.to_thread(docker, "wait", API)
        exit_code = docker("inspect", "--format", "{{.State.ExitCode}}", API)
        docker("rm", API)
        api_start()
        await ready(control)
        restored = await request(
            0, "drain_after_restart", "GET", "/api/drafts/" + response.json()["draft_id"], {200}
        )
        assert await counts(drain_id) == 1
        report["sigterm_drain"] = dict(
            response=201,
            exit_code=int(exit_code),
            receipt=1,
            restored_version=restored.json()["version"],
        )

        # Hold beyond Uvicorn's five-second grace; no commit or durable receipt allowed.
        cancel_id = str(uuid4())
        before = await counts()
        state = await knob(hold=True)
        start = time.perf_counter()
        task = asyncio.create_task(
            clients[0].post(
                "/api/drafts",
                json={**edit, "request_id": cancel_id},
                headers={
                    "Cookie": f"__Host-wos-session={users[0]['token']}",
                    "X-CSRF-Token": users[0]["csrf"],
                },
            )
        )
        await overlap(state["entered"])
        await asyncio.to_thread(docker, "kill", "--signal=SIGTERM", API)
        try:
            response = await task
            outcome = str(response.status_code)
        except httpx.HTTPError as error:
            outcome = type(error).__name__
        await asyncio.to_thread(docker, "wait", API)
        logs = docker("logs", API, check=False)
        elapsed = time.perf_counter() - start
        docker("rm", API)
        api_start()
        await ready(control)
        assert before == await counts() and await counts(cancel_id) == 0
        report["sigterm_grace_expiry"] = dict(
            client_outcome=outcome,
            elapsed_seconds=round(elapsed, 3),
            counts_unchanged=True,
            receipt=0,
            graceful_timeout_seconds=5,
            logs_contain_cancel="Cancel" in logs,
        )
        # Commit succeeds but the response is withheld; kill process before client receives it.
        lost_id = str(uuid4())
        await knob(response_hold=True)
        task = asyncio.create_task(
            clients[0].post(
                "/api/drafts",
                json={**edit, "request_id": lost_id},
                headers={
                    "Cookie": f"__Host-wos-session={users[0]['token']}",
                    "X-CSRF-Token": users[0]["csrf"],
                },
            )
        )
        for _ in range(200):
            if (await control.get("/__rehearsal/state")).json()["response_waiting"] == 1:
                break
            await asyncio.sleep(0.02)
        else:
            raise RuntimeError("Committed-response barrier not reached")
        assert await counts(lost_id) == 1
        persisted = json.loads(
            docker(
                "exec",
                PG,
                "psql",
                "-U",
                "rehearsal",
                "-d",
                DATABASE,
                "-Atc",
                f"SELECT result FROM draft_submission WHERE request_id='{lost_id}'",
            )
        )
        before_lost_replay = await counts()
        await asyncio.to_thread(docker, "kill", "--signal=SIGKILL", API)
        try:
            response = await task
            lost_outcome = str(response.status_code)
        except httpx.HTTPError as error:
            lost_outcome = type(error).__name__
        docker("rm", API)
        api_start()
        await ready(control)
        replay = await request(
            0,
            "lost_response_replay",
            "POST",
            "/api/drafts",
            {201},
            json={**edit, "request_id": lost_id},
        )
        assert replay.json() == persisted and await counts() == before_lost_replay
        report["commit_response_loss"] = dict(
            client_outcome=lost_outcome,
            committed_receipt_before_kill=1,
            replay_exact=True,
            counts_unchanged=True,
        )
        report["final_counts"] = await counts()
        report["fake_upstream_state_last_process"] = (
            await control.get("/__rehearsal/state")
        ).json()
        report["result"] = "passed"
    finally:
        for client in [*clients, control]:
            await client.aclose()


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    report = dict(
        run_id=RUN,
        started_at=datetime.now(UTC).isoformat(),
        result="incomplete",
        requests=[],
        completed_load_rounds=0,
        methodology=dict(
            distinct_identities=10,
            load_clients=10,
            measured_rounds=3,
            warmup="10 sequential auth-session requests excluded",
            mock_wo_delay_ms=5,
            scope_contexts=10,
            connections=2,
            wo_per_client=200,
            parallelism="10 HTTP requests per phase; per-batch upstream semaphore 4",
            authentication=(
                "real committed DB sessions, manual Cookie + CSRF over isolated loopback HTTP; "
                "Entra callback/TLS/browser not exercised"
            ),
            request_budget_seconds=180,
            graceful_shutdown_seconds=5,
            image=IMAGE,
            postgres_image=PG_IMAGE,
            no_live_maximo=True,
        ),
    )
    created_pg = created_network = False
    try:
        docker("network", "create", NETWORK)
        created_network = True
        docker(
            "run",
            "-d",
            "--name",
            PG,
            "--network",
            NETWORK,
            "--network-alias",
            "pg",
            "-p",
            "127.0.0.1:55439:5432",
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            "-e",
            "POSTGRES_USER=rehearsal",
            "-e",
            "POSTGRES_DB=scheduler_test",
            PG_IMAGE,
        )
        created_pg = True
        for _ in range(100):
            result = subprocess.run(
                ["docker", "exec", PG, "pg_isready", "-U", "rehearsal"], capture_output=True
            )
            if result.returncode == 0:
                break
            time.sleep(0.2)
        docker("exec", PG, "createdb", "-U", "rehearsal", DATABASE)
        data = dict(
            run_id=RUN,
            database_url=f"postgresql+psycopg://rehearsal:synthetic@pg:5432/{DATABASE}",
            tenant_id=str(uuid4()),
            connections=[
                dict(id=str(uuid4()), system=s, host=f"{s}.invalid")
                for s in ("onshore", "offshore")
            ],
        )
        CONFIG.write_text(json.dumps(data), encoding="utf-8")
        common = [
            "-e",
            "PYTHONPATH=/src",
            "--rm",
            "--network",
            NETWORK,
            "--mount",
            f"type=bind,src={ROOT},dst=/src,readonly",
            "--mount",
            f"type=bind,src={CACHE},dst=/evidence",
            "-w",
            "/src",
        ]
        docker(
            "run",
            *common,
            "-e",
            "WOS_ENVIRONMENT=test",
            "-e",
            "WOS_DATABASE_URL=" + data["database_url"],
            IMAGE,
            "alembic",
            "upgrade",
            "head",
        )
        docker(
            "run",
            *common,
            IMAGE,
            "python",
            "tests/operational_rehearsal/runner.py",
            f"/evidence/{CONFIG.name}",
            "seed",
        )
        data = json.loads(CONFIG.read_text(encoding="utf-8"))
        report["versions"] = json.loads(
            docker(
                "run",
                *common,
                IMAGE,
                "python",
                "-c",
                "import sys,json,importlib.metadata as m; print(json.dumps({'python':sys.version,"
                "**{n:m.version(n) for n in "
                "['fastapi','uvicorn','sqlalchemy','psycopg','httpx']}}))",
            )
        )
        report["versions"]["postgres"] = docker(
            "exec", PG, "psql", "-U", "rehearsal", "-d", DATABASE, "-Atc", "SELECT version()"
        )
        api_start()
        report["platform"] = json.loads(
            docker(
                "info",
                "--format",
                '{"os":"{{.OperatingSystem}}","kernel":"{{.KernelVersion}}",'
                '"cpu_count":{{.NCPU}},"memory_bytes":{{.MemTotal}},'
                '"docker_version":"{{.ServerVersion}}"}',
            )
        )
        report["container_limits"] = json.loads(
            docker(
                "inspect",
                "--format",
                '{"memory":{{.HostConfig.Memory}},'
                '"nano_cpus":{{.HostConfig.NanoCpus}},"cpu_quota":{{.HostConfig.CpuQuota}}}',
                API,
            )
        )
        report["methodology"]["db_pool"] = (
            "SQLAlchemy defaults pool_size=5/max_overflow=10; pool_pre_ping=True"
        )
        asyncio.run(scenario(data, report), loop_factory=asyncio.SelectorEventLoop)
    except Exception as error:
        report["result"] = "failed"
        report["error"] = dict(
            type=type(error).__name__,
            phase=(report["requests"][-1]["phase"] if report["requests"] else "setup"),
        )
    finally:
        grouped = {}
        for sample in report["requests"]:
            phase = sample["phase"]
            grouped.setdefault(phase, []).append(sample)
        report["summary"] = {
            phase: dict(
                count=len(rows),
                p50_ms=percentile([r["elapsed_ms"] for r in rows], 0.5),
                p95_ms=percentile([r["elapsed_ms"] for r in rows], 0.95),
                max_ms=max(r["elapsed_ms"] for r in rows),
                statuses=dict(Counter(str(r["status"]) for r in rows)),
                unexpected=sum(not r["expected"] for r in rows),
            )
            for phase, rows in grouped.items()
        }
        report["load_aggregate"] = {}
        for phase in {key.split("_", 3)[3] for key in grouped if key.startswith("load_round_")}:
            rows = [
                row
                for key, values in grouped.items()
                if key.startswith("load_round_") and key.split("_", 3)[3] == phase
                for row in values
            ]
            report["load_aggregate"][phase] = dict(
                count=len(rows),
                p50_ms=percentile([row["elapsed_ms"] for row in rows], 0.5),
                p95_ms=percentile([row["elapsed_ms"] for row in rows], 0.95),
                max_ms=max(row["elapsed_ms"] for row in rows),
                statuses=dict(Counter(str(row["status"]) for row in rows)),
            )
        report["ended_at"] = datetime.now(UTC).isoformat()
        docker("rm", "-f", API, check=False)
        if created_pg:
            docker("rm", "-f", "-v", PG, check=False)
        if created_network:
            docker("network", "rm", NETWORK, check=False)
        CONFIG.unlink(missing_ok=True)
        try:
            report["cleanup"] = dict(
                verified=True,
                containers_absent=not docker(
                    "ps", "-a", "--filter", f"name={NETWORK}", "--format", "{{.Names}}"
                ),
                network_absent=not docker(
                    "network", "ls", "--filter", f"name={NETWORK}", "--format", "{{.Name}}"
                ),
                private_config_deleted=not CONFIG.exists(),
            )
        except RuntimeError:
            report["cleanup"] = dict(verified=False)
        REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(str(REPORT))
    if report["result"] != "passed" or not all(report["cleanup"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
