from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.assignments.capacity import validate_capacity
from app.assignments.plans import TaskPlanRequest


def body():
    return dict(
        connection_id=uuid4(),
        site_id="TEST",
        workorder_id="100",
        discipline="MECH",
        person_id=uuid4(),
        task_workorder_id="200",
        task_id=10,
        assignment_id="300",
        total_minutes=1200,
        request_id=uuid4(),
        segments=[{"date": "2026-10-01", "minutes": 630}, {"date": "2026-10-03", "minutes": 570}],
    )


@pytest.mark.parametrize("change", ["sum", "duplicate", "span", "bool", "too_many"])
def test_plan_boundary_validation(change):
    value = body()
    if change == "sum":
        value["total_minutes"] = 1201
    elif change == "duplicate":
        value["segments"][1]["date"] = "2026-10-01"
    elif change == "span":
        value["segments"][1]["date"] = "2027-10-03"
    elif change == "bool":
        value["total_minutes"] = True
    else:
        value["segments"] = [{"date": "2026-10-01", "minutes": 1}] * 367
    with pytest.raises(ValidationError):
        TaskPlanRequest(**value)


@pytest.mark.parametrize(
    "hours,allocated,minutes,ok",
    [
        ("5", 60, 240, True),
        ("5", 60, 241, False),
        ("0", 0, 1, False),
        ("12", 0, 630, True),
        ("10.5", 1, 630, False),
    ],
)
def test_daily_budget_uses_lower_rota_capacity_and_hard_ceiling(hours, allocated, minutes, ok):
    day = SimpleNamespace(
        date=date(2026, 10, 1),
        code="1",
        craft="MECH",
        role="TECH",
        laborcode="LAB",
        capacity_hours=Decimal(hours),
    )
    if ok:
        validate_capacity(day, minutes, allocated)
    else:
        with pytest.raises(HTTPException) as error:
            validate_capacity(day, minutes, allocated)
        assert error.value.status_code == 409


@pytest.mark.parametrize("change", ["duplicate_source", "batch_span", "empty", "sum"])
def test_plan_batch_boundary_validation(change):
    from app.assignments.plans import TaskPlanBatchRequest

    first = body()
    common_keys = {
        "connection_id",
        "site_id",
        "workorder_id",
        "discipline",
        "person_id",
        "request_id",
    }
    common = {key: value for key, value in first.items() if key in common_keys}
    entry = {key: value for key, value in first.items() if key not in common_keys}
    second = {
        **entry,
        "assignment_id": "301",
        "task_workorder_id": "201",
        "task_id": 20,
        "total_minutes": 60,
        "segments": [{"date": "2026-10-04", "minutes": 60}],
    }
    if change == "duplicate_source":
        second["assignment_id"] = "300"
    elif change == "batch_span":
        second["segments"][0]["date"] = "2027-10-04"
    elif change == "sum":
        second["total_minutes"] = 61
    tasks = [] if change == "empty" else [entry, second]
    with pytest.raises(ValidationError):
        TaskPlanBatchRequest(**common, tasks=tasks)
