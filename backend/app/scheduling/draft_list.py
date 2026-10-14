"""Fresh, request-local verification of an owned draft page."""

import asyncio

from fastapi import HTTPException
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.db.models import Draft, DraftItem
from app.maximo.detail import current_snapshot, read_detail, read_pics
from app.maximo.reader import MaximoReadError
from app.scheduling.drafts import WorkOrderKey, require_scope


async def page_rows(db, actor_id, connection_id, ids):
    # One SQL statement keeps version and member changes in the same PostgreSQL
    # statement snapshot even if another save commits while this page is read.
    rows = (
        await db.execute(
            select(Draft, DraftItem)
            .join(DraftItem)
            .where(
                Draft.id.in_(ids),
                Draft.owner_id == actor_id,
                Draft.connection_id == connection_id,
            )
        )
    ).all()
    drafts, groups = {}, {}
    for draft, item in rows:
        drafts[draft.id] = draft
        groups.setdefault(draft.id, []).append(item)
    return drafts, groups


def membership(items):
    return {(item.id, item.site_id, item.workorder_id, item.discipline) for item in items}


async def fresh_page(request, config, connection_id, discipline, keys):
    """Read each distinct WO once, with one shared crew read and four active details."""
    semaphore = asyncio.Semaphore(4)
    async with request.app.state.maximo_client_factory() as client:
        pics = await read_pics(client, config, discipline)

        async def read(key):
            async with semaphore:
                try:
                    order = await read_detail(client, config, key, discipline)
                    if order is None:
                        raise HTTPException(404, "Work order not found")
                    if order.status not in config.open_statuses or order.istask or order.parent:
                        raise HTTPException(409, "Work order no longer eligible")
                    return order, current_snapshot(key, order, pics)
                except (HTTPException, MaximoReadError) as error:
                    return error

        tasks = [asyncio.create_task(read(key)) for key in keys]
        try:
            async with asyncio.timeout(config.retrieval_timeout_seconds):
                values = await asyncio.gather(*tasks)
        except TimeoutError:
            raise HTTPException(503, "Batch verification timed out") from None
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
    return dict(zip(keys, values, strict=True))


async def verified_page(request, actor, ids, connection_id, discipline, config, include_items):
    from app.scheduling.routes import checked_settings, restored_item, snapshot_token

    # Release the pooled connection before network I/O. No grant or draft locks are held.
    async with request.app.state.sessions() as db:
        drafts, groups = await page_rows(db, actor.user_id, connection_id, ids)
    groups = {
        draft_id: items
        for draft_id, items in groups.items()
        if 1 <= len(items) <= 200 and all(item.discipline == discipline for item in items)
    }
    keys = list(
        dict.fromkeys(
            WorkOrderKey(connection_id, item.site_id, item.workorder_id)
            for items in groups.values()
            for item in items
        )
    )
    verified = await fresh_page(request, config, connection_id, discipline, keys) if keys else {}
    fresh_actor, _ = await checked_settings(
        request, WorkOrderKey(connection_id, "", ""), discipline
    )
    if fresh_actor.user_id != actor.user_id:
        raise HTTPException(401, "Sign-in required")
    async with request.app.state.sessions() as db:
        fresh_actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        if fresh_actor.user_id != actor.user_id:
            raise HTTPException(401, "Sign-in required")
        # Every member below has this same connection/discipline; one current grant
        # query covers the entire set instead of two identical queries per member.
        await require_scope(
            db, actor.user_id, WorkOrderKey(connection_id, "", ""), discipline, write=False
        )
        fresh_drafts, fresh_groups = await page_rows(db, actor.user_id, connection_id, groups)
    results = []
    for draft_id in ids:
        if draft_id not in groups or draft_id not in fresh_drafts:
            continue
        draft, items = fresh_drafts[draft_id], fresh_groups[draft_id]
        if draft.version != drafts[draft_id].version or membership(items) != membership(
            groups[draft_id]
        ):
            continue
        pairs = [
            verified[WorkOrderKey(connection_id, item.site_id, item.workorder_id)] for item in items
        ]
        errors = [value for value in pairs if isinstance(value, Exception)]
        if errors:
            # Match restore semantics: unavailable batch members hide the whole group;
            # a single draft's upstream failure remains a sanitized upstream error.
            if len(items) == 1 and not (
                isinstance(errors[0], HTTPException) and errors[0].status_code in (404, 409)
            ):
                raise errors[0]
            continue
        if any(
            current.key != WorkOrderKey(connection_id, item.site_id, item.workorder_id)
            or current.discipline != item.discipline
            for item, (_, current) in zip(items, pairs, strict=True)
        ):
            continue
        result = {
            "draft_id": str(draft.id),
            "version": draft.version,
            "updated_at": draft.updated_at.isoformat(),
            "wonum": items[0].wonum,
            "site_id": items[0].site_id,
            "item_count": len(items),
            "system_name": pairs[0][0].systemid,
        }
        if include_items:
            result["items"] = [
                {
                    **restored_item(item, current),
                    "discipline": item.discipline,
                    "wonum": item.wonum,
                    "item": order.model_dump(mode="json"),
                    "baseline_token": snapshot_token(current),
                }
                for item, (order, current) in zip(items, pairs, strict=True)
            ]
        results.append(result)
    return results
