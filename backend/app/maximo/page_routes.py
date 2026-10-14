"""Bounded Maximo paging with local planning classification and scoped cursors."""

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import AwareDatetime
from sqlalchemy import select, tuple_

from app.assignments.models import Allocation, PlanningSnapshot
from app.assignments.summary import calculate, list_summaries
from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.maximo.connections import configured_connection
from app.maximo.pages import PAGE_SIZE, read_metadata_snapshot, verify_page_scope
from app.maximo.reader import MaximoReadError
from app.maximo.routes import authorized_connection
from app.request_deadline import ReadDraftDeadlineRoute
from app.scheduling.markers import planning_markers

router = APIRouter(prefix="/api", route_class=ReadDraftDeadlineRoute)


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


async def completed_keys(db, connection_id, discipline, ttl):
    snapshots = (
        await db.scalars(
            select(PlanningSnapshot).where(
                PlanningSnapshot.connection_id == connection_id,
                PlanningSnapshot.discipline == discipline,
                PlanningSnapshot.verified_at >= datetime.now(UTC) - timedelta(seconds=ttl),
            )
        )
    ).all()
    rows = (
        (
            await db.scalars(
                select(Allocation).where(
                    Allocation.connection_id == connection_id,
                    Allocation.discipline == discipline,
                    Allocation.craft == discipline,
                    Allocation.state == "reserved",
                    tuple_(Allocation.site_id, Allocation.workorder_id).in_(
                        [(s.site_id, s.workorder_id) for s in snapshots]
                    ),
                )
            )
        ).all()
        if snapshots
        else []
    )
    grouped = {}
    for row in rows:
        grouped.setdefault((row.site_id, row.workorder_id), []).append(row)
    return {
        (s.site_id, s.workorder_id)
        for s in snapshots
        if calculate(
            s.tasks, grouped.get((s.site_id, s.workorder_id), []), discipline, s.verified_at
        )["state"]
        == "completed"
    }


