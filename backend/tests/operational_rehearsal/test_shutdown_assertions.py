"""Negative recovery checks independent of Docker fault waits."""

from copy import deepcopy

import pytest
from shutdown_assertions import validate_restored


def fixture():
    body = dict(
        connection_id="connection",
        discipline="MECH",
        items=[
            dict(site_id="TEST", workorder_id=str(i), changes={"estdur": "9"})
            for i in range(1000, 1200)
        ],
    )
    actor = dict(connection_id="connection", discipline="MECH")
    receipt = dict(draft_id="draft", version=1)
    restored = {
        **receipt,
        "connection_id": "connection",
        "items": [{**deepcopy(item), "discipline": "MECH"} for item in body["items"]],
    }
    return body, receipt, actor, restored


def test_exact_restored_submission_accepts_numeric_duration_normalization():
    body, receipt, actor, restored = fixture()
    restored["items"][0]["changes"]["estdur"] = 9.0
    assert all(validate_restored(body, receipt, actor, restored).values())


@pytest.mark.parametrize(
    "mutation",
    [
        "key",
        "duplicate",
        "connection",
        "discipline",
        "version",
        "change",
        "extra_change",
        "missing_item",
    ],
)
def test_incorrect_restored_submission_rejected(mutation):
    body, receipt, actor, restored = fixture()
    if mutation == "key":
        restored["items"][0]["workorder_id"] = "9999"
    elif mutation == "duplicate":
        restored["items"][0] = deepcopy(restored["items"][1])
    elif mutation == "connection":
        restored["connection_id"] = "another"
    elif mutation == "discipline":
        restored["items"][0]["discipline"] = "OTHER"
    elif mutation == "version":
        restored["version"] = 2
    elif mutation == "change":
        restored["items"][0]["changes"]["estdur"] = "10"
    elif mutation == "extra_change":
        restored["items"][0]["changes"]["assignedtechname"] = "OTHER"
    else:
        restored["items"].pop()
    with pytest.raises(ValueError):
        validate_restored(body, receipt, actor, restored)


def test_container_log_capture_includes_uvicorn_stderr(monkeypatch):
    from subprocess import CompletedProcess

    from shutdown import capture_container_logs

    calls = []

    def run(command, **kwargs):
        calls.append(command)
        assert kwargs == {"capture_output": True, "text": True, "check": False}
        return CompletedProcess(
            command, 0, stdout="stdout message", stderr="timeout graceful shutdown exceeded"
        )

    monkeypatch.setattr("shutdown.subprocess.run", run)
    combined = capture_container_logs("owned-container")
    assert "stdout message" in combined
    assert "graceful shutdown" in combined
    assert calls == [["docker", "logs", "owned-container"]]


def test_container_log_capture_failure_cannot_pass(monkeypatch):
    from subprocess import CompletedProcess

    from shutdown import capture_container_logs

    monkeypatch.setattr(
        "shutdown.subprocess.run",
        lambda *args, **kwargs: CompletedProcess(args[0], 1, stdout="", stderr="error"),
    )
    with pytest.raises(RuntimeError):
        capture_container_logs("owned-container")
