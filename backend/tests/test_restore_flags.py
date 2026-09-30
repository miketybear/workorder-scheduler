from types import SimpleNamespace
from uuid import uuid4

from app.scheduling.changes import WorkOrderBaseline
from app.scheduling.drafts import CurrentWorkOrder, WorkOrderKey
from app.scheduling.routes import restored_item


def test_restored_draft_reports_upstream_change_and_removed_pic():
    old = WorkOrderBaseline(worktype="CM", estdur=8).model_dump(mode="json")
    item = SimpleNamespace(
        site_id="TEST",
        workorder_id="100",
        baseline=old,
        changes={"estdur": "9", "assignedtechname": "REMOVED"},
    )
    current = CurrentWorkOrder(
        WorkOrderKey(uuid4(), "TEST", "100"),
        "WO",
        "MECH",
        None,
        WorkOrderBaseline(worktype="CM", estdur=10),
        frozenset({"NEW"}),
    )
    result = restored_item(item, current)
    assert result["baseline_changed"] is True
    assert result["changes_valid_now"] is False
    assert result["baseline"]["estdur"] == "8"
    assert result["current"]["estdur"] == "10"
    assert result["changes"] == item.changes