def encode_cursor(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def decode_cursor(value, max_rows):
    try:
        raw = json.loads(base64.b64decode(value, altchars=b"-_", validate=True))
        if not isinstance(raw, dict) or set(raw) != {"query", "revision", "snapshot", "offset"}:
            raise ValueError()
        if any(
            not isinstance(raw[k], str)
            or len(raw[k]) != 64
            or any(c not in "0123456789abcdef" for c in raw[k])
            for k in ("query", "revision")
        ):
            raise ValueError()
        UUID(raw["snapshot"])
        if type(raw["offset"]) is not int or not 0 <= raw["offset"] <= max_rows:
            raise ValueError()
        if raw["offset"] % PAGE_SIZE:
            raise ValueError()
        return raw
    except (ValueError, TypeError, UnicodeError, RecursionError, AttributeError):
        raise HTTPException(422, "Invalid page cursor") from None


@router.get("/work-orders/page")
async def work_order_page(
    request: Request,
    response: Response,
    connection_id: UUID,
    discipline: Annotated[str, Query(min_length=1, max_length=50)],
    target_from: AwareDatetime,
    target_before: AwareDatetime,
    view: Literal["all", "backlog", "completed"] = "backlog",
    search: Annotated[str, Query(max_length=200)] = "",
    cursor: Annotated[str | None, Query(min_length=1, max_length=4096)] = None,
    refresh: bool = False,
):
    response.headers["Cache-Control"] = "no-store"
    allowed = {
        "connection_id",
        "discipline",
        "target_from",
        "target_before",
        "view",
        "search",
        "cursor",
        "refresh",
    }
    if any(
        k not in allowed or len(request.query_params.getlist(k)) != 1 for k in request.query_params
    ):
        raise HTTPException(422, "Unsupported or duplicate query parameter")
    if target_before <= target_from or target_before - target_from > timedelta(days=366):
        raise HTTPException(422, "Choose a date range up to 366 days; end is exclusive")
    if refresh and cursor:
        raise HTTPException(422, "Refresh requires the initial page")
    search = search.strip()
    if any(ord(c) < 32 for c in search):
        raise HTTPException(422, "Invalid search text")
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Sign-in required")
    await sync_person_access(request, token)
    app_settings = request.app.state.settings
    ttl = app_settings.assignment_summary_ttl_seconds
    async with request.app.state.sessions() as db:
        connection = await authorized_connection(db, token, connection_id, discipline)
        actor = await resolve_session(db, token)
        settings = configured_connection(app_settings, connection).model_copy(deep=True)
        complete = (
            await completed_keys(db, connection_id, discipline, ttl) if view != "all" else set()
        )
    revision = digest(sorted(complete))
    settings_fingerprint = digest(
        [settings.model_dump(mode="json"), settings.api_key.get_secret_value()]
    )
    cache_key = digest(
        [
            str(connection_id),
            discipline,
            target_from.astimezone(UTC).isoformat(),
            target_before.astimezone(UTC).isoformat(),
            settings_fingerprint,
        ]
    )
    query = digest([str(actor.user_id), cache_key, view, search])
    state = decode_cursor(cursor, settings.max_rows) if cursor else None
    if state and (state["query"] != query or state["revision"] != revision):
        raise HTTPException(409, "Page filters or planning membership changed; restart paging")
    cache = request.app.state.work_order_snapshots

    async def authority_after_io():
        await sync_person_access(request, token)
        async with request.app.state.sessions() as db:
            current_connection = await authorized_connection(db, token, connection_id, discipline)
            current_actor = await resolve_session(db, token)
            if (
                current_actor.user_id != actor.user_id
                or configured_connection(app_settings, current_connection) != settings
            ):
                raise HTTPException(409, "Page scope changed; restart paging")

    async def load_snapshot():
        async with request.app.state.maximo_client_factory() as client:
            orders = await read_metadata_snapshot(
                client, settings, discipline, target_from, target_before, cache.max_bytes
            )
        # Never publish a retrieval whose initiating identity/configuration was revoked.
        await authority_after_io()
        return sorted(
            orders,
            key=lambda o: (
                o.wopriority is None,
                -(o.wopriority or 0),
                o.siteid,
                (0, int(o.workorderid))
                if o.workorderid.isascii() and o.workorderid.isdigit()
                else (1, o.workorderid),
            ),
        )

    try:
        if state:
            snapshot = await cache.current(cache_key, state["snapshot"])
            if snapshot is None:
                raise HTTPException(409, "WO snapshot expired or refreshed; restart paging")
        else:
            snapshot, _ = await cache.acquire(cache_key, load_snapshot, refresh=refresh)
        matches = [
            o
            for o in snapshot.orders
            if (view == "all" or ((o.siteid, o.workorderid) in complete) == (view == "completed"))
            and (
                not search
                or search.casefold()
                in " ".join([o.wonum, o.siteid, o.description or ""]).casefold()
            )
        ]
        offset = state["offset"] if state else 0
        if offset > len(matches):
            raise HTTPException(409, "Page membership changed; restart paging")
        orders = matches[offset : offset + PAGE_SIZE]
        # Even a new multi-page snapshot may contain a WO moved after its source page.
        try:
            async with request.app.state.maximo_client_factory() as client:
                await verify_page_scope(
                    client, settings, discipline, target_from, target_before, orders
                )
        except MaximoReadError:
            await cache.discard(cache_key, snapshot.id)
            raise
        await authority_after_io()
    except MaximoReadError as error:
        raise HTTPException(502, str(error), headers={"Cache-Control": "no-store"}) from None

    async with request.app.state.sessions() as db:
        current_complete = (
            await completed_keys(db, connection_id, discipline, ttl) if view != "all" else set()
        )
        if digest(sorted(current_complete)) != revision:
            raise HTTPException(409, "Planning membership changed; restart paging")
        markers = await planning_markers(db, actor.user_id, connection_id, discipline, orders)
        summaries = await list_summaries(db, connection_id, discipline, orders, ttl)
        if view != "all" and any(
            (summaries[(o.siteid, o.workorderid)]["state"] == "completed") != (view == "completed")
            for o in orders
        ):
            raise HTTPException(409, "Planning membership changed; restart paging")
    if await cache.current(cache_key, snapshot.id) is None:
        raise HTTPException(409, "WO snapshot expired or refreshed; restart paging")
    next_offset = offset + len(orders)
    next_cursor = (
        encode_cursor(
            dict(query=query, revision=revision, snapshot=snapshot.id, offset=next_offset)
        )
        if next_offset < len(matches)
        else None
    )
    return dict(
        connection_id=str(connection_id),
        discipline=discipline,
        count=len(orders),
        items=[
            {
                **o.model_dump(mode="json"),
                "drafts": markers[(o.siteid, o.workorderid)],
                "allocation_summary": summaries[(o.siteid, o.workorderid)],
            }
            for o in orders
        ],
        next_cursor=next_cursor,
        has_more=next_cursor is not None,
        total_count=len(matches),
        page_size=PAGE_SIZE,
        view=view,
        search=search,
        filter_revision=revision,
        snapshot_id=snapshot.id,
        expires_at=snapshot.expires_at.isoformat(),
    )
