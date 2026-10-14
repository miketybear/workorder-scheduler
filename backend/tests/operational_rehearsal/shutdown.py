"""Opt-in isolated TLS/PostgreSQL rehearsal of the actual staging shutdown budgets."""

import argparse
import asyncio
import hashlib
import json
import os
import ssl
import stat
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from rehearse import IMAGE, PG_IMAGE, ROOT, docker, ready
from shutdown_assertions import validate_restored

NGINX_IMAGE = "workorder-scheduler-web:local-check"


def capture_container_logs(name):
    """Docker routes application stderr separately; inspect both without publishing logs."""
    result = subprocess.run(["docker", "logs", name], capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError("Owned container log capture failed")
    return result.stdout + result.stderr


def require_contract():
    compose = (ROOT.parent / "compose.staging.yaml").read_text()
    nginx = (ROOT.parent / "deployment/staging/nginx.conf").read_text()
    for literal in (
        '"--timeout-graceful-shutdown", "320"',
        "stop_signal: SIGTERM",
        "stop_signal: SIGQUIT",
    ):
        if literal not in compose:
            raise ValueError("Staging shutdown contract changed")
    if compose.count("stop_grace_period: 330s") != 2:
        raise ValueError("Staging Docker stop budgets changed")
    for literal in (
        "worker_shutdown_timeout 320s;",
        "proxy_read_timeout 310s;",
        "proxy_next_upstream off;",
    ):
        if literal not in nginx:
            raise ValueError("Staging proxy contract changed")
    app_hash = hashlib.sha256()
    for path in sorted((ROOT / "app").rglob("*.py")):
        app_hash.update(path.relative_to(ROOT).as_posix().encode())
        app_hash.update(b"\0")
        app_hash.update(path.read_bytes())
        app_hash.update(b"\0")
    return {
        "compose_sha256": hashlib.sha256(compose.encode()).hexdigest(),
        "nginx_sha256": hashlib.sha256(nginx.encode()).hexdigest(),
        "app_source_sha256": app_hash.hexdigest(),
        "runner_sha256": hashlib.sha256(
            Path(__file__).with_name("runner.py").read_bytes()
        ).hexdigest(),
        "shutdown_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "shutdown_assertions_sha256": hashlib.sha256(
            Path(__file__).with_name("shutdown_assertions.py").read_bytes()
        ).hexdigest(),
    }


