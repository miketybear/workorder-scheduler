"""Ephemeral Linux runner. Receives only guarded synthetic credentials via stdin."""

import json
import os
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import backup_job as job  # noqa: E402


def rehearsal(payload):
    if (
        payload["guard"] != "scheduler_test:127.0.0.1:55432"
        or not payload["source"].startswith("wos_backup_source_")
        or not payload["target"].startswith("wos_restore_")
    ):
        raise RuntimeError("Synthetic guard required")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="wos-backup-test-") as temp:
        root = Path(temp)
        for name in ("work", "destination"):
            (root / name).mkdir()
        service = root / "service"
        service.write_text(
            "\n".join(
                f"[{name}]\nhost=127.0.0.1\nport=5432\nuser={payload['username']}\n"
                f"dbname={database}\nsslmode=disable\n"
                for name, database in (
                    ("backup", payload["source"]),
                    ("restore", payload["target"]),
                )
            )
        )
        password = payload["password"].replace("\\", "\\\\").replace(":", "\\:")
        passfile = root / "pass"
        passfile.write_text(
            "\n".join(
                f"127.0.0.1:5432:{database}:{payload['username']}:{password}"
                for database in (payload["source"], payload["target"])
            )
            + "\n"
        )
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "PGSERVICE": "backup",
            "PGSERVICEFILE": str(service),
            "PGPASSFILE": str(passfile),
        }

        def run(command, input=None, env=env, expect_success=True):
            result = subprocess.run(command, input=input, env=env, capture_output=True, timeout=120)
            if (result.returncode == 0) != expect_success:
                raise RuntimeError("Synthetic CLI result unexpected; diagnostics withheld")
            return result.stdout.decode()

        cert, key = root / "recipient.pem", root / "private.key"
        run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=Synthetic-only",
                "-keyout",
                str(key),
                "-out",
                str(cert),
            ]
        )
        fingerprint = (
            run(["openssl", "x509", "-in", str(cert), "-noout", "-fingerprint", "-sha256"])
            .strip()
            .split("=")[-1]
            .replace(":", "")
            .lower()
        )
        config = {
            "approval": {
                "approved": True,
                "offsite_approved": True,
                "reference": "synthetic",
                "owner": "synthetic",
                "rpo_seconds": 1,
                "rto_seconds": 1,
                "schedule_reference": "synthetic",
                "retention_reference": "synthetic",
            },
            "service_name": "backup",
            "service_file": str(service),
            "pass_file": str(passfile),
            "expected": {
                "database": payload["source"],
                "server_address": "127.0.0.1",
                "server_port": 5432,
                "postgres_major": 17,
                "schema_revision": payload["revision"],
            },
            "recipient_certificate": str(cert),
            "recipient_sha256": fingerprint,
            "release_reference": "synthetic",
            "destination": str(root / "destination"),
            "expected_mount_source": run(
                ["findmnt", "-n", "-o", "SOURCE", "-T", str(root)]
            ).strip(),
            "work_directory": str(root / "work"),
            "lock_file": str(root / "work" / "backup.lock"),
            "timeout_seconds": 60,
        }
        configfile = root / "config.json"
        configfile.write_text(json.dumps(config))
        config = job.load_config(configfile)
        original_snapshot = job.exported_snapshot

        @contextmanager
        def mutate_after_export(commands, expected):
            with original_snapshot(commands, expected) as snapshot:
                # Commit new values AFTER export: dump and encrypted metadata must
                # retain the original revision and data/counts in the shared snapshot.
                run(
                    ["psql", "-X", "-qAt", "-w", "-v", "ON_ERROR_STOP=1"],
                    input=(
                        b"UPDATE draft SET version=version+1;\n"
                        b"UPDATE alembic_version SET version_num='synthetic_newer';\n"
                    ),
                )
                yield snapshot

        job.exported_snapshot = mutate_after_export
        try:
            report = job.execute(config)
        finally:
            job.exported_snapshot = original_snapshot
        directory = root / "destination" / report["set_id"]
        manifest = json.loads((directory / "manifest.json").read_text())
        assert set(path.name for path in directory.iterdir()) == {
            "COMPLETE",
            "manifest.json",
            "database.dump.cms",
            "metadata.json.cms",
        }
        for filename, inventory in manifest["files"].items():
            assert job.hash_file(directory / filename) == inventory["sha256"]
            assert (directory / filename).stat().st_size == inventory["bytes"]
        assert not any(path.name.startswith("wos-plaintext-") for path in (root / "work").iterdir())
        for filename in ("database.dump", "metadata.json"):
            run(
                [
                    "openssl",
                    "cms",
                    "-decrypt",
                    "-binary",
                    "-inform",
                    "DER",
                    "-in",
                    str(directory / (filename + ".cms")),
                    "-recip",
                    str(cert),
                    "-inkey",
                    str(key),
                    "-out",
                    str(root / filename),
                ]
            )
        metadata = json.loads((root / "metadata.json").read_text())
        assert metadata["source"]["schema_revision"] == payload["revision"]
        assert metadata["counts"] == payload["counts"]
        run(
            [
                "pg_restore",
                "-w",
                "--exit-on-error",
                "--single-transaction",
                "--dbname=service=restore",
                str(root / "database.dump"),
            ]
        )
        damaged = root / "damaged.cms"
        data = bytearray((directory / "database.dump.cms").read_bytes())
        data[-1] ^= 1
        damaged.write_bytes(data)
        run(
            [
                "openssl",
                "cms",
                "-decrypt",
                "-binary",
                "-inform",
                "DER",
                "-in",
                str(damaged),
                "-recip",
                str(cert),
                "-inkey",
                str(key),
                "-out",
                str(root / "damaged.dump"),
            ],
            expect_success=False,
        )
        # Actual identity mismatch: restored source revision now differs, fail before dump.
        try:
            job.execute(config)
            raise AssertionError("Source revision mismatch was accepted")
        except job.BackupError:
            pass
        assert list((root / "destination").iterdir()) == [directory]
        assert not any(path.name.startswith("wos-plaintext-") for path in (root / "work").iterdir())
        return {
            "synthetic_only": True,
            "encrypted_shared_snapshot_verified": True,
            "authenticated_corruption_rejected": True,
            "identity_mismatch_rejected": True,
            "offsite_or_ubuntu_acceptance": False,
        }


if __name__ == "__main__":
    try:
        print(json.dumps(rehearsal(json.load(sys.stdin))))
    except Exception as error:
        detail = str(error) if isinstance(error, job.BackupError) else type(error).__name__
        print("Synthetic backup rehearsal failed: " + detail, file=sys.stderr)
        sys.exit(1)
