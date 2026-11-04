"""Read-only child work orders of a parent the caller may already view."""

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.maximo.detail import code
from app.maximo.reader import MaximoReadError, read_collection

CHILD_SELECT = "siteid,workorderid,wonum,location,estdur,plusgsafetycrit,parent,istask"


class ChildWorkOrder(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False, coerce_numbers_to_str=True)
    workorderid: str = Field(pattern=r"^[0-9]{1,30}$")
    wonum: str = Field(min_length=1, max_length=50)
    location: str | None = Field(default=None, max_length=100)
    estdur: float | None = Field(default=None, ge=0)
    # Absent stays unknown: never present a missing flag as "not safety critical".
    plusgsafetycrit: bool | None = None


async def read_children(client, settings, site_id: str, wonum: str) -> list[ChildWorkOrder]:
    def validate(raw):
        # Tasks share `parent`; the where clause excludes them and this rejects any that slip in.
        if (
            raw.get("siteid") != site_id
            or raw.get("parent") != wonum
            or raw.get("istask") not in (False, 0)
        ):
            raise MaximoReadError("Child work order outside requested parent")
        try:
            child = ChildWorkOrder.model_validate(raw)
        except ValidationError:
            raise MaximoReadError("Invalid child work order response") from None
        return child, (site_id, child.workorderid)

    params = {
        "lean": "1",
        "oslc.select": CHILD_SELECT,
        "oslc.where": f"siteid={code(site_id)} and parent={code(wonum)} and istask=0",
        "oslc.pageSize": str(settings.page_size),
        "oslc.orderBy": "+wonum",
    }
    return await read_collection(client, settings, params, validate)
