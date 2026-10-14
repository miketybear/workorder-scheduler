"""Operator-only daily-plan contract. No public route, automatic rollback or write retry."""

import re
from datetime import UTC, date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.maximo.detail import code
from app.maximo.reader import MaximoReadError, read_collection
from app.maximo.task_sender import read_target, send_assignment, write_enabled

PROTECTED = (
    "assignmentid",
    "craft",
    "skilllevel",
    "wplaborid",
    "orgid",
    "parentassignid",
    "status",
    "laborcode",
    "laborhrs",
    "scheduledate",
    "finishdate",
    "startdate",
    "workdate",
    "_rowstamp",
)
IMMUTABLE = ("craft", "skilllevel", "wplaborid", "orgid", "parentassignid")


class DailySegment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    date: date
    scheduled_start: AwareDatetime
    minutes: int = Field(ge=1, le=630, strict=True)
    laborcode: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,100}$")


def identity(value):
    value = str(value)
    if not value.isascii() or not value.isdigit() or len(value) > 30:
        raise ValueError("Invalid assignment identity or revision")
    return value


def snapshots(rows):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 2000:
        raise ValueError("Complete assignment collection required")
    result = {}
    for row in rows:
        if not isinstance(row, dict) or not set(PROTECTED).issubset(row):
            raise ValueError("Full protected assignment baseline required")
        aid = identity(row["assignmentid"])
        identity(row["_rowstamp"])
        if aid in result:
            raise ValueError("Duplicate assignment identity")
        result[aid] = {key: row[key] for key in PROTECTED}
    return result


def build_daily_intent(target, source_id, segments, timezone):
    """Caller must first verify current Planner/PERSON, task scope and every daily capacity."""
    source_id = identity(source_id)
    before = snapshots(target["assignments"])
    source = before[source_id]
    if source["status"] != "WAITASGN" or source["laborcode"] or source["scheduledate"]:
        raise ValueError("Source must be an unassigned waiting slot")
    if not re.fullmatch(r"[A-Za-z0-9_~-]{1,1000}", target["resource_id"]):
        raise ValueError("Unsafe root resource")
    identity(target["root_revision"])
    segments = sorted([DailySegment.model_validate(s) for s in segments], key=lambda s: s.date)
    zone = ZoneInfo(timezone)
    if not 1 <= len(segments) <= 366 or len({s.date for s in segments}) != len(segments):
        raise ValueError("Choose unique daily segments")
    if (segments[-1].date - segments[0].date).days >= 366:
        raise ValueError("Daily plan exceeds the 366-day date window")
    if any(s.scheduled_start.astimezone(zone).date() != s.date for s in segments):
        raise ValueError("Scheduled start does not match the business date")
    if any(
        (s.scheduled_start.astimezone(UTC) + timedelta(minutes=s.minutes)).astimezone(zone).date()
        != s.date
        for s in segments
    ):
        raise ValueError("Daily segment finishes outside its business date")
    if len({s.laborcode for s in segments}) != 1:
        raise ValueError("Daily plan must retain one labor binding")
    demand = Decimal(str(source["laborhrs"]))
    if not demand.is_finite() or demand <= 0 or sum(s.minutes for s in segments) != demand * 60:
        raise ValueError("Daily minutes must equal the original source demand")
    children = []
    for index, segment in enumerate(segments):
        child = dict(
            laborcode=segment.laborcode,
            scheduledate=segment.scheduled_start.isoformat(),
            laborhrs=segment.minutes / 60,
        )
        if index == 0:
            child.update(
                assignmentid=int(source_id), _rowstamp=str(source["_rowstamp"]), _action="AddChange"
            )
        else:
            child.update(
                _action="Add", **{k: source[k] for k in IMMUTABLE[:-1] if source[k] is not None}
            )
        children.append(child)
    return dict(
        contract="daily_plan_operator_test_v1",
        resource_id=target["resource_id"],
        root_revision=target["root_revision"],
        source_id=source_id,
        before=before,
        segments=[s.model_dump(mode="json") for s in segments],
        payload={"_rowstamp": target["root_revision"], "assignment": children},
    )


def matches_segment(row, segment, source, *, original):
    from datetime import datetime

    start = datetime.fromisoformat(row["scheduledate"]) if row["scheduledate"] else None
    finish = datetime.fromisoformat(row["finishdate"]) if row["finishdate"] else None
    expected = segment.scheduled_start.astimezone(UTC)
    return (
        start is not None
        and finish is not None
        and start.tzinfo is not None
        and finish.tzinfo is not None
        and start.astimezone(UTC) == expected
        and finish.astimezone(UTC) == expected + timedelta(minutes=segment.minutes)
        and Decimal(str(row["laborhrs"])) * 60 == segment.minutes
        and row["laborcode"] == segment.laborcode
        and row["status"] == "ASSIGNED"
        and all(row[k] == source[k] for k in IMMUTABLE[:-1])
        and row["parentassignid"] == (source["parentassignid"] if original else 0)
    )


