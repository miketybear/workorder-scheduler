import pytest

from app.audit.uploads import validate_transition


@pytest.mark.parametrize("state", ["pending", "sending"])
def test_unknown_cannot_be_retried(state):
    with pytest.raises(ValueError):
        validate_transition("unknown", state, True)


def test_unknown_requires_reconciliation():
    with pytest.raises(ValueError, match="reconciliation"):
        validate_transition("unknown", "confirmed", False)
    validate_transition("unknown", "confirmed", True)


@pytest.mark.parametrize("state", ["confirmed", "failed", "conflict"])
def test_terminal_outcomes_cannot_be_reopened(state):
    with pytest.raises(ValueError):
        validate_transition(state, "sending", False)
