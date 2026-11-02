from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest

from app.assignments.schedule_gate import schedule_problem

ZONE = "Asia/Ho_Chi_Minh"


def order(**fields):
    base = {
        "schedstart": datetime(2026, 11, 3, 1, 0, tzinfo=UTC),
        "schedfinish": datetime(2026, 11, 5, 20, 0, tzinfo=UTC),
        "assignedto": "HAIDQ",
    }
    return SimpleNamespace(**{**base, **fields})


@pytest.mark.parametrize(
    ("fields", "named"),
    [
        ({"schedstart": None}, "Scheduled Start"),
        ({"schedfinish": None}, "Scheduled Finish"),
        ({"assignedto": None}, "PIC"),
        ({"assignedto": "  "}, "PIC"),
    ],
)
def test_missing_maximo_values_block_even_without_dates(fields, named):
    assert named in schedule_problem(order(**fields), [], ZONE)


def test_days_compare_in_business_timezone_with_both_ends_included():
    # 20:00Z on the 5th is already the 6th in Ho Chi Minh.
    inside = [date(2026, 11, 3), date(2026, 11, 6)]
    assert schedule_problem(order(), inside, ZONE) is None
    assert "07/11/2026" in schedule_problem(order(), [date(2026, 11, 7)], ZONE)
    assert "02/11/2026" in schedule_problem(order(), [date(2026, 11, 2)], ZONE)


def test_only_the_outside_days_are_named():
    problem = schedule_problem(order(), [date(2026, 11, 4), date(2026, 11, 8)], ZONE)
    assert "08/11/2026" in problem
    assert "04/11/2026" not in problem


def test_pic_need_not_be_an_assignee():
    assert schedule_problem(order(assignedto="SOMEONE_ELSE"), [date(2026, 11, 4)], ZONE) is None
