from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.assignments.plan_segments import PlanSegmentsRequest


def body(**change):
    value = dict(
        request_id=uuid4(),
        expected_version=1,
        segments=[{"date": "2026-10-01", "minutes": 630}, {"date": "2026-10-03", "minutes": 570}],
    )
    return value | change


def test_valid_request_is_accepted():
    assert len(PlanSegmentsRequest(**body()).segments) == 2


@pytest.mark.parametrize(
    "change",
    [
        {"segments": []},
        {"segments": [{"date": "2026-10-01", "minutes": 0}]},
        {"segments": [{"date": "2026-10-01", "minutes": 631}]},
        {"segments": [{"date": "2026-10-01", "minutes": "60"}]},
        {"segments": [{"date": "2026-10-01", "minutes": 60}] * 2},
        {"segments": [{"date": "2026-10-01", "minutes": 60}, {"date": "2027-10-03", "minutes": 1}]},
        {"segments": [{"date": "9999-12-31", "minutes": 60}]},
        {"segments": [{"date": "2026-10-01", "minutes": 60}] * 367},
        {"expected_version": 0},
        {"expected_version": True},
        {"unexpected": 1},
    ],
)
def test_boundary_validation(change):
    with pytest.raises(ValidationError):
        PlanSegmentsRequest(**body(**change))
