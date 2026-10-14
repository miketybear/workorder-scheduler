from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.assignments.capacity import validate_capacity
from app.assignments.routes import AllocationRequest


@pytest.mark.parametrize(
    "minutes,allocated,ok", [(270, 360, True), (271, 360, False), (630, 0, True)]
)
def test_integer_daily_capacity(minutes, allocated, ok):
    day = SimpleNamespace(
        code="1", craft="MECH", role="SUP", laborcode="LAB", capacity_hours=Decimal("10.5")
    )
    if ok:
        validate_capacity(day, minutes, allocated)
    else:
        with pytest.raises(HTTPException) as error:
            validate_capacity(day, minutes, allocated)
        assert error.value.status_code == 409


@pytest.mark.parametrize("code", ["", "AL", "O", "UNKNOWN"])
def test_off_blank_unknown_cannot_reserve(code):
    day = SimpleNamespace(
        code=code, craft="MECH", role="TECH", laborcode="LAB", capacity_hours=Decimal("0")
    )
    with pytest.raises(HTTPException):
        validate_capacity(day, 1, 0)
    with pytest.raises(HTTPException):
        validate_capacity(None, 1, 0)


def test_legacy_material_controller_capacity_cannot_reserve():
    day = SimpleNamespace(
        code="1",
        craft="MECH",
        role="MATERIAL_CONTROLLER",
        laborcode="LAB",
        capacity_hours=Decimal("10.5"),
    )
    with pytest.raises(HTTPException) as error:
        validate_capacity(day, 1, 0)
    assert error.value.status_code == 409


@pytest.mark.parametrize("minutes", [0, 631, 10.5, "60", True])
def test_api_rejects_non_integer_or_out_of_budget_minutes(minutes):
    from uuid import uuid4

    with pytest.raises(ValidationError):
        AllocationRequest(
            connection_id=uuid4(),
            site_id="TEST",
            workorder_id="100",
            discipline="MECH",
            person_id=uuid4(),
            date="2026-10-01",
            minutes=minutes,
            request_id=uuid4(),
        )


@pytest.mark.parametrize(
    "craft,discipline", [("DECK", "MECH"), ("OTHER", "OTHER"), ("E&I", "MECH")]
)
def test_resource_discipline_is_exact_and_supported(craft, discipline):
    from app.assignments.routes import require_resource_discipline

    with pytest.raises(HTTPException) as error:
        require_resource_discipline(craft, discipline)
    assert error.value.status_code == 404
