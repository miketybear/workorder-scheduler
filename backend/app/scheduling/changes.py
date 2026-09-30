from datetime import datetime
from decimal import Decimal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class WorkOrderBaseline(BaseModel):
    model_config = ConfigDict(extra="forbid")
    worktype: str
    schedstart: AwareDatetime | None = None
    schedfinish: AwareDatetime | None = None
    targstartdate: AwareDatetime | None = None
    targcompdate: AwareDatetime | None = None
    assignedtechname: str | None = None
    estdur: Decimal | None = None


class ScheduleChanges(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    schedstart: AwareDatetime | None = None
    schedfinish: AwareDatetime | None = None
    assignedtechname: str | None = Field(default=None, min_length=1)
    estdur: Decimal | None = Field(default=None, ge=0)
    change_target: bool = False
    targstartdate: AwareDatetime | None = None
    targcompdate: AwareDatetime | None = None

    @model_validator(mode="after")
    def reject_clearing(self):
        for field in self.model_fields_set - {"change_target"}:
            if getattr(self, field) is None:
                raise ValueError(
                    "Clearing values is not supported until Maximo semantics are verified"
                )
        return self


def build_changes(
    baseline: WorkOrderBaseline, changes: ScheduleChanges, allowed_pics: set[str]
) -> dict[str, str | datetime | Decimal]:
    """Validate against a current, scoped upstream baseline; this function never sends a write."""
    values = changes.model_dump(exclude_unset=True, exclude={"change_target"})
    if {"targstartdate", "targcompdate"} & values.keys():
        if not changes.change_target:
            raise ValueError("Target changes require explicit intent")
        if baseline.worktype.upper() in {"PM", "CFT"}:
            raise ValueError("Target dates cannot be changed for PM or CFT")
    if "assignedtechname" in values and values["assignedtechname"] not in allowed_pics:
        raise ValueError("PIC is not in the permitted crew")
    for start_field, finish_field in (
        ("schedstart", "schedfinish"),
        ("targstartdate", "targcompdate"),
    ):
        if not ({start_field, finish_field} & values.keys()):
            continue
        start = values.get(start_field, getattr(baseline, start_field))
        finish = values.get(finish_field, getattr(baseline, finish_field))
        if start is None or finish is None:
            raise ValueError("Both start and finish are required when scheduling")
        if finish < start:
            raise ValueError("Finish cannot precede start")
    return {key: value for key, value in values.items() if value != getattr(baseline, key)}
