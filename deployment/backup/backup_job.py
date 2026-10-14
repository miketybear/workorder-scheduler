"""Ubuntu PostgreSQL17 backup job; no restore, retention deletion or credential argv."""

import argparse
import configparser
import hashlib
import json
import os
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


class BackupError(Exception):
    """Safe operational message: never include tool stderr or configuration values."""


TABLES = (
    "app_user",
    "maximo_connection",
    "access_grant",
    "planner_permission",
    "maximo_person_binding",
    "user_connection_setting",
    "draft",
    "draft_item",
    "draft_submission",
    "upload_batch",
    "upload_item",
    "audit_event",
    "authorization_event",
    "admin_authority_event",
    "login_flow",
    "login_session",
)


def private_file(path):
    path = Path(path)
    info = path.lstat()
    if not path.is_absolute() or not stat.S_ISREG(info.st_mode):
        raise BackupError("Private configuration must be an absolute regular file")
    if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise BackupError("Private configuration ownership or permissions are unsafe")
    return path


def private_directory(path):
    path = Path(path)
    info = path.lstat()
    if not path.is_absolute() or path.resolve() != path or not stat.S_ISDIR(info.st_mode):
        raise BackupError("Directory must be absolute, existing and without symlinks")
    if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise BackupError("Directory ownership or permissions are unsafe")
    return path


def load_config(path):
    config = json.loads(private_file(path).read_text(encoding="utf-8"))
    required = {
        "approval",
        "service_name",
        "service_file",
        "pass_file",
        "expected",
        "recipient_certificate",
        "recipient_sha256",
        "release_reference",
        "destination",
        "expected_mount_source",
        "work_directory",
        "lock_file",
        "timeout_seconds",
    }
    if set(config) != required:
        raise BackupError("Backup configuration fields are incomplete or unsupported")
    approval = config["approval"]
    if (
        set(approval)
        != {
            "approved",
            "reference",
            "owner",
            "rpo_seconds",
            "rto_seconds",
            "schedule_reference",
            "retention_reference",
            "offsite_approved",
        }
        or approval["approved"] is not True
        or approval["offsite_approved"] is not True
    ):
        raise BackupError("Backup and offsite policy approval are required")
    for field in ("reference", "owner", "schedule_reference", "retention_reference"):
        if not isinstance(approval[field], str) or not approval[field].strip():
            raise BackupError("Approved policy references are required")
    for field in ("rpo_seconds", "rto_seconds"):
        if type(approval[field]) is not int or not 1 <= approval[field] <= 604800:
            raise BackupError("Approved RPO/RTO must be between 1 and 604800 seconds")
    expected = config["expected"]
    if set(expected) != {
        "database",
        "server_address",
        "server_port",
        "postgres_major",
        "schema_revision",
    }:
        raise BackupError("Expected source identity is incomplete")
    if (
        expected["postgres_major"] != 17
        or type(expected["server_port"]) is not int
        or not (1 <= expected["server_port"] <= 65535)
    ):
        raise BackupError("PostgreSQL17 and a valid server port are required")
    for field in ("database", "schema_revision"):
        if not isinstance(expected[field], str) or not re.fullmatch(
            r"[A-Za-z0-9_]{1,63}", expected[field]
        ):
            raise BackupError("Expected database/revision is invalid")
    if not isinstance(expected["server_address"], str) or not expected["server_address"]:
        raise BackupError("Expected server address is required")
    if type(config["timeout_seconds"]) is not int or not 30 <= config["timeout_seconds"] <= 3600:
        raise BackupError("Job timeout must be between 30 and 3600 seconds")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,63}", config["service_name"]):
        raise BackupError("Service name is invalid")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", config["recipient_sha256"]):
        raise BackupError("Approved recipient fingerprint is required")
    for field in ("release_reference", "expected_mount_source"):
        if not isinstance(config[field], str) or not config[field].strip():
            raise BackupError("Release and destination references are required")
    private_file(config["service_file"])
    private_file(config["pass_file"])
    for field in ("destination", "work_directory"):
        private_directory(config[field])
    lock = Path(config["lock_file"])
    if not lock.is_absolute() or lock.parent != Path(config["work_directory"]):
        raise BackupError("Lock must be directly inside the private work directory")
    certificate = Path(config["recipient_certificate"])
    if not certificate.is_absolute() or not stat.S_ISREG(certificate.lstat().st_mode):
        raise BackupError("Recipient certificate must be an absolute regular file")
    service = configparser.ConfigParser(interpolation=None)
    service.read(config["service_file"])
    if config["service_name"] not in service or "password" in service[config["service_name"]]:
        raise BackupError("Use a dedicated service and passfile; no inline password")
    section = service[config["service_name"]]
    if "passfile" in section:
        raise BackupError("Service passfile override is forbidden; use approved PGPASSFILE")
    if section.get("dbname") != expected["database"] or not section.get("host"):
        raise BackupError("Service source does not match the expected database")
    return config