class Rehearsal:
    def __init__(self):
        self.run_id = uuid4().hex
        self.prefix = f"wos-shutdown-{self.run_id}"
        self.network = self.prefix
        self.pg, self.api, self.web = [f"{self.prefix}-{s}" for s in ("pg", "api", "web")]
        self.database = f"rehearsal_{self.run_id}"
        self.directory = ROOT.parent / ".cache" / "shutdown-rehearsal" / self.run_id
        self.config = self.directory / f"private-{self.run_id}.json"
        self.statefile = self.directory / f"shutdown-state-{self.run_id}.json"
        self.report_path = self.directory.parent / f"report-{self.run_id}.json"
        self.volumes = []
        self.report = dict(
            run_id=self.run_id,
            result="incomplete",
            cases={},
            started_at=datetime.now(UTC).isoformat(),
            contract=require_contract(),
            methodology=dict(
                request_deadline_seconds=180,
                reader_budget_seconds=300,
                backend_grace_seconds=320,
                docker_stop_seconds=330,
                nginx_worker_seconds=320,
                proxy_read_seconds=310,
                synthetic_upstream=True,
                real_entra=False,
                reader_override="300s to exercise outer180s request budget",
            ),
        )

    def common(self):
        return [
            "--network",
            self.network,
            "--mount",
            f"type=bind,src={ROOT},dst=/src,readonly",
            "--mount",
            f"type=bind,src={self.directory},dst=/evidence",
            "-w",
            "/src",
            "-e",
            "PYTHONPATH=/src",
        ]

    def start_api(self):
        docker(
            "run",
            "-d",
            "--name",
            self.api,
            *self.common(),
            "--network-alias",
            "backend",
            "--stop-signal",
            "SIGTERM",
            "--stop-timeout",
            "330",
            "-p",
            "127.0.0.1:58049:8000",
            IMAGE,
            "python",
            "tests/operational_rehearsal/runner.py",
            f"/evidence/{self.config.name}",
        )

    def start_web(self):
        docker(
            "run",
            "-d",
            "--name",
            self.web,
            "--network",
            self.network,
            "--stop-signal",
            "SIGQUIT",
            "--stop-timeout",
            "330",
            "-p",
            "127.0.0.1:58449:443",
            "--mount",
            f"type=bind,src={ROOT.parent / 'deployment/staging/nginx.conf'},"
            "dst=/etc/nginx/nginx.conf,readonly",
            "--mount",
            f"type=bind,src={self.directory},dst=/etc/nginx/tls,readonly",
            NGINX_IMAGE,
        )

    def sql(self, sql):
        return json.loads(
            docker("exec", self.pg, "psql", "-U", "rehearsal", "-d", self.database, "-Atc", sql)
        )

    def counts(self, request_id):
        UUID(request_id)
        return self.sql(
            "SELECT json_build_object('drafts',(SELECT count(*) FROM draft),"
            "'items',(SELECT count(*) FROM draft_item),"
            "'receipts',(SELECT count(*) FROM draft_submission),"
            "'request_receipts',(SELECT count(*) FROM draft_submission "
            f"WHERE request_id='{request_id}'))"
        )

    def stop(self, name):
        start = time.perf_counter()
        docker("stop", name)  # Use configured330s; no CLI override.
        metadata = json.loads(docker("inspect", "--format", "{{json .Config}}", name))
        state = json.loads(docker("inspect", "--format", "{{json .State}}", name))
        assert state["ExitCode"] == 0 and not state["OOMKilled"]
        assert metadata["StopTimeout"] == 330
        return dict(
            elapsed_seconds=round(time.perf_counter() - start, 3),
            exit_code=state["ExitCode"],
            stop_signal=metadata["StopSignal"],
            stop_timeout_seconds=metadata["StopTimeout"],
        )

    def setup(self):
        self.directory.mkdir(parents=True)
        docker("network", "create", self.network)
        docker(
            "run",
            "-d",
            "--name",
            self.pg,
            "--network",
            self.network,
            "--network-alias",
            "pg",
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            "-e",
            "POSTGRES_USER=rehearsal",
            "-e",
            "POSTGRES_DB=scheduler_test",
            PG_IMAGE,
        )
        mounts = json.loads(docker("inspect", "--format", "{{json .Mounts}}", self.pg))
        self.volumes = [m["Name"] for m in mounts if m["Type"] == "volume"]
        for _ in range(150):
            result = subprocess.run(
                ["docker", "exec", self.pg, "pg_isready", "-U", "rehearsal"], capture_output=True
            )
            if result.returncode == 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("Owned PostgreSQL not ready")
        docker("exec", self.pg, "createdb", "-U", "rehearsal", self.database)
        data = dict(
            run_id=self.run_id,
            database_url=f"postgresql+psycopg://rehearsal:synthetic@pg:5432/{self.database}",
            tenant_id=str(uuid4()),
            shutdown_grace_seconds=320,
            retrieval_timeout_seconds=300,
            connections=[
                dict(id=str(uuid4()), system=s, host=f"{s}.invalid")
                for s in ("onshore", "offshore")
            ],
        )
        self.config.write_text(json.dumps(data))
        docker(
            "run",
            "--rm",
            *self.common(),
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
            "--rm",
            *self.common(),
            IMAGE,
            "python",
            "tests/operational_rehearsal/runner.py",
            f"/evidence/{self.config.name}",
            "seed",
        )
        # Self-signed synthetic endpoint is explicitly trusted; TLS verification remains enabled.
        docker(
            "run",
            "--rm",
            "--mount",
            f"type=bind,src={self.directory},dst=/certs",
            IMAGE,
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-keyout",
            "/certs/privkey.pem",
            "-out",
            "/certs/fullchain.pem",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost,IP:127.0.0.1",
        )
        self.report["versions"] = dict(
            postgres=self.sql("SELECT to_json(version())"),
            backend_image_id=docker("image", "inspect", "--format", "{{.Id}}", IMAGE),
            nginx_image_id=docker("image", "inspect", "--format", "{{.Id}}", NGINX_IMAGE),
        )
        self.start_api()
        self.start_web()
        return json.loads(self.config.read_text())

    async def scenario(self, data, only_committed_response_loss=False):
        actor = data["users"][0]
        headers = {"Cookie": f"__Host-wos-session={actor['token']}", "X-CSRF-Token": actor["csrf"]}
        tls = ssl.create_default_context(cafile=str(self.directory / "fullchain.pem"))
        async with (
            httpx.AsyncClient(
                base_url="http://127.0.0.1:58049", timeout=400, trust_env=False
            ) as direct,
            httpx.AsyncClient(
                base_url="https://127.0.0.1:58449", verify=tls, timeout=400, trust_env=False
            ) as web,
        ):
            await ready(direct)
            await ready(web)

            async def knob(**changes):
                r = await direct.post("/__rehearsal/control", json=changes)
                r.raise_for_status()
                return r.json()

            async def barrier(field, count):
                for _ in range(300):
                    state = (await direct.get("/__rehearsal/state")).json()
                    if state[field] >= count:
                        return state
                    await asyncio.sleep(0.05)
                raise RuntimeError("Barrier not reached")

            async def payload():
                scope = {k: actor[k] for k in ("connection_id", "discipline")}
                keys = [dict(site_id="TEST", workorder_id=str(i)) for i in range(1000, 1200)]
                r = await web.post(
                    "/api/draft-batches/prepare", headers=headers, json={**scope, "items": keys}
                )
                assert r.status_code == 200
                return {
                    **scope,
                    "request_id": str(uuid4()),
                    "items": [
                        {
                            **key,
                            "baseline_token": item["baseline_token"],
                            "changes": {"estdur": "9"},
                        }
                        for key, item in zip(keys, r.json()["items"], strict=True)
                    ],
                }

            async def restart():
                docker("rm", self.api)
                self.start_api()
                await ready(direct)
                docker("rm", "-f", self.web)
                self.start_web()
                await ready(web)

            async def replay(body, expected):
                before = self.counts(body["request_id"])
                response = await web.post("/api/draft-batches", headers=headers, json=body)
                assert response.status_code == 201 and response.json() == expected
                assert self.counts(body["request_id"]) == before
                restored = await web.get("/api/drafts/" + expected["draft_id"], headers=headers)
                assert restored.status_code == 200 and len(restored.json()["items"]) == 200
                validation = validate_restored(body, expected, actor, restored.json())
                return dict(
                    **validation,
                    exact_replay=True,
                    counts_unchanged=True,
                    restored_items=200,
                    restored_version=restored.json()["version"],
                )

            if not only_committed_response_loss:
                # A: ordered operator procedure, nginxQUIT drains admittedTLS request.
                body = await payload()
                before = self.counts(body["request_id"])
                state = await knob(hold=True)
                request = asyncio.create_task(
                    web.post("/api/draft-batches", headers=headers, json=body)
                )
                await barrier("entered", state["entered"] + 4)
                print("A: admitted200-WO TLS batch; stopping web with330s budget", flush=True)
                stopping = asyncio.create_task(asyncio.to_thread(self.stop, self.web))
                await asyncio.sleep(2)
                rejected = False
                async with httpx.AsyncClient(
                    base_url="https://127.0.0.1:58449", verify=tls, timeout=2, trust_env=False
                ) as newcomer:
                    try:
                        await newcomer.get("/api/health/ready")
                    except httpx.HTTPError:
                        rejected = True
                assert rejected
                await knob(hold=False)
                response = await request
                assert response.status_code == 201
                result = response.json()
                webstop = await stopping
                after = self.counts(body["request_id"])
                assert (
                    after["drafts"] - before["drafts"] == 1
                    and after["items"] - before["items"] == 200
                    and after["receipts"] - before["receipts"] == 1
                    and after["request_receipts"] == 1
                )
                backendstop = await asyncio.to_thread(self.stop, self.api)
                await restart()
                self.report["cases"]["A_ordered_tls_drain"] = dict(
                    response_status=201,
                    new_admission_rejected=True,
                    web_stop=webstop,
                    backend_stop=backendstop,
                    counts=after,
                    **await replay(body, result),
                )
                # B: holdreader300s isolates requestdeadline180s duringbackend stop.
                body = await payload()
                before = self.counts(body["request_id"])
                state = await knob(hold=True)
                request = asyncio.create_task(
                    direct.post("/api/draft-batches", headers=headers, json=body)
                )
                await barrier("entered", state["entered"] + 4)
                print(
                    "B: precommit hold; waiting real180s request deadline during backend stop",
                    flush=True,
                )
                start = time.perf_counter()
                stopping = asyncio.create_task(asyncio.to_thread(self.stop, self.api))
                response = await request
                elapsed = time.perf_counter() - start
                assert response.status_code == 504 and 175 <= elapsed <= 195
                stop = await stopping
                drained = json.loads(self.statefile.read_text())
                assert drained["active"] == 0 and drained["cancelled"] >= 4
                assert self.counts(body["request_id"]) == before
                await restart()
                success = await direct.post("/api/draft-batches", headers=headers, json=body)
                assert (
                    success.status_code == 201
                    and self.counts(body["request_id"])["request_receipts"] == 1
                )
                after = self.counts(body["request_id"])
                assert after["drafts"] - before["drafts"] == 1
                assert after["items"] - before["items"] == 200
                assert after["receipts"] - before["receipts"] == 1
                self.report["cases"]["B_request_deadline_rollback"] = dict(
                    status=504,
                    request_elapsed_seconds=round(elapsed, 3),
                    backend_stop=stop,
                    counts_unchanged_before_replay=True,
                    active_after_shutdown=drained["active"],
                    cancelled=drained["cancelled"],
                    **await replay(body, success.json()),
                )
            # C: durablecommit then holdresponse outside handlerdeadline untilgrace320.
            body = await payload()
            before = self.counts(body["request_id"])
            await knob(response_hold=True)
            request = asyncio.create_task(
                direct.post("/api/draft-batches", headers=headers, json=body)
            )
            await barrier("response_waiting", 1)
            assert self.counts(body["request_id"])["request_receipts"] == 1
            after = self.counts(body["request_id"])
            assert after["drafts"] - before["drafts"] == 1
            assert after["items"] - before["items"] == 200
            assert after["receipts"] - before["receipts"] == 1
            request_id = str(UUID(body["request_id"]))
            persisted = self.sql(
                f"SELECT result FROM draft_submission WHERE request_id='{request_id}'"
            )
            print(
                "C: committed receipt verified; waiting real320s backend grace expiry", flush=True
            )
            start = time.perf_counter()
            stopping = asyncio.create_task(asyncio.to_thread(self.stop, self.api))
            try:
                response = await request
                outcome = str(response.status_code)
                assert response.status_code == 500
            except httpx.RemoteProtocolError:
                outcome = "RemoteProtocolError"
            elapsed = time.perf_counter() - start
            stop = await stopping
            assert 315 <= elapsed <= 330
            logs = capture_container_logs(self.api)
            assert "graceful shutdown" in logs.lower()
            await restart()
            self.report["cases"]["C_committed_response_loss"] = dict(
                client_outcome=outcome,
                response_wait_seconds=round(elapsed, 3),
                backend_stop=stop,
                receipt_before_stop=1,
                counts_before_submission=before,
                counts_after_commit=after,
                grace_expiry_logged=True,
                **await replay(body, persisted),
            )
            self.report["result"] = "passed"

    def cleanup(self):
        for name in (self.web, self.api, self.pg):
            docker("rm", "-f", "-v", name, check=False)
        docker("network", "rm", self.network, check=False)
        for path in self.directory.iterdir():
            if path.name not in {
                self.config.name,
                self.statefile.name,
                "privkey.pem",
                "fullchain.pem",
            }:
                raise RuntimeError("Unexpected file in owned private directory")
            path.unlink()
        # OneDrive may mark a newly created Windows directory read-only.
        # Only this known empty UUID-owned directory is touched, never its parent.
        if os.name == "nt":
            self.directory.chmod(stat.S_IWRITE)
        self.directory.rmdir()
        remaining = docker("ps", "-a", "--filter", f"name={self.prefix}", "--format", "{{.Names}}")
        networks = docker(
            "network", "ls", "--filter", f"name={self.prefix}", "--format", "{{.Name}}"
        )
        allvolumes = docker("volume", "ls", "-q").splitlines()
        self.report["cleanup"] = dict(
            verified=True,
            containers_absent=not remaining,
            network_absent=not networks,
            volumes_absent=not set(self.volumes).intersection(allvolumes),
            private_files_absent=not self.directory.exists(),
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-owned-synthetic-shutdown", action="store_true")
    parser.add_argument("--only-committed-response-loss", action="store_true")
    args = parser.parse_args()
    if not args.run_owned_synthetic_shutdown:
        parser.error("Explicit opt-in required; this runs real180s/320s fault waits")
    rehearsal = Rehearsal()
    rehearsal.report["methodology"]["selected_cases"] = (
        ["C"] if args.only_committed_response_loss else ["A", "B", "C"]
    )
    try:
        data = rehearsal.setup()
        asyncio.run(
            rehearsal.scenario(data, args.only_committed_response_loss),
            loop_factory=asyncio.SelectorEventLoop,
        )
    except Exception as error:
        rehearsal.report["result"] = "failed"
        rehearsal.report["error"] = dict(
            type=type(error).__name__, completed_cases=list(rehearsal.report["cases"])
        )
        import traceback

        traceback.print_exc()
    finally:
        try:
            rehearsal.cleanup()
        except Exception as error:
            rehearsal.report["cleanup"] = dict(verified=False, error_type=type(error).__name__)
        rehearsal.report["ended_at"] = datetime.now(UTC).isoformat()
        rehearsal.report_path.parent.mkdir(parents=True, exist_ok=True)
        rehearsal.report_path.write_text(json.dumps(rehearsal.report, indent=2))
        print(rehearsal.report_path, flush=True)
    if rehearsal.report["result"] != "passed" or not all(rehearsal.report["cleanup"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
