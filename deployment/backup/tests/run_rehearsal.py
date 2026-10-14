"""Run from backend/: uv run python ../deployment/backup/tests/run_rehearsal.py.

Requires the designated local scheduler_test DB and built wos-backup-synthetic:local
CLI image. No application DB is dumped; only this run's two UUID databases exist.
"""

import json
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[3] / "backend"
sys.path.insert(0, str(BACKEND))

import psycopg  # noqa: E402
from psycopg import sql  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402

import backup_restore_rehearsal as old  # noqa: E402
from app.config import integration_settings  # noqa: E402


def run():
    url = old.guarded_url(integration_settings())
    suffix = uuid4().hex[:12]
    names = {"source": "wos_backup_source_" + suffix, "target": "wos_restore_" + suffix}
    owned = []
    engines = []
    # Existing guard also checks container loopback55432 mapping; no arbitrary host.
    with old.TemporaryDirectory(prefix="wos-backup-host-") as temp:
        tools = old.PostgreSQLTools(url, Path(temp), "wos-tests-db-1")
        with psycopg.connect(
            host=url.host,
            port=url.port,
            dbname=url.database,
            user=url.username,
            password=url.password,
            autocommit=True,
            connect_timeout=5,
        ) as admin:
            try:
                for name in names.values():
                    admin.execute(
                        sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(
                            sql.Identifier(name)
                        )
                    )
                    owned.append(name)
                    engines.append(create_engine(url.set(database=name), hide_parameters=True))
                source, restored = engines
                revision = old.migrate(source, url.username)
                old.seed(source)
                before = old.snapshot(source)
                counts = {
                    table: len(before[0][table])
                    for table in before[0]
                    if table != "alembic_version"
                }
                payload = {
                    "guard": "scheduler_test:127.0.0.1:55432",
                    **names,
                    "username": url.username,
                    "password": url.password,
                    "revision": revision,
                    "counts": counts,
                }
                command = [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    "container:wos-tests-db-1",
                    "-v",
                    str(Path(__file__).resolve().parents[1]) + ":/job:ro",
                    "-i",
                    "wos-backup-synthetic:local",
                    "python3",
                    "/job/tests/synthetic_rehearsal.py",
                ]
                result = subprocess.run(
                    command, input=json.dumps(payload).encode(), capture_output=True, timeout=180
                )
                if result.returncode:
                    # Runner emits only controlled stage/error labels, never CLI diagnostics.
                    sys.stderr.write(result.stderr.decode())
                    raise RuntimeError("Synthetic CLI rehearsal failed; diagnostics withheld")
                report = json.loads(result.stdout)
                if old.snapshot(restored) != before:
                    raise RuntimeError(
                        "Decrypted restore differs from snapshot-aligned synthetic source"
                    )

                auth_sql = (Path(__file__).parents[1] / "invalidate_restored_auth.sql").read_bytes()
                target_before = old.snapshot(restored)
                source_before_invalidation = old.snapshot(source)
                # Source fails name guard; wrong expected DB and invalid case fail on target.
                for database, expected, case in (
                    (names["source"], names["source"], "DR-test"),
                    (names["target"], "wrong_database", "DR-test"),
                    (names["target"], names["target"], "unapproved"),
                ):
                    try:
                        tools.run(
                            tools.command("psql", database)
                            + [
                                "-X",
                                "-v",
                                "ON_ERROR_STOP=1",
                                "-v",
                                "expected_database=" + expected,
                                "-v",
                                "restore_case=" + case,
                            ],
                            input=auth_sql,
                        )
                        raise AssertionError("Unsafe auth invalidation accepted")
                    except RuntimeError:
                        pass
                if old.snapshot(restored) != target_before:
                    raise RuntimeError("Rejected auth invalidation modified restored data")
                if old.snapshot(source) != source_before_invalidation:
                    raise RuntimeError("Rejected auth invalidation modified source data")
                invalidated = tools.run(
                    tools.command("psql", names["target"])
                    + [
                        "-X",
                        "-qAt",
                        "-v",
                        "ON_ERROR_STOP=1",
                        "-v",
                        "expected_database=" + names["target"],
                        "-v",
                        "restore_case=DR-synthetic",
                    ],
                    input=auth_sql,
                )
                expected_counts = (
                    f"{len(before[0]['login_flow'])}|{len(before[0]['login_session'])}"
                )
                if invalidated.stdout.decode().strip().splitlines()[-1] != expected_counts:
                    raise RuntimeError("Auth invalidation counts differ from restored snapshot")
                after = old.snapshot(restored)
                for table, rows in before[0].items():
                    if table in {"login_session", "login_flow"}:
                        if after[0][table]:
                            raise RuntimeError("Restored authentication remained active")
                    elif after[0][table] != rows:
                        raise RuntimeError("Auth invalidation changed business history")
                report.update(
                    exact_schema_data_restore=True,
                    auth_invalidation_guards=True,
                    schema_revision=revision,
                    tables_verified=len(before[0]),
                    rows_verified=sum(len(rows) for rows in before[0].values()),
                )
                return report
            finally:
                for engine in engines:
                    engine.dispose()
                for name in reversed(owned):
                    if name not in names.values() or not name.endswith(suffix):
                        raise RuntimeError("Refusing cleanup outside owned databases")
                    admin.execute(
                        sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
                    )


if __name__ == "__main__":
    try:
        print(json.dumps(run()))
    except Exception:
        print("Synthetic backup/restore rehearsal failed; diagnostics withheld", file=sys.stderr)
        sys.exit(1)