def child_environment(config):
    # No inherited PGHOST/PGPASSWORD/PGOPTIONS, service overrides, preload or shell startup.
    return {
        "PATH": "/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin",
        "LANG": "C",
        "LC_ALL": "C",
        "PGSERVICE": config["service_name"],
        "PGSERVICEFILE": config["service_file"],
        "PGPASSFILE": config["pass_file"],
        "PGCONNECT_TIMEOUT": "10",
    }


class Commands:
    def __init__(self, config):
        self.env = child_environment(config)
        self.deadline = time.monotonic() + config["timeout_seconds"]

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise BackupError("Backup job deadline exceeded")
        return remaining

    def run(self, command):
        if command[0] == "pg_dump" and "--version" not in command:
            return self.dump(command)
        try:
            result = subprocess.run(
                command,
                env=self.env,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=self.remaining(),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise BackupError("Backup CLI failed or exceeded deadline") from None
        if result.returncode:
            raise BackupError("Backup CLI failed; diagnostics withheld")
        return result.stdout.decode("utf-8").strip()

    def dump(self, command):
        # The first diagnostic byte fails the dump: no unbounded capture, warninged
        # success, or raw upstream diagnostic in logs. Always terminate/reap on failure.
        process = subprocess.Popen(
            command, env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
        )
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stderr, selectors.EVENT_READ)
                if not selector.select(self.remaining()):
                    raise BackupError("Backup dump deadline exceeded")
                if os.read(process.stderr.fileno(), 1):
                    raise BackupError("Backup dump emitted diagnostics; refusing publication")
            if process.wait(timeout=self.remaining()):
                raise BackupError("Backup dump failed; diagnostics withheld")
            return ""
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stderr.close()


@contextmanager
def job_lock(path):
    import fcntl

    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise BackupError("Unsafe backup lock file")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError("Another backup job holds the lock") from None
        yield
    finally:
        os.close(fd)


