import pytest

from app.auth.policy import Grant, permits


@pytest.mark.parametrize(
    ("connection", "discipline", "capability", "expected"),
    [
        ("onshore-test", "E&I", "read", True),
        ("onshore-test", "E&I", "write", True),
        ("offshore-test", "E&I", "read", False),
        ("onshore-test", "MECH", "write", False),
    ],
)
def test_grants_are_scoped(connection, discipline, capability, expected):
    assert (
        permits((Grant("onshore-test", "E&I", "write"),), connection, discipline, capability)
        is expected
    )


def test_read_grant_cannot_write_and_no_grants_deny():
    assert not permits((Grant("a", "MECH", "read"),), "a", "MECH", "write")
    assert not permits((), "a", "MECH", "read")
