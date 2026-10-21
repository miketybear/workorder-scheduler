from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.assignments.plan_release import PlanReleaseRequest


def body(**change):
    return dict(request_id=uuid4(), expected_version=1) | change


def test_valid_request_is_accepted():
    assert PlanReleaseRequest(**body()).expected_version == 1


@pytest.mark.parametrize(
    "change",
    [
        {"expected_version": 0},
        {"expected_version": True},
        {"expected_version": "1"},
        {"request_id": "not-a-uuid"},
        {"unexpected": 1},
    ],
)
def test_boundary_validation(change):
    with pytest.raises(ValidationError):
        PlanReleaseRequest(**body(**change))


def test_missing_fields_are_rejected():
    with pytest.raises(ValidationError):
        PlanReleaseRequest(request_id=uuid4())
