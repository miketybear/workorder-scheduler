"""Isolated, opt-in test writer for one existing task assignment."""

import re
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

import httpx

from app.maximo.detail import code
from app.maximo.reader import MaximoReadError, read_collection
from app.maximo.tasks import relation
from app.maximo.write_contract_probe import ibm_conflict_object, ibm_reason_code


def write_enabled(settings, connection):
    return bool(
        settings.assignment_write_contract == "native_assignment_rowstamp_test"
        and settings.collection_url.lower().endswith("/oslc/os/bdsched_wo")
        and connection.enabled
        and connection.system == "onshore"
        and connection.environment == "test"
    )


async def read_target(client, settings, allocation):
    params = {
        "lean": "1",
        "oslc.select": "siteid,workorderid,href,_rowstamp,"
        "assignment{assignmentid,craft,laborcode,scheduledate,laborhrs,status,_rowstamp}",
        "oslc.where": f"siteid={code(allocation.site_id)}"
        f" and workorderid={int(allocation.task_workorder_id)}",
        "oslc.pageSize": "2",
        "ignorecollectionref": "1",
    }

    def validate(raw):
        if (
            raw.get("siteid") != allocation.site_id
            or str(raw.get("workorderid")) != allocation.task_workorder_id
        ):
            raise MaximoReadError("Assignment target outside requested task")
        all_assignments = relation(raw, "assignment")
        assignment_ids = [str(a.get("assignmentid")) for a in all_assignments]
        if any(not aid.isascii() or not aid.isdigit() for aid in assignment_ids) or len(
            set(assignment_ids)
        ) != len(assignment_ids):
            raise MaximoReadError("Ambiguous sibling assignment identity")
        assignments = [
            a for a in all_assignments if str(a.get("assignmentid")) == allocation.assignment_id
        ]
        if len(assignments) != 1 or assignments[0].get("craft") != allocation.discipline:
            raise MaximoReadError("Task assignment not found")
        base, href = urlsplit(settings.collection_url), urlsplit(raw.get("href", ""))
        collection_prefix, object_structure = base.path.rsplit("/", 1)
        segments = href.path.removeprefix(collection_prefix + "/").split("/")
        resource_id = segments[1] if len(segments) == 2 else ""
        if (
            href.scheme not in {"http", "https"}
            or href.query
            or href.fragment
            or href.username
            or href.password
            or "\\" in raw.get("href", "")
            or any(ord(c) < 32 for c in raw.get("href", ""))
            or not href.path.startswith(collection_prefix + "/")
            or len(segments) != 2
            or segments[0].lower() != object_structure.lower()
            or not re.fullmatch(r"[A-Za-z0-9_~-]+", resource_id)
        ):
            raise MaximoReadError("Unsafe assignment resource identity")
        root_stamp, child_stamp = (
            str(raw.get("_rowstamp", "")),
            str(assignments[0].get("_rowstamp", "")),
        )
        if not root_stamp.isdigit() or not child_stamp.isdigit():
            raise MaximoReadError("Assignment rowstamp unavailable")
        return {
            "resource_id": resource_id,
            "root_revision": root_stamp,
            "assignment": assignments[0],
            "assignments": all_assignments,
        }, (allocation.site_id, allocation.task_workorder_id)

    roots = await read_collection(client, settings, params, validate)
    if len(roots) != 1:
        raise MaximoReadError("Task assignment target not found")
    return roots[0]


def payload(target, allocation, scheduled_start):
    return {
        "_rowstamp": target["root_revision"],
        "assignment": [
            {
                "assignmentid": int(allocation.assignment_id),
                "_rowstamp": str(target["assignment"]["_rowstamp"]),
                "_action": "AddChange",
                "laborcode": allocation.laborcode,
                "scheduledate": scheduled_start,
                "laborhrs": allocation.minutes / 60,
            }
        ],
    }


def sibling_state(rows, selected_id):
    result = {}
    for row in rows:
        aid = str(row.get("assignmentid"))
        if aid == str(selected_id):
            continue
        if aid in result or not aid.isascii() or not aid.isdigit():
            raise ValueError("Ambiguous sibling")
        hours = row.get("laborhrs")
        normalized_hours = None if hours is None else Decimal(str(hours))
        if normalized_hours is not None and not normalized_hours.is_finite():
            raise ValueError("Invalid sibling hours")
        scheduled = row.get("scheduledate")
        if scheduled is not None:
            scheduled = datetime.fromisoformat(scheduled)
            if scheduled.tzinfo is None:
                raise ValueError("Invalid sibling date")
            scheduled = scheduled.astimezone(UTC)
        result[aid] = {
            "laborcode": row.get("laborcode"),
            "craft": row.get("craft"),
            "scheduledate": scheduled,
            "laborhrs": normalized_hours,
            "status": row.get("status"),
            "revision": row.get("_rowstamp"),
        }
    return result


def siblings_unchanged(before, after, selected_id):
    # Old intents without the full collection cannot prove that a sparse update was safe.
    if not isinstance(before.get("assignments"), list) or not isinstance(
        after.get("assignments"), list
    ):
        return False
    try:
        return sibling_state(before["assignments"], selected_id) == sibling_state(
            after["assignments"], selected_id
        )
    except (ValueError, TypeError, InvalidOperation):
        return False


async def send_assignment(client, settings, target, intent, attempt_id):
    # Payload only comes from the saved, audited server intent.
    try:
        async with client.stream(
            "POST",
            settings.collection_url + "/" + target["resource_id"],
            params={"lean": "1"},
            json=intent,
            headers={
                "apikey": settings.api_key.get_secret_value(),
                "Accept": "application/json",
                "x-method-override": "PATCH",
                "patchtype": "MERGE",
                "transactionid": str(attempt_id),
            },
            timeout=settings.timeout_seconds,
            follow_redirects=False,
        ) as response:
            status = response.status_code
            error = bytearray()
            if 400 <= status < 500:
                async for chunk in response.aiter_bytes():
                    error.extend(chunk)
                    if len(error) > 32000:
                        return "unknown"
    except httpx.HTTPError:
        return "unknown"
    if status in (200, 204):
        return "accepted"
    if status == 412 or (
        ibm_reason_code(error) == "BMXAA8229W"
        and ibm_conflict_object(error) in {"ASSIGNMENT", "WORKORDER"}
    ):
        return "conflict"
    if status in (400, 401, 403, 404):
        return "failed"
    return "unknown"
