from datetime import datetime

import pytest
from pydantic import ValidationError

from app.scheduling.changes import ScheduleChanges, WorkOrderBaseline, build_changes


@pytest.fixture
def baseline():
    return WorkOrderBaseline(
        worktype="CM",
        schedstart="2026-09-25T08:00:00+07:00",
        schedfinish="2026-09-25T17:00:00+07:00",
        estdur=8,
        targstartdate="2026-09-25T08:00:00+07:00",
        targcompdate="2026-09-30T17:00:00+07:00",
    )


@pytest.mark.parametrize("worktype", ["PM", "CFT"])
def test_target_restriction_enforced_on_server(baseline, worktype):
    baseline.worktype = worktype
    with pytest.raises(ValueError, match="PM or CFT"):
        build_changes(
            baseline,
            ScheduleChanges(change_target=True, targcompdate="2026-10-01T17:00:00+07:00"),
            set(),
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "COMP"},
        {"estdur": -1},
        {"estdur": "NaN"},
        {"schedstart": None},
        {"schedstart": "2026-09-25T08:00:00"},
    ],
)
def test_invalid_fields_rejected(payload):
    with pytest.raises(ValidationError):
        ScheduleChanges(**payload)


def test_partial_edit_validated_against_existing_finish(baseline):
    with pytest.raises(ValueError, match="precede"):
        build_changes(baseline, ScheduleChanges(schedstart="2026-09-26T08:00:00+07:00"), set())


def test_pic_membership_and_target_intent(baseline):
    with pytest.raises(ValueError, match="crew"):
        build_changes(baseline, ScheduleChanges(assignedtechname="OTHER"), {"DEMO"})
    with pytest.raises(ValueError, match="intent"):
        build_changes(baseline, ScheduleChanges(targcompdate="2026-10-01T17:00:00+07:00"), set())


def test_only_changed_fields_sent_and_offsets_preserved(baseline):
    result = build_changes(
        baseline, ScheduleChanges(estdur=8, schedfinish="2026-09-25T18:00:00+07:00"), set()
    )
    assert result == {"schedfinish": datetime.fromisoformat("2026-09-25T18:00:00+07:00")}
