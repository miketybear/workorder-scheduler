"""Synthetic-only pg_dump/pg_restore rehearsal on the guarded integration server.

Run from backend/: uv run python backup_restore_rehearsal.py
On Windows without PostgreSQL clients add --docker-container wos-tests-db-1.
No application database is dumped. Temporary databases, roles and archive are removed.
"""

import argparse
import asyncio
import hashlib
import json
import re
import shutil
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import psycopg
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from psycopg import sql
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.audit.uploads import recover_stale_sends, transition_upload
from app.config import Settings, integration_settings
from app.db.models import (
    AccessGrant,
    AdminAuthorityEvent,
    AuditEvent,
    AuthorizationEvent,
    Base,
    Draft,
    DraftItem,
    DraftSubmission,
    LoginFlow,
    LoginSession,
    MaximoConnection,
    MaximoPersonBinding,
    PlannerPermission,
    UploadBatch,
    UploadItem,
    User,
    UserConnectionSetting,
)

ROOT = Path(__file__).resolve().parent


def guarded_url(settings: Settings) -> URL:
    url = make_url(settings.database_url.get_secret_value())
    if (
        settings.environment != "test"
        or url.host != "127.0.0.1"
        or url.port != 55432
        or url.database != "scheduler_test"
        or url.query
    ):
        raise ValueError("Rehearsal requires the isolated local integration database configuration")
    return url


