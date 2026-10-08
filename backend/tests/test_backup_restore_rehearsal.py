"""Safety boundaries and failure cleanup for the synthetic backup/restore operator tool."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

import backup_restore_rehearsal as rehearsal
from app.config import Settings


def settings(**overrides):
    return Settings(
        _env_file=None,
        environment=overrides.pop("environment", "test"),
        database_url=overrides.pop(
            "database_url", "postgresql+psycopg://test:synthetic@127.0.0.1:55432/scheduler_test"
        ),
        **overrides,
    )


@pytest.mark.parametrize(
    "override",
    [
        {"environment": "development"},
        {"database_url": "postgresql+psycopg://test:synthetic@127.0.0.1:55433/scheduler_test"},
        {"database_url": "postgresql+psycopg://test:synthetic@127.0.0.1:55432/scheduler"},
        {"database_url": "postgresql+psycopg://test:synthetic@remote.invalid:55432/scheduler_test"},
        {
            "database_url": "postgresql+psycopg://test:synthetic@127.0.0.1:55432/scheduler_test?host=evil"
        },
    ],
)
def test_rejects_nonisolated_settings_before_network(monkeypatch, override):
    connect = MagicMock()
    monkeypatch.setattr(rehearsal.psycopg, "connect", connect)
    with pytest.raises(ValueError, match="isolated"):
        rehearsal.rehearse(settings(**override))
    connect.assert_not_called()


@pytest.mark.parametrize("name", ["scheduler", "scheduler_test", "wos_rehearsal_source_other"])
def test_cleanup_refuses_unowned_object_names(name):
    with pytest.raises(ValueError, match="unowned"):
        rehearsal.require_owned_name(name, "123456abcdef", "source")


def test_cleanup_accepts_only_exact_generated_namespace():
    rehearsal.require_owned_name("wos_rehearsal_source_123456abcdef", "123456abcdef", "source")
    with pytest.raises(ValueError):
        rehearsal.require_owned_name("wos_rehearsal_source_invalid", "invalid", "source")


@pytest.mark.parametrize("container", ["--privileged", "bad name", "test;rm", "../test"])
def test_invalid_container_is_rejected_before_command(monkeypatch, tmp_path, container):
    run = MagicMock()
    monkeypatch.setattr(rehearsal.PostgreSQLTools, "run", run)
    with pytest.raises(ValueError, match="container"):
        rehearsal.PostgreSQLTools(rehearsal.guarded_url(settings()), tmp_path, container)
    run.assert_not_called()


def test_wrong_container_port_is_rejected(monkeypatch, tmp_path):
    monkeypatch.setattr(
        rehearsal.PostgreSQLTools,
        "run",
        MagicMock(
            return_value=MagicMock(
                stdout=b'{"5432/tcp":[{"HostPort":"55433","HostIp":"127.0.0.1"}]}'
            )
        ),
    )
    with pytest.raises(ValueError, match="does not match"):
        rehearsal.PostgreSQLTools(rehearsal.guarded_url(settings()), tmp_path, "test-db")


def test_native_password_is_in_private_passfile_not_command(monkeypatch, tmp_path):
    monkeypatch.setattr(rehearsal.shutil, "which", lambda name: f"/clients/{name}")
    tools = rehearsal.PostgreSQLTools(rehearsal.guarded_url(settings()), tmp_path, None)
    command = tools.command("pg_dump", "wos_rehearsal_source_123456abcdef")
    assert "synthetic" not in str(command)
    assert tools.env == {"PGPASSFILE": str(tmp_path / "pgpass")}
    assert "synthetic" in Path(tools.env["PGPASSFILE"]).read_text()


def test_known_postgres_cast_reparse_normalizes_without_hiding_value_changes():
    before = "ANY ((ARRAY['pending'::character varying, 'unknown'::character varying])::text[])"
    after = (
        "ANY (ARRAY[('pending'::character varying)::text, ('unknown'::character varying)::text])"
    )
    assert rehearsal.canonical_schema_sql(before) == after
    assert rehearsal.canonical_schema_sql(before.replace("unknown", "confirmed")) != after


@pytest.mark.parametrize("fail_create_at", [None, 1, 3])
def test_failure_drops_only_objects_successfully_created_by_this_run(monkeypatch, fail_create_at):
    admin = MagicMock()
    admin.__enter__.return_value = admin
    statements = []
    created = []

    def execute(statement):
        command = statement.as_string(None)
        statements.append(command)
        if command.startswith("CREATE"):
            if len(created) == fail_create_at:
                raise RuntimeError("Injected create failure")
            created.append(command.split('"')[1])

    admin.execute.side_effect = execute
    monkeypatch.setattr(rehearsal.psycopg, "connect", MagicMock(return_value=admin))
    engine = MagicMock()
    monkeypatch.setattr(rehearsal, "create_engine", MagicMock(return_value=engine))
    tools = MagicMock()
    tools.dump.side_effect = RuntimeError("Injected dump failure")
    monkeypatch.setattr(rehearsal, "PostgreSQLTools", MagicMock(return_value=tools))
    monkeypatch.setattr(rehearsal, "migrate", lambda *_: "synthetic-head")
    monkeypatch.setattr(rehearsal, "seed", lambda *_: (None, None, None))
    monkeypatch.setattr(rehearsal, "snapshot", lambda *_: ({}, {}))
    with pytest.raises(RuntimeError, match="Injected"):
        rehearsal.rehearse(settings())
    drops = [command for command in statements if command.startswith("DROP")]
    assert {command.split('"')[1] for command in drops} == set(created)
    assert all("scheduler_test" not in command and "IF EXISTS" not in command for command in drops)
    assert all("wos_rehearsal_" in command for command in drops)


def test_tool_failure_redacts_diagnostics(monkeypatch):
    monkeypatch.setattr(
        rehearsal.subprocess,
        "run",
        MagicMock(return_value=MagicMock(returncode=1, stderr=b"password=secret")),
    )
    with pytest.raises(RuntimeError) as error:
        rehearsal.PostgreSQLTools.run(["pg_dump"])
    assert "secret" not in str(error.value)
