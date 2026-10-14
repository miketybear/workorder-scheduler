from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.assignments.summary import calculate


def task(qty=1):
    return {
        "has_out_of_scope_demand": False,
        "task_workorder_id": "2",
        "task_id": 10,
        "planned_labor": [{"craft": "E&I", "labor_hours": 10, "quantity": qty}],
        "assignments": [
            {
                "assignment_id": str(100 + i),
                "craft": "E&I",
                "labor_hours": 10,
                "laborcode": None,
                "scheduledate": None,
                "status": "WAITASGN",
            }
            for i in range(qty)
        ],
    }


def row(aid="100", minutes=600, sync_state="local"):
    return SimpleNamespace(
        assignment_id=aid, task_workorder_id="2", task_id=10, minutes=minutes, sync_state=sync_state
    )


def summary(tasks, rows):
    return calculate(tasks, rows, "E&I", datetime.now(UTC))


def test_assignment_rows_quantity_and_all_dates_coverage():
    tasks = [task(qty=2)]
    assert summary(tasks, [])["state"] == "unallocated"
    partial = summary(tasks, [row(minutes=300), row(minutes=300)])
    assert partial["state"] == "partial"
    assert partial["remaining_minutes"] == 600
    complete = summary(tasks, [row(), row("101", 300), row("101", 300)])
    assert complete["state"] == "completed"
    assert complete["total_tasks"] == 1
    assert complete["remaining_tasks"] == 0
    assert summary(tasks, [row(), row("101", 300)])["remaining_minutes"] == 300


def test_all_tasks_needed_for_completed():
    second = deepcopy(task())
    second["task_workorder_id"], second["task_id"] = "3", 20
    second["assignments"][0]["assignment_id"] = "200"
    assert summary([task(), second], [row()])["remaining_tasks"] == 1


@pytest.mark.parametrize("mutation", ["qty", "missing", "null", "craft", "unknown", "half_bound"])
def test_ambiguous_sources_stay_unverified(mutation):
    value = task()
    source = value["assignments"][0]
    if mutation == "qty":
        value["planned_labor"][0]["quantity"] = 2
    elif mutation == "missing":
        value["assignments"] = []
    elif mutation == "null":
        source["labor_hours"] = None
    elif mutation == "craft":
        source["craft"] = "MECH"
    elif mutation == "unknown":
        source["status"] = "UNKNOWN"
    else:
        source["laborcode"] = "PERSON"
    assert summary([value], [row()])["state"] == "unverified"


def test_remote_synced_deduplication_and_unresolved_local():
    value = task()
    value["assignments"][0].update(
        laborcode="PERSON", scheduledate="2026-10-01T00:00:00+07:00", status="ASSIGNED"
    )
    assert summary([value], [row(sync_state="synced")])["state"] == "completed"
    assert summary([value], [row()])["state"] == "unverified"
    assert summary([value], [row(sync_state="unknown")])["state"] == "unverified"


def test_empty_zero_or_orphan_demand_never_completed():
    assert summary([], [])["state"] == "unverified"
    assert summary([task()], [row("999")])["state"] == "unverified"
    value = task()
    value["assignments"][0]["labor_hours"] = 0
    assert summary([value], [])["state"] == "unverified"


def test_filtered_other_craft_tasks_or_old_snapshot_cannot_be_completed():
    outside = {
        "task_workorder_id": "3",
        "task_id": 20,
        "planned_labor": [],
        "assignments": [],
        "has_out_of_scope_demand": True,
    }
    assert summary([task(), outside], [row()])["state"] == "unverified"
    old = task()
    del old["has_out_of_scope_demand"]
    assert summary([old], [row()])["state"] == "unverified"