def reconcile_daily_intent(intent, target, persisted_mapping=None):
    """Pure read-back classification; no mutation or deletion of unexpected rows."""

    def unknown(reason):
        return {"state": "unknown", "reason": reason, "mapping": None}

    try:
        if target["resource_id"] != intent["resource_id"]:
            return unknown("root_identity_changed")
        after, before = snapshots(target["assignments"]), intent["before"]
        source_id = intent["source_id"]
        if not set(before).issubset(after):
            return unknown("original_identity_missing")
        if any(after[aid] != row for aid, row in before.items() if aid != source_id):
            return unknown("untouched_sibling_changed")
        segments = [DailySegment.model_validate(s) for s in intent["segments"]]
        new_ids = set(after) - set(before)
        if len(new_ids) != len(segments) - 1:
            return unknown("partial_or_unexpected_new_rows")
        if not matches_segment(after[source_id], segments[0], before[source_id], original=True):
            return unknown("source_does_not_match")
        mapping = [{"date": segments[0].date.isoformat(), "assignment_id": source_id}]
        consumed = set()
        for segment in segments[1:]:
            candidates = [
                aid
                for aid in new_ids
                if matches_segment(after[aid], segment, before[source_id], original=False)
            ]
            if len(candidates) != 1 or candidates[0] in consumed:
                return unknown("ambiguous_child_mapping")
            consumed.add(candidates[0])
            mapping.append({"date": segment.date.isoformat(), "assignment_id": candidates[0]})
        if persisted_mapping is not None and mapping != persisted_mapping:
            return unknown("persisted_child_identity_changed")
        return {"state": "confirmed", "reason": None, "mapping": mapping}
    except (KeyError, ValueError, TypeError, ArithmeticError):
        return unknown("invalid_or_incomplete_readback")


async def send_daily_intent(client, settings, connection, intent, attempt_id, *, app_environment):
    """Exactly one audited request. An unknown outcome must use read-only reconciliation."""
    if app_environment not in {"development", "test"} or not write_enabled(settings, connection):
        raise ValueError("Daily-plan writer is restricted to the existing operator Test contract")
    return await send_assignment(
        client, settings, {"resource_id": intent["resource_id"]}, intent["payload"], attempt_id
    )


async def read_daily_target(client, settings, site_id, task_workorder_id, source_id, discipline):
    """Only this full-select reader may canonicalize omitted nullable Maximo properties."""
    task_workorder_id, source_id = identity(task_workorder_id), identity(source_id)
    allocation = SimpleNamespace(
        site_id=site_id,
        task_workorder_id=task_workorder_id,
        assignment_id=source_id,
        discipline=discipline,
    )
    target = await read_target(client, settings, allocation)
    required = {
        "assignmentid",
        "craft",
        "orgid",
        "parentassignid",
        "status",
        "laborhrs",
        "_rowstamp",
    }

    def validate(raw):
        if raw.get("siteid") != site_id or str(raw.get("workorderid")) != task_workorder_id:
            raise MaximoReadError("Daily target outside requested task")
        rows = raw.get("assignment")
        if (
            not isinstance(rows, list)
            or any(not isinstance(r, dict) or not required.issubset(r) for r in rows)
            or raw.get("assignment_responseInfo")
            or raw.get("assignment_collectionref")
        ):
            raise MaximoReadError("Daily target lacks complete protected assignment state")
        # Lean/null omission is accepted only for fields explicitly selected below.
        normalized = [{key: row.get(key) for key in PROTECTED} for row in rows]
        try:
            states = snapshots(normalized)
            root_revision = identity(raw.get("_rowstamp"))
            target_ids = {identity(r["assignmentid"]) for r in target["assignments"]}
        except (KeyError, ValueError, TypeError):
            raise MaximoReadError("Invalid daily target assignment state") from None
        if (
            root_revision != target["root_revision"]
            or set(states) != target_ids
            or source_id not in states
            or states[source_id]["_rowstamp"] != target["assignment"]["_rowstamp"]
        ):
            raise MaximoReadError("Daily target changed while reading full baseline")
        return normalized, (site_id, task_workorder_id)

    params = {
        "lean": "1",
        "oslc.select": "siteid,workorderid,_rowstamp,assignment{" + ",".join(PROTECTED) + "}",
        "oslc.where": f"siteid={code(site_id)} and workorderid={int(task_workorder_id)}",
        "oslc.pageSize": "2",
        "ignorecollectionref": "1",
        "_dropnulls": "0",
    }
    roots = await read_collection(client, settings, params, validate)
    if len(roots) != 1:
        raise MaximoReadError("Daily target not found")
    target["assignments"] = roots[0]
    target["assignment"] = next(r for r in roots[0] if identity(r["assignmentid"]) == source_id)
    return target