@contextmanager
def exported_snapshot(commands, expected):
    process = subprocess.Popen(
        ["psql", "-X", "-qAt", "-w", "-v", "ON_ERROR_STOP=1"],
        env=commands.env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        count_sql = (
            "SELECT json_build_object("
            + ",".join(f"'{table}',(SELECT count(*) FROM public.{table})" for table in TABLES)
            + ")::text;\n"
        )
        process.stdin.write(
            b"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
            b"SELECT pg_export_snapshot();\n"
            b"SELECT json_build_object('database',current_database(),"
            b"'server_address',host(inet_server_addr()),'server_port',inet_server_port(),"
            b"'postgres_major',current_setting('server_version_num')::int /10000,"
            b"'schema_revision',(SELECT version_num FROM public.alembic_version))::text;\n"
            + count_sql.encode("ascii")
        )
        process.stdin.flush()
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            lines, pending = [], b""
            while len(lines) < 3:
                if not selector.select(commands.remaining()):
                    raise BackupError("Source snapshot deadline exceeded")
                chunk = os.read(process.stdout.fileno(), 4096)
                if not chunk:
                    raise BackupError("Source snapshot failed")
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    lines.append(line.decode("utf-8"))
                if len(pending) > 4096:
                    raise BackupError("Unexpected source identity response")
        snapshot = lines[0]
        if not re.fullmatch(r"[A-Fa-f0-9-]{1,100}", snapshot):
            raise BackupError("Invalid exported snapshot")
        identity = json.loads(lines[1])
        if identity != expected:
            mismatches = [key for key in expected if identity.get(key) != expected[key]]
            raise BackupError(
                "Source identity or schema revision mismatch: " + ",".join(mismatches)
            )
        counts = json.loads(lines[2])
        if set(counts) != set(TABLES) or any(
            type(count) is not int or count < 0 for count in counts.values()
        ):
            raise BackupError("Invalid snapshot counts")
        yield snapshot, counts
    finally:
        # Read-only holder has no commit work. Always reap it before returning.
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdin.close()
        process.stdout.close()


def hash_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def sync_file(path):
    with path.open("rb") as stream:
        os.fsync(stream.fileno())


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def timestamp():
    return datetime.now(UTC).isoformat()


def destination_guard(commands, config, identity):
    current = Path(config["destination"]).stat()
    if (current.st_dev, current.st_ino) != identity or commands.run(
        ["findmnt", "-n", "-o", "SOURCE", "-T", config["destination"]]
    ) != config["expected_mount_source"]:
        raise BackupError("Approved offsite destination mount is absent or changed")


def execute(config):
    commands = Commands(config)
    with job_lock(config["lock_file"]):
        destination = Path(config["destination"])
        destination_identity = (destination.stat().st_dev, destination.stat().st_ino)
        destination_guard(commands, config, destination_identity)
        for tool in ("pg_dump", "psql"):
            if not re.search(r"\(PostgreSQL\) 17\.", commands.run([tool, "--version"])):
                raise BackupError("PostgreSQL17 CLI required")
        fingerprint = (
            commands.run(
                [
                    "openssl",
                    "x509",
                    "-in",
                    config["recipient_certificate"],
                    "-noout",
                    "-fingerprint",
                    "-sha256",
                ]
            )
            .split("=")[-1]
            .replace(":", "")
            .lower()
        )
        if fingerprint != config["recipient_sha256"].lower():
            raise BackupError("Recipient certificate fingerprint mismatch")
        commands.run(
            ["openssl", "x509", "-in", config["recipient_certificate"], "-noout", "-checkend", "0"]
        )
        set_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ_") + uuid4().hex
        final = destination / set_id
        started = timestamp()
        # Both temporary directories are newly owned by this run; never touch older sets.
        with tempfile.TemporaryDirectory(prefix="wos-plaintext-", dir=config["work_directory"]) as (
            work_name
        ):
            work = Path(work_name)
            destination_guard(commands, config, destination_identity)
            stage = Path(tempfile.mkdtemp(prefix=".wos-incomplete-", dir=destination))
            stage_identity = (stage.stat().st_dev, stage.stat().st_ino)
            complete = False
            try:
                with exported_snapshot(commands, config["expected"]) as (snapshot, counts):
                    commands.run(
                        [
                            "pg_dump",
                            "-w",
                            "--format=custom",
                            "--snapshot=" + snapshot,
                            "--file=" + str(work / "database.dump"),
                        ]
                    )
                    metadata = {
                        "format": 1,
                        "source": config["expected"],
                        "snapshot": snapshot,
                        "release_reference": config["release_reference"],
                        "started_at": started,
                        "dump_finished_at": timestamp(),
                        "approval": config["approval"],
                        "recipient_sha256": config["recipient_sha256"].lower(),
                        "counts": counts,
                    }
                    (work / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
                inventory = {}
                for filename in ("database.dump", "metadata.json"):
                    encrypted = stage / (filename + ".cms")
                    commands.run(
                        [
                            "openssl",
                            "cms",
                            "-encrypt",
                            "-binary",
                            "-aes-256-gcm",
                            "-outform",
                            "DER",
                            "-in",
                            str(work / filename),
                            "-out",
                            str(encrypted),
                            config["recipient_certificate"],
                        ]
                    )
                    if encrypted.stat().st_size == 0:
                        raise BackupError("Empty encrypted backup output")
                    inventory[encrypted.name] = {
                        "bytes": encrypted.stat().st_size,
                        "sha256": hash_file(encrypted),
                    }
                manifest = {
                    "format": 1,
                    "set_id": set_id,
                    "started_at": started,
                    "finished_at": timestamp(),
                    "cipher": "CMS AES-256-GCM DER",
                    "files": inventory,
                }
                (stage / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                (stage / "COMPLETE").write_text(set_id + "\n", encoding="utf-8")
                for path in stage.iterdir():
                    sync_file(path)
                sync_directory(stage)
                commands.remaining()
                destination_guard(commands, config, destination_identity)
                if final.exists():
                    raise BackupError("Backup set already exists; refusing overwrite")
                # Private destination + shared lock + opaque UUID namespace prevent a
                # competing publisher; same-filesystem directory rename is atomic.
                os.rename(stage, final)
                sync_directory(destination)
                destination_guard(commands, config, destination_identity)
                complete = True
                return {"status": "complete", "set_id": set_id}
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
                elif (
                    not complete
                    and final.exists()
                    and (final.stat().st_dev, final.stat().st_ino) == stage_identity
                ):
                    # A failure after rename (e.g. destination fsync) must not leave
                    # this run's success marker. Inode check never removes older sets.
                    shutil.rmtree(final)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    os.umask(0o077)

    # SIGTERM becomes a normal unwind so owned plaintext and child processes are reaped.
    def stop(*_):
        raise BackupError("Backup job interrupted")

    signal.signal(signal.SIGTERM, stop)
    try:
        report = execute(load_config(args.config))
    except (BackupError, OSError, ValueError, KeyError, TypeError, configparser.Error):
        print(
            "Backup failed; no success reported; inspect approved configuration/tools",
            file=sys.stderr,
        )
        return 1
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