def require_owned_name(name: str, suffix: str, kind: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{12}", suffix) or name != f"wos_rehearsal_{kind}_{suffix}":
        raise ValueError("Refusing operation on an unowned rehearsal object")


class PostgreSQLTools:
    def __init__(self, url: URL, directory: Path, container: str | None):
        self.url, self.container = url, container
        self.env = None
        if container:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", container):
                raise ValueError("Invalid Docker container name or ID")
            result = self.run(
                ["docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", container]
            )
            ports = json.loads(result.stdout)
            bindings = ports.get("5432/tcp") or []
            if not any(
                binding["HostPort"] == str(url.port)
                and binding["HostIp"] in {"127.0.0.1", "0.0.0.0", "::"}
                for binding in bindings
            ):
                raise ValueError("Docker PostgreSQL port does not match the integration server")
        else:
            self.executables = {}
            for name in ("psql", "pg_dump", "pg_restore"):
                executable = shutil.which(name)
                if not executable:
                    raise ValueError(
                        "PostgreSQL clients required; or select the test Docker container"
                    )
                self.executables[name] = executable
            # The password never appears in argv, command output or the report.
            password = str(url.password).replace("\\", "\\\\").replace(":", "\\:")
            passfile = directory / "pgpass"
            passfile.write_text(
                f"{url.host}:{url.port}:*:{url.username}:{password}\n", encoding="utf-8"
            )
            passfile.chmod(0o600)
            self.env = {"PGPASSFILE": str(passfile)}

    @staticmethod
    def run(command, **kwargs):
        result = subprocess.run(command, capture_output=True, timeout=120, **kwargs)
        if result.returncode:
            # Do not expose tool diagnostics that might include connection credentials.
            raise RuntimeError("PostgreSQL/Docker tool failed; no database data included in report")
        return result

    def command(self, tool: str, database: str):
        if self.container:
            return [
                "docker",
                "exec",
                "-i",
                self.container,
                tool,
                "-U",
                self.url.username,
                "-d",
                database,
            ]
        return [
            self.executables[tool],
            "-h",
            self.url.host,
            "-p",
            str(self.url.port),
            "-U",
            self.url.username,
            "-d",
            database,
        ]

    def provision(self, database: str, owner: str, runtime: str):
        self.run(
            self.command("psql", database)
            + [
                "-X",
                "-v",
                "ON_ERROR_STOP=1",
                "-v",
                f"owner_role={owner}",
                "-v",
                f"runtime_role={runtime}",
            ],
            input=(ROOT / "sql/provision_roles.sql").read_bytes(),
            env=self.env,
        )

    def dump(self, database: str, archive: Path):
        with archive.open("wb") as output:
            result = subprocess.run(
                self.command("pg_dump", database) + ["--format=custom"],
                stdout=output,
                stderr=subprocess.PIPE,
                env=self.env,
                timeout=120,
            )
        if result.returncode or archive.read_bytes()[:5] != b"PGDMP":
            raise RuntimeError("Custom-format dump failed")

    def restore(self, database: str, archive: Path):
        with archive.open("rb") as source:
            self.run(
                self.command("pg_restore", database) + ["--exit-on-error", "--single-transaction"],
                stdin=source,
                env=self.env,
            )


def migrate(engine, owner: str) -> str:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    scripts = ScriptDirectory.from_config(config)
    head = scripts.get_current_head()
    with engine.begin() as db:
        db.execute(text(f'SET ROLE "{owner}"'))
        with Operations.context(MigrationContext.configure(db)):
            for revision in reversed(list(scripts.walk_revisions())):
                revision.module.upgrade()
        db.execute(text("CREATE TABLE alembic_version(version_num varchar(32) PRIMARY KEY)"))
        db.execute(text("INSERT INTO alembic_version VALUES (:head)"), {"head": head})
        db.execute(text("RESET ROLE"))
    return head


def seed(engine):
    now = datetime.now(UTC)
    with Session(engine) as db, db.begin():
        user = User(tenant_id=uuid4(), object_id=uuid4(), display_name="Synthetic planner")
        connection = MaximoConnection(
            system="onshore",
            environment="test",
            label="Synthetic only",
            base_url="https://maximo.example.invalid",
            timezone="Asia/Ho_Chi_Minh",
            secret_reference="synthetic-no-secret",
            enabled=False,
        )
        db.add_all([user, connection])
        db.flush()
        draft = Draft(owner_id=user.id, connection_id=connection.id, version=3)
        batch = UploadBatch(actor_id=user.id, idempotency_key=uuid4(), request_hash="a" * 64)
        db.add_all([draft, batch])
        db.flush()
        db.add_all(
            [
                AccessGrant(
                    user_id=user.id,
                    connection_id=connection.id,
                    discipline="MECH",
                    capability="write",
                ),
                PlannerPermission(user_id=user.id, connection_id=connection.id, discipline="MECH"),
                MaximoPersonBinding(
                    user_id=user.id, connection_id=connection.id, person_id="SYNTHETIC"
                ),
                UserConnectionSetting(user_id=user.id, connection_id=connection.id),
                DraftSubmission(
                    actor_id=user.id,
                    request_id=uuid4(),
                    request_hash="b" * 64,
                    result={"draft_id": str(draft.id), "version": 3},
                ),
                LoginSession(
                    token_hash="c" * 64,
                    csrf_hash="d" * 64,
                    user_id=user.id,
                    created_at=now,
                    expires_at=now + timedelta(hours=8),
                ),
                LoginFlow(
                    token_hash="e" * 64,
                    flow={"synthetic": True},
                    expires_at=now + timedelta(minutes=10),
                ),
                AuthorizationEvent(
                    actor_id=user.id,
                    connection_id=connection.id,
                    event="synthetic",
                    details={"discipline": "MECH"},
                ),
                AdminAuthorityEvent(
                    user_id=user.id,
                    operator="Synthetic operator",
                    reason="Restore rehearsal",
                    details={"is_admin": False},
                ),
            ]
        )
        items = []
        for index, state in enumerate(
            ("pending", "sending", "confirmed", "failed", "conflict", "unknown")
        ):
            identity = dict(
                site_id="SYNTHETIC",
                workorder_id=str(index),
                wonum=f"TEST{index}",
                discipline="MECH",
                upstream_revision='"synthetic-v1"',
            )
            db.add(
                DraftItem(
                    draft_id=draft.id, **identity, baseline={"estdur": 8}, changes={"estdur": 9}
                )
            )
            item = UploadItem(
                batch_id=batch.id,
                connection_id=connection.id,
                **identity,
                before={"estdur": 8},
                changes={"estdur": 9},
                state=state,
                updated_at=now - timedelta(hours=1),
            )
            db.add(item)
            db.flush()
            items.append(item)
            db.add(
                AuditEvent(
                    upload_item_id=item.id,
                    actor_id=user.id,
                    event="intent",
                    details={"before": item.before, "changes": item.changes},
                )
            )
        return user.id, items[1].id, items[-1].id


def canonical_schema_sql(value):
    # PostgreSQL reparses dump SQL and pushes varchar-array casts into each element.
    # Normalize only this known equivalent spelling, preserving other expressions.
    if not isinstance(value, str):
        return value
    return re.sub(
        r"\(ARRAY\[((?:'[^']*'::character varying(?:, )?)+)\]\)::text\[\]",
        lambda match: (
            "ARRAY[" + ", ".join(f"({item})::text" for item in match[1].split(", ")) + "]"
        ),
        value,
    )


def snapshot(engine):
    """Canonical exact values plus schema/owners/ACLs; keep contents out of reports."""
    with engine.connect() as db:
        data = {}
        for name in [*sorted(Base.metadata.tables), "alembic_version"]:
            rows = db.execute(text(f'SELECT to_jsonb(t) FROM "{name}" t')).scalars().all()
            data[name] = sorted(json.dumps(row, sort_keys=True) for row in rows)
        schema = {}
        for label, query in {
            "tables": "SELECT relname, pg_get_userbyid(relowner), relacl::text "
            "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND relkind='r' ORDER BY relname",
            "schemas": "SELECT nspname,pg_get_userbyid(nspowner),nspacl::text "
            "FROM pg_namespace WHERE nspname='public'",
            "default_acls": "SELECT pg_get_userbyid(defaclrole),n.nspname,"
            "defaclobjtype,defaclacl::text FROM pg_default_acl d "
            "LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 1,2,3",
            "constraints": "SELECT conrelid::regclass::text, conname, "
            "pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE connamespace='public'::regnamespace ORDER BY 1,2",
            "indexes": "SELECT tablename,indexname,indexdef FROM pg_indexes "
            "WHERE schemaname='public' ORDER BY 1,2",
            "triggers": "SELECT tgrelid::regclass::text,tgname,pg_get_triggerdef(oid) "
            "FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1,2",
            "functions": "SELECT proname,pg_get_userbyid(proowner),proacl::text, "
            "pg_get_functiondef(p.oid) FROM pg_proc p "
            "WHERE pronamespace='public'::regnamespace ORDER BY proname",
            "columns": "SELECT table_name,column_name,data_type,is_nullable,column_default "
            "FROM information_schema.columns WHERE table_schema='public' "
            "ORDER BY table_name,ordinal_position",
            "column_types": "SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) "
            "FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid "
            "JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped "
            "ORDER BY c.relname,a.attnum",
        }.items():
            schema[label] = [
                tuple(canonical_schema_sql(value) for value in row)
                for row in db.execute(text(query))
            ]
        return data, schema


def verify_guards(engine, runtime: str):
    for table in ("audit_event", "authorization_event", "admin_authority_event"):
        for statement in (
            f"UPDATE {table} SET details='{{}}'",
            f"DELETE FROM {table}",
            f"TRUNCATE {table}",
        ):
            try:
                with engine.begin() as db:
                    db.execute(text(statement))
            except DBAPIError as error:
                if "append-only" not in str(error.orig):
                    raise RuntimeError("Unexpected append-only verification failure") from None
            else:
                raise RuntimeError("Restored append-only trigger failed")
    for statement in (
        "CREATE TABLE forbidden(id int)",
        "UPDATE app_user SET is_admin=true",
        "DELETE FROM draft_submission",
        "DELETE FROM upload_item",
        "UPDATE audit_event SET details='{}'",
        "TRUNCATE authorization_event",
        "INSERT INTO admin_authority_event SELECT * FROM admin_authority_event",
    ):
        try:
            with engine.begin() as db:
                db.execute(text(f'SET LOCAL ROLE "{runtime}"'))
                db.execute(text(statement))
        except DBAPIError as error:
            if not isinstance(error.orig, psycopg.errors.InsufficientPrivilege):
                raise RuntimeError("Unexpected runtime privilege verification failure") from None
        else:
            raise RuntimeError("Restored runtime privilege boundary failed")
    with engine.connect() as db, db.begin() as transaction:
        db.execute(text(f'SET LOCAL ROLE "{runtime}"'))
        if db.scalar(text("SELECT count(*) FROM draft_item")) != 6:
            raise RuntimeError("Runtime restored draft read failed")
        db.execute(text("UPDATE draft SET version=4 WHERE version=3"))
        if db.scalar(text("SELECT version FROM draft")) != 4:
            raise RuntimeError("Runtime restored draft write failed")
        transaction.rollback()


async def verify_recovery(url: URL, actor, sending, unknown, runtime: str):
    engine = create_async_engine(url, hide_parameters=True)

    @event.listens_for(engine.sync_engine, "connect")
    def runtime_role(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute(f'SET ROLE "{runtime}"')
        finally:
            cursor.close()
        dbapi_connection.commit()

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            if await db.scalar(text("SELECT current_user")) != runtime:
                raise RuntimeError("Recovery connection is not using the runtime role")
        cutoff = datetime.now(UTC) - timedelta(minutes=5)
        if await recover_stale_sends(sessions, cutoff) != 1:
            raise RuntimeError("Restored sending item was not recovered to unknown")
        if await recover_stale_sends(sessions, cutoff) != 0:
            raise RuntimeError("Recovery is not idempotent")
        for item_id in (sending, unknown):
            for following in ("sending", "confirmed"):
                try:
                    await transition_upload(sessions, item_id, actor, following)
                except ValueError:
                    pass
                else:
                    raise RuntimeError(
                        "Restored unknown outcome allowed retry/unreconciled success"
                    )
        async with sessions.begin() as db:
            item = await db.get(UploadItem, unknown)
            if item.state != "unknown":
                raise RuntimeError("Original unknown outcome changed during restore/recovery")
            clone = UploadItem(
                batch_id=item.batch_id,
                connection_id=item.connection_id,
                site_id=item.site_id,
                workorder_id=item.workorder_id,
                wonum=item.wonum,
                discipline=item.discipline,
                before=item.before,
                changes=item.changes,
                state="pending",
            )
        try:
            async with sessions.begin() as db:
                batch = UploadBatch(actor_id=actor, idempotency_key=uuid4(), request_hash="f" * 64)
                db.add(batch)
                await db.flush()
                clone.batch_id = batch.id
                db.add(clone)
        except IntegrityError as error:
            if error.orig.diag.constraint_name != "uq_active_upload_wo":
                raise RuntimeError("Unexpected restored upload lock constraint") from None
        else:
            raise RuntimeError("Restored unknown WO lock allowed a second active upload")
        async with sessions() as db:
            if await db.scalar(text("SELECT current_user")) != runtime:
                raise RuntimeError("Runtime role lost after rollback")
            states = list((await db.scalars(select(UploadItem.state))).all())
            if states.count("unknown") != 2 or "sending" in states:
                raise RuntimeError("Recovery changed unexpected upload states")
        await transition_upload(sessions, sending, actor, "confirmed", reconciled=True)
        async with sessions() as db:
            if (await db.get(UploadItem, sending)).state != "confirmed":
                raise RuntimeError("Runtime reconciled transition failed")
            outcome = await db.scalar(
                select(AuditEvent).where(
                    AuditEvent.upload_item_id == sending, AuditEvent.event == "confirmed"
                )
            )
            if outcome is None or outcome.details != {"state": "confirmed", "reconciled": True}:
                raise RuntimeError("Runtime reconciled audit outcome missing")
    finally:
        await engine.dispose()


def rehearse(settings: Settings, *, container: str | None = None) -> dict:
    url = guarded_url(settings)
    suffix = uuid4().hex[:12]
    names = {
        kind: f"wos_rehearsal_{kind}_{suffix}" for kind in ("source", "restore", "owner", "runtime")
    }
    created_databases, created_roles = [], []
    engines = []
    with TemporaryDirectory(prefix="wos-rehearsal-") as directory:
        tools = PostgreSQLTools(url, Path(directory), container)
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
                for kind in ("owner", "runtime"):
                    name = names[kind]
                    require_owned_name(name, suffix, kind)
                    admin.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(name)))
                    created_roles.append(kind)
                for kind in ("source", "restore"):
                    name = names[kind]
                    require_owned_name(name, suffix, kind)
                    admin.execute(
                        sql.SQL("CREATE DATABASE {} OWNER {} TEMPLATE template0").format(
                            sql.Identifier(name), sql.Identifier(names["owner"])
                        )
                    )
                    created_databases.append(kind)
                    engines.append(create_engine(url.set(database=name), hide_parameters=True))
                source, restored = engines
                head = migrate(source, names["owner"])
                actor, sending, unknown = seed(source)
                tools.provision(names["source"], names["owner"], names["runtime"])
                before = snapshot(source)
                archive = Path(directory) / "synthetic.dump"
                tools.dump(names["source"], archive)
                checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
                archive_bytes = archive.stat().st_size
                tools.restore(names["restore"], archive)
                if snapshot(restored) != before:
                    raise RuntimeError("Restored data/schema/ownership/ACLs differ from source")
                # pg_dump without --create excludes database-level CONNECT/TEMP grants.
                tools.provision(names["restore"], names["owner"], names["runtime"])
                verify_guards(restored, names["runtime"])
                asyncio.run(
                    verify_recovery(
                        url.set(database=names["restore"]),
                        actor,
                        sending,
                        unknown,
                        names["runtime"],
                    ),
                    loop_factory=asyncio.SelectorEventLoop,
                )
                return {
                    "schema_revision": head,
                    "tables_verified": len(before[0]),
                    "rows_verified": sum(len(rows) for rows in before[0].values()),
                    "archive_bytes": archive_bytes,
                    "archive_sha256": checksum,
                    "exact_data_schema_acl_match": True,
                    "append_only_verified": True,
                    "runtime_permissions_verified": True,
                    "unknown_no_resend_verified": True,
                    "synthetic_only": True,
                    "cleanup": "complete",
                }
            finally:
                for engine in engines:
                    engine.dispose()
                for kind in reversed(created_databases):
                    require_owned_name(names[kind], suffix, kind)
                    admin.execute(
                        sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(names[kind]))
                    )
                for kind in reversed(created_roles):
                    require_owned_name(names[kind], suffix, kind)
                    admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(names[kind])))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker-container", help="Test PostgreSQL container name or service ID")
    args = parser.parse_args()
    try:
        result = rehearse(integration_settings(), container=args.docker_container)
    except (
        ValueError,
        RuntimeError,
        psycopg.Error,
        DBAPIError,
        OSError,
        subprocess.SubprocessError,
    ):
        parser.exit(1, "Synthetic rehearsal failed; credentials and database contents omitted.\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
