"""Stdlib failure tests; Linux additionally exercises actual flock exclusion."""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "backup_job", Path(__file__).parents[1] / "backup_job.py"
)
job = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(job)


class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for name in ("work", "destination"):
            (self.root / name).mkdir(mode=0o700)
        for name, contents in (
            ("service", "[backup]\nhost=127.0.0.1\nport=5432\ndbname=synthetic\nuser=backup\n"),
            ("pass", "127.0.0.1:5432:synthetic:backup:SENSITIVE_MARKER\n"),
            ("cert", "public fixture"),
        ):
            path = self.root / name
            path.write_text(contents)
            path.chmod(0o600)
        self.config = {
            "approval": {
                "approved": True,
                "offsite_approved": True,
                "reference": "synthetic",
                "owner": "test",
                "rpo_seconds": 1,
                "rto_seconds": 1,
                "schedule_reference": "test",
                "retention_reference": "test",
            },
            "service_name": "backup",
            "service_file": str(self.root / "service"),
            "pass_file": str(self.root / "pass"),
            "expected": {
                "database": "synthetic",
                "server_address": "127.0.0.1",
                "server_port": 5432,
                "postgres_major": 17,
                "schema_revision": "test_head",
            },
            "recipient_certificate": str(self.root / "cert"),
            "recipient_sha256": "a" * 64,
            "release_reference": "synthetic",
            "destination": str(self.root / "destination"),
            "expected_mount_source": "synthetic-offsite",
            "work_directory": str(self.root / "work"),
            "lock_file": str(self.root / "work" / "backup.lock"),
            "timeout_seconds": 30,
        }
        self.path = self.root / "config.json"

    def load(self):
        self.path.write_text(json.dumps(self.config))
        self.path.chmod(0o600)
        return job.load_config(self.path)

    def test_private_complete_config_and_no_inherited_pg_overrides(self):
        self.load()
        with patch.dict(os.environ, {"PGHOST": "evil", "PGPASSWORD": "SENSITIVE_MARKER"}):
            env = job.child_environment(self.config)
        self.assertNotIn("PGHOST", env)
        self.assertNotIn("PGPASSWORD", env)
        self.assertNotIn("SENSITIVE_MARKER", str(env))

    def test_unapproved_missing_rpo_and_inline_password_fail_closed(self):
        for mutation in (
            lambda: self.config["approval"].update(approved=False),
            lambda: self.config["approval"].update(rpo_seconds=None),
            lambda: self.config["approval"].update(offsite_approved=False),
        ):
            with self.subTest(mutation=mutation):
                saved = json.loads(json.dumps(self.config))
                mutation()
                with self.assertRaises(job.BackupError):
                    self.load()
                self.config = saved
        (self.root / "service").write_text(
            "[backup]\nhost=127.0.0.1\ndbname=synthetic\npassword=secret\n"
        )
        with self.assertRaises(job.BackupError):
            self.load()
        (self.root / "service").write_text(
            "[backup]\nhost=127.0.0.1\ndbname=synthetic\npassfile=/unapproved/path\n"
        )
        with self.assertRaises(job.BackupError):
            self.load()

    @unittest.skipUnless(os.name == "posix", "Linux ownership/permission checks")
    def test_private_file_mode_and_symlink_rejected(self):
        self.path.write_text(json.dumps(self.config))
        self.path.chmod(0o644)
        with self.assertRaises(job.BackupError):
            job.load_config(self.path)
        link = self.root / "link"
        link.symlink_to(self.root / "pass")
        with self.assertRaises(job.BackupError):
            job.private_file(link)

    @unittest.skipUnless(os.name == "posix", "Linux flock")
    def test_one_job_lock(self):
        with job.job_lock(self.config["lock_file"]):
            with self.assertRaises(job.BackupError):
                with job.job_lock(self.config["lock_file"]):
                    self.fail("second job entered")

    def fake_command(self, command):
        if command[0] == "findmnt":
            return "synthetic-offsite"
        if "--version" in command:
            return command[0] + " (PostgreSQL) 17.7"
        if command[:2] == ["openssl", "x509"]:
            return "sha256 Fingerprint=" + "a" * 64
        if command[0] == "pg_dump":
            path = Path(next(arg[7:] for arg in command if arg.startswith("--file=")))
            path.write_bytes(b"synthetic plaintext dump")
        elif command[:2] == ["openssl", "cms"]:
            Path(command[command.index("-out") + 1]).write_bytes(b"synthetic encrypted bytes")
        return ""

    @contextmanager
    def snapshot(self, *_):
        yield "00000001-00000002-1", {table: 0 for table in job.TABLES}

    def test_success_only_publishes_complete_encrypted_inventory(self):
        with (
            patch.object(job, "job_lock", self.snapshot),
            patch.object(job, "exported_snapshot", self.snapshot),
            patch.object(job.Commands, "run", lambda _, cmd: self.fake_command(cmd)),
            patch.object(job, "sync_directory"),
            patch.object(job, "sync_file"),
        ):
            report = job.execute(self.config)
        directory = self.root / "destination" / report["set_id"]
        self.assertEqual(
            {path.name for path in directory.iterdir()},
            {"database.dump.cms", "metadata.json.cms", "manifest.json", "COMPLETE"},
        )
        manifest = json.loads((directory / "manifest.json").read_text())
        self.assertNotIn("schema_revision", manifest)
        self.assertNotIn("SENSITIVE_MARKER", (directory / "manifest.json").read_text())
        self.assertEqual(len(manifest["files"]), 2)
        self.assertFalse(any((self.root / "work").iterdir()))

    def test_failures_never_publish_or_delete_old_sets(self):
        old = self.root / "destination" / "old"
        old.mkdir()
        (old / "COMPLETE").write_text("older backup")
        real_rename = os.rename
        for phase in (
            "mount",
            "version",
            "fingerprint",
            "snapshot",
            "dump",
            "encrypt",
            "sync",
            "rename",
            "post_publish_sync",
            "mount_loss_before_stage",
            "mount_loss_before_publish",
            "expired_cert",
        ):
            with self.subTest(phase=phase):
                mount_checks = 0

                def run(_, cmd, phase=phase):
                    nonlocal mount_checks
                    if cmd[0] == "findmnt":
                        mount_checks += 1
                        if (phase == "mount_loss_before_stage" and mount_checks == 2) or (
                            phase == "mount_loss_before_publish" and mount_checks == 3
                        ):
                            return "lost-mount"
                    if phase == "mount" and cmd[0] == "findmnt":
                        return "wrong-mount"
                    if phase == "version" and "--version" in cmd:
                        return "(PostgreSQL) 16.1"
                    if phase == "fingerprint" and cmd[:2] == ["openssl", "x509"]:
                        return "wrong-certificate"
                    if phase == "dump" and cmd[0] == "pg_dump" and "--version" not in cmd:
                        raise job.BackupError("safe failure")
                    if phase == "encrypt" and cmd[:2] == ["openssl", "cms"]:
                        raise job.BackupError("safe failure")
                    if phase == "expired_cert" and "-checkend" in cmd:
                        raise job.BackupError("safe failure")
                    return self.fake_command(cmd)

                @contextmanager
                def snapshot(*_, phase=phase):
                    if phase == "snapshot":
                        raise job.BackupError("Source mismatch")
                    yield "00000001-00000002-1", {table: 0 for table in job.TABLES}

                with (
                    patch.object(job, "job_lock", self.snapshot),
                    patch.object(job, "exported_snapshot", snapshot),
                    patch.object(job.Commands, "run", run),
                    patch.object(
                        job,
                        "sync_directory",
                        side_effect=(
                            [None, OSError()]
                            if phase == "post_publish_sync"
                            else OSError()
                            if phase == "sync"
                            else None
                        ),
                    ),
                    patch.object(job, "sync_file"),
                    patch.object(
                        job.os,
                        "rename",
                        side_effect=(
                            OSError()
                            if phase == "rename"
                            else real_rename
                            if phase == "post_publish_sync"
                            else None
                        ),
                    ),
                ):
                    with self.assertRaises((job.BackupError, OSError)):
                        job.execute(self.config)
                self.assertEqual(list((self.root / "destination").iterdir()), [old])
                self.assertEqual((old / "COMPLETE").read_text(), "older backup")
                self.assertFalse(any((self.root / "work").iterdir()))

    def test_cli_failure_does_not_echo_diagnostics(self):
        fake = type("Result", (), {"returncode": 1, "stdout": b"", "stderr": b"SENSITIVE_MARKER"})()
        with patch.object(job.subprocess, "run", return_value=fake):
            with self.assertRaises(job.BackupError) as raised:
                job.Commands(self.config).run(["psql", "--version"])
        self.assertNotIn("SENSITIVE_MARKER", str(raised.exception))

    def test_destination_inode_replacement_is_rejected_before_stage_creation(self):
        mount_checks = 0
        destination = self.root / "destination"

        def run(_, command):
            nonlocal mount_checks
            if command[0] == "findmnt":
                mount_checks += 1
                if mount_checks == 1:
                    destination.rename(self.root / "old-mount")
                    destination.mkdir(mode=0o700)
            return self.fake_command(command)

        with patch.object(job, "job_lock", self.snapshot), patch.object(job.Commands, "run", run):
            with self.assertRaises(job.BackupError):
                job.execute(self.config)
        self.assertFalse(any(destination.iterdir()))
        self.assertFalse(any((self.root / "work").iterdir()))

    def test_existing_set_collision_never_overwrites_or_deletes_it(self):
        fixed = job.datetime(2026, 10, 10, tzinfo=job.UTC)
        name = fixed.strftime("%Y%m%dT%H%M%SZ_") + "b" * 32
        existing = self.root / "destination" / name
        existing.mkdir()
        (existing / "COMPLETE").write_text("existing-backup")
        with (
            patch.object(job, "datetime") as clock,
            patch.object(job, "uuid4", return_value=SimpleNamespace(hex="b" * 32)),
            patch.object(job, "job_lock", self.snapshot),
            patch.object(job, "exported_snapshot", self.snapshot),
            patch.object(job.Commands, "run", lambda _, command: self.fake_command(command)),
            patch.object(job, "sync_directory"),
            patch.object(job, "sync_file"),
        ):
            clock.now.return_value = fixed
            with self.assertRaises(job.BackupError):
                job.execute(self.config)
        self.assertEqual((existing / "COMPLETE").read_text(), "existing-backup")
        self.assertEqual(list((self.root / "destination").iterdir()), [existing])
        self.assertFalse(any((self.root / "work").iterdir()))

    @unittest.skipUnless(os.name == "posix", "Linux CLI/selector")
    def test_dump_diagnostics_and_timeout_fail_without_exposing_warning(self):
        commands = job.Commands(self.config)
        with self.assertRaises(job.BackupError) as raised:
            commands.dump(
                [sys.executable, "-c", "import sys; sys.stderr.write('SENSITIVE_MARKER')"]
            )
        self.assertNotIn("SENSITIVE_MARKER", str(raised.exception))
        commands.deadline = job.time.monotonic() + 0.1
        with self.assertRaises(job.BackupError):
            commands.dump([sys.executable, "-c", "import time; time.sleep(10)"])


if __name__ == "__main__":
    unittest.main()
