"""Complete connection-wide assignment load, exposing aggregates only to callers."""

import json
from datetime import datetime, time
from decimal import ROUND_CEILING, Decimal
from zoneinfo import ZoneInfo

from app.maximo.detail import code
from app.maximo.reader import MaximoReadError, read_collection
from app.maximo.tasks import relation


async def read_load(client, settings, laborcodes, date_from, date_before, timezone):
    if settings.task_load_contract != "bdsched_assignment_test":
        raise MaximoReadError("Assignment load contract is not verified")
    zone = ZoneInfo(timezone)
    start = datetime.combine(date_from, time.min, zone)
    before = datetime.combine(date_before, time.min, zone)
    assignments = {}
    for laborcode in sorted(set(laborcodes)):
        params = {
            "lean": "1",
            "oslc.select": "siteid,workorderid,istask,"
            "assignment{assignmentid,laborcode,craft,scheduledate,finishdate,laborhrs,status,_rowstamp}",
            "oslc.pageSize": str(settings.page_size),
            "ignorekeyref": "1",
            "_dropnulls": "0",
        }

        def validate(raw):
            site, wid = raw.get("siteid"), str(raw.get("workorderid"))
            if not isinstance(site, str) or not wid.isascii() or not wid.isdigit():
                raise MaximoReadError("Invalid load parent identity")
            if "assignment" not in raw:
                raise MaximoReadError("Assignment load relationship is missing")
            if raw["assignment"] == []:
                raise MaximoReadError("Matching assignment load relationship is empty")
            return relation(raw, "assignment"), (site, wid)

        # Maximo's OSLC predicate parser does not support the OR interval expression.
        # Two complete, disjoint AND queries retain carry-in rows without that syntax.
        predicates = [
            f"assignment.scheduledate>={json.dumps(start.isoformat())}"
            f" and assignment.scheduledate<{json.dumps(before.isoformat())}",
            f"assignment.scheduledate<{json.dumps(start.isoformat())}"
            f" and assignment.finishdate>{json.dumps(start.isoformat())}",
        ]
        roots = []
        for predicate in predicates:
            roots.extend(
                await read_collection(
                    client,
                    settings,
                    {
                        **params,
                        "oslc.where": f"assignment.laborcode={code(laborcode)} and {predicate}",
                    },
                    validate,
                )
            )
        for rows in roots:
            for row in rows:
                labor = row.get("laborcode")
                if not labor or not row.get("scheduledate"):
                    continue
                try:
                    scheduled = datetime.fromisoformat(row["scheduledate"])
                    finish = (
                        datetime.fromisoformat(row["finishdate"]) if row.get("finishdate") else None
                    )
                    hours = Decimal(str(row["laborhrs"]))
                    aid = str(row["assignmentid"])
                    if (
                        scheduled.tzinfo is None
                        or not hours.is_finite()
                        or hours < 0
                        or not aid.isdigit()
                        or (finish is not None and (finish.tzinfo is None or finish < scheduled))
                    ):
                        raise ValueError()
                except (ValueError, TypeError, KeyError):
                    raise MaximoReadError("Invalid assignment load") from None
                # The relational predicate chooses parents, not individual nested rows.
                if labor not in laborcodes or not (
                    scheduled < before
                    and (scheduled >= start or (finish is not None and finish > start))
                ):
                    continue
                if (
                    hours > 0
                    and finish is not None
                    and scheduled.astimezone(zone).date() != finish.astimezone(zone).date()
                ):
                    raise MaximoReadError(
                        "Cross-day Maximo assignment has no verified daily hours; "
                        "capacity is incomplete"
                    )
                data = {
                    "assignment_id": aid,
                    "laborcode": labor,
                    "date": scheduled.astimezone(zone).date(),
                    "minutes": int((hours * 60).to_integral_value(rounding=ROUND_CEILING)),
                    "scheduledate": scheduled.isoformat(),
                    "finishdate": finish.isoformat() if finish is not None else None,
                    "status": row.get("status"),
                    "craft": row.get("craft"),
                }
                if aid in assignments and assignments[aid] != data:
                    raise MaximoReadError("Divergent duplicate assignment load")
                assignments[aid] = data
    return assignments


def effective_load(local, remote, laborcode, day, exclude_id=None):
    relevant = {
        aid: row
        for aid, row in remote.items()
        if row["laborcode"] == laborcode and row["date"] == day
    }
    external = sum(row["minutes"] for row in relevant.values())
    pending = 0
    synced = 0
    for item in local:
        if item.id == exclude_id or item.laborcode != laborcode or item.date != day:
            continue
        upstream = relevant.get(item.assignment_id)
        if upstream and item.sync_state == "synced" and upstream["minutes"] == item.minutes:
            synced += item.minutes
        else:
            pending += item.minutes
    return {
        "local_minutes": pending,
        "external_minutes": external,
        "synced_minutes": synced,
        "allocated_minutes": external + pending,
    }
