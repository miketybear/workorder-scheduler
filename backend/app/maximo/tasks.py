"""Bounded task reads. Relationship data is never accepted from the browser."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.maximo.detail import code
from app.maximo.reader import MaximoReadError, read_collection


class PlannedLabor(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    craft: str = Field(min_length=1, max_length=50)
    labor_hours: Decimal = Field(ge=0)
    quantity: Decimal = Field(ge=0)


class TaskAssignment(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    assignment_id: str = Field(pattern=r"^[0-9]{1,30}$")
    task_id: int = Field(ge=0, strict=True)
    laborcode: str | None = Field(default=None, max_length=100)
    craft: str = Field(min_length=1, max_length=50)
    scheduledate: datetime | None = None
    labor_hours: Decimal = Field(ge=0)
    status: str = Field(min_length=1, max_length=50)
    revision: str | None = None

    @field_validator("scheduledate")
    @classmethod
    def aware(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Timezone required")
        return value


class Task(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_workorder_id: str
    task_id: int
    description: str | None = Field(max_length=1000)
    planned_labor: list[PlannedLabor]
    assignments: list[TaskAssignment]
    has_out_of_scope_demand: bool = False


TASK_SELECT = (
    "siteid,workorderid,wonum,bdpocdiscipline,status,istask,parent,"
    "rel.WOACTIVITYTASK{siteid,workorderid,taskid,description,"
    "rel.SHOWPLANLABOR{craft,laborhrs,quantity},"
    "rel.SHOWASSIGNMENT{assignmentid,taskid,laborcode,craft,scheduledate,laborhrs,status}},"
    "assignment{assignmentid,craft,laborcode,scheduledate,laborhrs,status,_rowstamp}"
)


def relation(raw, name):
    if raw.get(name + "_collectionref") or raw.get(name + "_responseInfo"):
        raise MaximoReadError("Task relationship is incomplete")
    rows = raw.get(name, [])
    if not isinstance(rows, list) or len(rows) > 2000 or any(not isinstance(x, dict) for x in rows):
        raise MaximoReadError("Invalid task relationship")
    return rows


def map_tasks(raw, key, discipline):
    if (
        str(raw.get("workorderid")) != key.workorder_id
        or raw.get("siteid") != key.site_id
        or raw.get("bdpocdiscipline") != discipline
        or raw.get("istask") not in (False, 0)
        or raw.get("parent") not in (None, "")
    ):
        raise MaximoReadError("Task parent outside requested scope")
    revisions = {}
    for assignment in relation(raw, "assignment"):
        aid = str(assignment.get("assignmentid"))
        if aid in revisions:
            raise MaximoReadError("Duplicate assignment identity")
        revisions[aid] = str(assignment["_rowstamp"]) if assignment.get("_rowstamp") else None
    tasks, ids, assignment_ids = [], set(), set()
    try:
        for row in relation(raw, "woactivitytask"):
            wid, tid = str(row.get("workorderid")), row.get("taskid")
            if not wid.isascii() or not wid.isdigit() or len(wid) > 30:
                raise MaximoReadError("Invalid task identity")
            if not isinstance(tid, int) or isinstance(tid, bool) or tid < 0:
                raise MaximoReadError("Invalid task number")
            if wid in ids or row.get("siteid", key.site_id) != key.site_id:
                raise MaximoReadError("Duplicate or mismatched task identity")
            ids.add(wid)
            planned = [
                PlannedLabor(
                    craft=p.get("craft"), labor_hours=p.get("laborhrs"), quantity=p.get("quantity")
                )
                for p in relation(row, "showplanlabor")
            ]
            assignments = []
            for a in relation(row, "showassignment"):
                aid = str(a.get("assignmentid"))
                if aid in assignment_ids or a.get("taskid") != tid:
                    raise MaximoReadError("Ambiguous assignment task identity")
                assignment_ids.add(aid)
                assignments.append(
                    TaskAssignment(
                        assignment_id=aid,
                        task_id=tid,
                        craft=a.get("craft"),
                        laborcode=a.get("laborcode"),
                        scheduledate=a.get("scheduledate"),
                        labor_hours=a.get("laborhrs"),
                        status=a.get("status"),
                        revision=revisions.get(aid),
                    )
                )
            # Mixed crafts must not leak assignment details to another discipline.
            tasks.append(
                Task(
                    task_workorder_id=wid,
                    task_id=tid,
                    description=row.get("description"),
                    planned_labor=[p for p in planned if p.craft == discipline],
                    assignments=[a for a in assignments if a.craft == discipline],
                    has_out_of_scope_demand=any(p.craft != discipline for p in planned)
                    or any(a.craft != discipline for a in assignments),
                )
            )
    except (ValidationError, TypeError):
        raise MaximoReadError("Invalid task response") from None
    return tasks


async def read_tasks(client, settings, key, discipline):
    if (
        not key.workorder_id.isascii()
        or not key.workorder_id.isdigit()
        or len(key.workorder_id) > 30
        or not 1 <= len(key.site_id) <= 50
    ):
        raise MaximoReadError("Invalid work order identity")
    params = {
        "lean": "1",
        "oslc.select": TASK_SELECT,
        "oslc.pageSize": "2",
        "ignorekeyref": "1",
        "oslc.where": f"siteid={code(key.site_id)} and workorderid={int(key.workorder_id)}"
        f" and bdpocdiscipline={code(discipline)}",
    }
    records = await read_collection(
        client,
        settings,
        params,
        lambda raw: (map_tasks(raw, key, discipline), (key.site_id, key.workorder_id)),
    )
    if len(records) != 1:
        raise MaximoReadError("Task parent not found")
    return records[0]
