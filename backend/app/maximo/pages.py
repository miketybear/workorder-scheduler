"""Bounded complete metadata retrieval and live page-scope validation."""

from datetime import datetime

from app.maximo.reader import (
    MaximoReadError,
    query_parameters,
    read_collection,
    validate_open_order,
)

PAGE_SIZE = 20


async def verify_page_scope(client, settings, discipline, start, end, orders):
    """Revalidate selected composite identities with one bounded query, not cached grants."""
    if not orders:
        return
    expected = {(o.siteid, o.workorderid) for o in orders}
    ids = sorted({o.workorderid for o in orders})
    if any(not v.isascii() or not v.isdigit() or len(v) > 30 for v in ids):
        raise MaximoReadError("Unsupported work order identity")
    original = query_parameters(settings, discipline, start, end)
    original["oslc.select"] = "siteid,workorderid,bdpocdiscipline,status,istask,parent,targcompdate"
    original["oslc.where"] += " and workorderid in [" + ",".join(ids) + "]"
    original["oslc.pageSize"] = "20"

    def validate(raw):
        identity = raw.get("siteid"), str(raw.get("workorderid"))
        try:
            date = datetime.fromisoformat(raw["targcompdate"])
            if (
                not isinstance(identity[0], str)
                or not identity[1].isascii()
                or not identity[1].isdigit()
                or raw.get("bdpocdiscipline") != discipline
                or raw.get("status") not in settings.open_statuses
                or raw.get("istask") not in (False, 0)
                or raw.get("parent") not in (None, "")
                or date.tzinfo is None
                or not start <= date < end
            ):
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise MaximoReadError("Work order is no longer in the requested scope") from None
        return identity, identity

    # More than one site may contain the same upstream ID. Validate pairs, never ID alone.
    rows = await read_collection(
        client, settings.model_copy(update={"max_pages": 2, "max_rows": 40}), original, validate
    )
    if not expected.issubset(set(rows)):
        raise MaximoReadError("Work order is no longer in the requested scope; refresh the list")


async def read_metadata_snapshot(client, settings, discipline, start, end, max_bytes):
    byte_count = 0

    def validate(raw):
        nonlocal byte_count
        order = validate_open_order(raw, settings, discipline, start, end)
        byte_count += len(order.model_dump_json().encode("utf-8"))
        if byte_count > max_bytes:
            raise MaximoReadError("Snapshot byte budget exceeded; narrow the date range")
        return order, (order.siteid, order.workorderid)

    return await read_collection(
        client,
        settings,
        query_parameters(settings, discipline, start, end),
        validate,
        require_complete_count=True,
    )
