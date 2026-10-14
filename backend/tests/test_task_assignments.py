from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.assignments.tasks import TaskSelection, select_tasks
from app.maximo.reader import MaximoReadError
from app.maximo.tasks import map_tasks
from app.scheduling.drafts import WorkOrderKey


def sample():
    return {
        "siteid": "TEST",
        "workorderid": 100,
        "bdpocdiscipline": "MECH",
        "istask": False,
        "assignment": [{"assignmentid": 300, "_rowstamp": "123"}],
        "woactivitytask": [
            {
                "workorderid": 200,
                "taskid": 10,
                "description": "Prepare",
                "showplanlabor": [{"craft": "MECH", "laborhrs": 0.5, "quantity": 1}],
                "showassignment": [
                    {
                        "assignmentid": 300,
                        "taskid": 10,
                        "craft": "MECH",
                        "laborhrs": 0.5,
                        "status": "WAITASGN",
                    }
                ],
            }
        ],
    }


def mapped(raw=None):
    return map_tasks(raw or sample(), WorkOrderKey(uuid4(), "TEST", "100"), "MECH")


def choice(**changes):
    return TaskSelection(
        task_workorder_id="200", task_id=10, assignment_id="300", minutes=30, **changes
    )


def test_missing_null_and_root_relation_deduplication():
    task = mapped()[0]
    assert len(task.assignments) == 1
    assert task.assignments[0].revision == "123"
    assert task.assignments[0].laborcode is None
    assert len(select_tasks([task], [choice()], "MECH")) == 1
    raw = sample()
    raw["woactivitytask"][0]["showassignment"][0]["scheduledate"] = None
    assert mapped(raw)[0].assignments[0].scheduledate is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("workorderid", 101),
        ("siteid", "OTHER"),
        ("bdpocdiscipline", "OTHER"),
        ("istask", True),
        ("parent", "PARENT"),
        ("woactivitytask_collectionref", "https://bad"),
    ],
)
def test_parent_scope_and_incomplete_relationship_fail_closed(field, value):
    raw = sample()
    raw[field] = value
    with pytest.raises(MaximoReadError):
        mapped(raw)


def test_duplicate_task_and_assignment_rejected():
    raw = sample()
    raw["woactivitytask"].append(deepcopy(raw["woactivitytask"][0]))
    with pytest.raises(MaximoReadError):
        mapped(raw)
    raw = sample()
    raw["woactivitytask"][0]["showassignment"] *= 2
    with pytest.raises(MaximoReadError):
        mapped(raw)


def test_mixed_craft_hidden_and_not_selectable():
    raw = sample()
    raw["woactivitytask"][0]["showassignment"][0]["craft"] = "E&I"
    tasks = mapped(raw)
    assert tasks[0].assignments == []
    assert tasks[0].has_out_of_scope_demand is True
    with pytest.raises(HTTPException) as error:
        select_tasks(tasks, [choice()], "MECH")
    assert error.value.status_code == 404


@pytest.mark.parametrize(
    "field,value",
    [("laborcode", "LAB"), ("scheduledate", "2026-10-01T06:00:00+07:00"), ("status", "ASSIGNED")],
)
def test_existing_remote_labor_is_not_overwritten(field, value):
    raw = sample()
    raw["woactivitytask"][0]["showassignment"][0][field] = value
    with pytest.raises(HTTPException) as error:
        select_tasks(mapped(raw), [choice()], "MECH")
    assert error.value.status_code == 409


def test_guessed_assignment_and_duplicate_selection_rejected():
    guessed = choice().model_copy(update={"assignment_id": "999"})
    with pytest.raises(HTTPException) as error:
        select_tasks(mapped(), [guessed], "MECH")
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        select_tasks(mapped(), [choice(), choice()], "MECH")
    assert error.value.status_code == 422
