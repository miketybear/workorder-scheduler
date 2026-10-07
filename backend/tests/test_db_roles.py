"""Actual temporary PostgreSQL roles/database on the guarded Docker test infrastructure."""

import os
import secrets
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from psycopg import sql
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.config import integration_settings

pytestmark = pytest.mark.integration


def test_provisioned_runtime_has_dml_but_no_ddl_admin_or_audit_mutation():
    settings = integration_settings()
    url = make_url(settings.database_url.get_secret_value())
    suffix = uuid4().hex[:12]
    database, owner, runtime = (f"wos_role_{suffix}", f"wos_owner_{suffix}", f"wos_run_{suffix}")
    password = secrets.token_urlsafe(32)
    admin = psycopg.connect(
        host=url.host,
        port=url.port,
        dbname=url.database,
        user=url.username,
        password=url.password,
        autocommit=True,
    )
    engine = None
    try:
        admin.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(owner)))
        admin.execute(
            sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                sql.Identifier(runtime), sql.Literal(password)
            )
        )
        admin.execute(
            sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(database), sql.Identifier(owner)
            )
        )
        engine = create_engine(url.set(database=database), hide_parameters=True)
        with engine.begin() as db:
            db.execute(text(f'SET ROLE "{owner}"'))
            migration_context = MigrationContext.configure(db)
            script = ScriptDirectory.from_config(Config("alembic.ini"))
            with Operations.context(migration_context):
                for revision in reversed(list(script.walk_revisions())):
                    revision.module.upgrade()
            db.execute(text("CREATE TABLE alembic_version(version_num varchar(32) PRIMARY KEY)"))
            db.execute(
                text(f'GRANT UPDATE(is_admin), INSERT(is_admin) ON app_user TO "{runtime}", PUBLIC')
            )
            db.execute(text(f'GRANT UPDATE(details) ON audit_event TO "{runtime}", PUBLIC'))
            db.execute(
                text(
                    f'ALTER DEFAULT PRIVILEGES FOR ROLE "{owner}" '
                    f'GRANT ALL ON TABLES TO "{runtime}"'
                )
            )
            db.execute(
                text(
                    f'ALTER DEFAULT PRIVILEGES FOR ROLE "{owner}" IN SCHEMA public '
                    f'GRANT ALL ON TABLES TO "{runtime}"'
                )
            )
            db.execute(text("RESET ROLE"))
        provision = Path("sql/provision_roles.sql").read_text(encoding="utf-8")

        def provision_roles():
            psql = shutil.which("psql")
            if psql:
                command = [
                    psql,
                    "-X",
                    "-h",
                    url.host,
                    "-p",
                    str(url.port),
                    "-U",
                    url.username,
                    "-d",
                    database,
                ]
                # Password travels only through the child environment, never argv/output.
                child_env = {**os.environ, "PGPASSWORD": url.password}
            else:
                command = [
                    "docker",
                    "exec",
                    "-i",
                    "wos-tests-db-1",
                    "psql",
                    "-X",
                    "-U",
                    "scheduler_test",
                    "-d",
                    database,
                ]
                child_env = None
            command.extend(["-v", f"owner_role={owner}", "-v", f"runtime_role={runtime}"])
            return subprocess.run(
                command,
                input=provision,
                env=child_env,
                text=True,
                capture_output=True,
                timeout=30,
            )

        with engine.begin() as db:
            db.execute(text(f'CREATE SCHEMA unsafe AUTHORIZATION "{runtime}"'))
        result = provision_roles()
        assert result.returncode != 0 and "must not own schemas or functions" in result.stderr
        with engine.begin() as db:
            db.execute(text("DROP SCHEMA unsafe"))
            db.execute(
                text("CREATE FUNCTION public.unsafe() RETURNS int LANGUAGE sql AS 'SELECT 1'")
            )
            db.execute(text(f'ALTER FUNCTION public.unsafe() OWNER TO "{runtime}"'))
        result = provision_roles()
        assert result.returncode != 0 and "must not own schemas or functions" in result.stderr
        with engine.begin() as db:
            db.execute(text("DROP FUNCTION public.unsafe()"))
        result = provision_roles()
        assert result.returncode == 0, result.stderr
        with engine.begin() as db:
            db.execute(text(f'SET ROLE "{owner}"'))
            db.execute(text("CREATE TABLE future_table(id integer)"))
            db.execute(
                text(
                    "CREATE FUNCTION public.future_function() RETURNS int "
                    "LANGUAGE sql AS 'SELECT 1'"
                )
            )
        with psycopg.connect(
            host=url.host,
            port=url.port,
            dbname=database,
            user=runtime,
            password=password,
            autocommit=True,
        ) as db:
            user_id, tenant_id, object_id = uuid4(), uuid4(), uuid4()
            db.execute(
                "INSERT INTO app_user(id,tenant_id,object_id,display_name,active) "
                "VALUES (%s,%s,%s,'Runtime user',true)",
                (user_id, tenant_id, object_id),
            )
            assert db.execute("SELECT is_admin FROM app_user").fetchone() == (False,)
            db.execute("SELECT id FROM app_user FOR UPDATE")
            db.execute(
                "UPDATE app_user SET display_name='Updated',login_name='test@example.invalid'"
            )
            db.execute(
                "INSERT INTO login_flow VALUES (%s,'{}',now() - interval '1 second')", ("a" * 64,)
            )
            db.execute("DELETE FROM login_flow WHERE expires_at <= now()")
            denied = [
                "CREATE TABLE forbidden(id integer)",
                "CREATE SCHEMA forbidden",
                "CREATE TEMP TABLE forbidden(id integer)",
                "TRUNCATE login_flow",
                "ALTER TABLE login_flow ADD COLUMN forbidden integer",
                "UPDATE app_user SET is_admin=true",
                "UPDATE app_user SET active=false",
                "UPDATE app_user SET tenant_id=gen_random_uuid()",
                "DELETE FROM app_user",
                "INSERT INTO app_user(id,tenant_id,object_id,display_name,active,is_admin) "
                "VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'Admin',true,true)",
                "UPDATE maximo_connection SET enabled=true",
                "DELETE FROM draft_submission",
                "DELETE FROM upload_item",
                "DELETE FROM upload_batch",
                "SELECT * FROM future_table",
                "SELECT public.future_function()",
                "INSERT INTO admin_authority_event(id,user_id,operator,reason,details) "
                f"VALUES(gen_random_uuid(),'{user_id}','Runtime','Escalation','{{}}')",
                f'SET ROLE "{owner}"',
            ]
            for table in ("audit_event", "authorization_event", "admin_authority_event"):
                denied.extend(
                    [
                        f"UPDATE {table} SET details='{{}}'",
                        f"DELETE FROM {table}",
                        f"TRUNCATE {table}",
                    ]
                )
            for statement in denied:
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    db.execute(statement)
            assert db.execute("SELECT is_admin FROM app_user").fetchone() == (False,)
    finally:
        if engine:
            engine.dispose()
        admin.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(database))
        )
        for role in (runtime, owner):
            admin.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))
        admin.close()
