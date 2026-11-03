"""A task may only be assigned once Maximo holds its schedule and PIC, on days inside that schedule.

Reads Maximo's current values rather than upload history, so a WO scheduled directly in Maximo
qualifies and a saved draft does not. The PIC only has to exist: it coordinates the WO and need
not be one of the people assigned.
"""

from zoneinfo import ZoneInfo

from fastapi import HTTPException


class ScheduleGateError(HTTPException):
    """Lets a batch report this reason instead of a generic scope failure."""


def missing_for_assign(order):
    return [
        label
        for label, absent in (
            ("Scheduled Start", not order.schedstart),
            ("Scheduled Finish", not order.schedfinish),
            ("PIC", not (order.assignedto or "").strip()),
        )
        if absent
    ]


def schedule_problem(order, dates, timezone):
    missing = missing_for_assign(order)
    if missing:
        return f"WO chưa có {', '.join(missing)} trên Maximo; hãy upload trước khi phân công."
    zone = ZoneInfo(timezone)
    start, finish = order.schedstart.astimezone(zone), order.schedfinish.astimezone(zone)
    outside = sorted({d for d in dates if not start.date() <= d <= finish.date()})
    if outside:
        days = ", ".join(f"{d:%d/%m/%Y}" for d in outside)
        return f"Ngày phân công {days} nằm ngoài lịch WO ({start:%d/%m/%Y} → {finish:%d/%m/%Y})."
    return None


def require_schedule(order, dates, timezone):
    problem = schedule_problem(order, dates, timezone)
    if problem:
        raise ScheduleGateError(409, problem)
