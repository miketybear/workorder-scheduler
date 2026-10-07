"""Planner metadata for freshly authorized WO list rows, without per-draft Maximo reads."""

from sqlalchemy import func, select, tuple_

from app.db.models import Draft, DraftItem
from app.maximo.detail import current_snapshot
from app.scheduling.drafts import WorkOrderKey


async def planning_markers(db, owner_id, connection_id, discipline, orders):
    by_key = {(order.siteid, order.workorderid): order for order in orders}
    markers = {key: [] for key in by_key}
    if not by_key:
        return markers
    counts = (
        select(DraftItem.draft_id, func.count().label("size"))
        .join(Draft, Draft.id == DraftItem.draft_id)
        .where(Draft.owner_id == owner_id, Draft.connection_id == connection_id)
        .group_by(DraftItem.draft_id)
        .subquery()
    )
    rows = await db.execute(
        select(Draft, DraftItem, counts.c.size)
        .join(DraftItem, DraftItem.draft_id == Draft.id)
        .join(counts, counts.c.draft_id == Draft.id)
        .where(
            Draft.owner_id == owner_id,
            Draft.connection_id == connection_id,
            DraftItem.discipline == discipline,
            tuple_(DraftItem.site_id, DraftItem.workorder_id).in_(list(by_key)),
        )
        .order_by(Draft.updated_at.desc(), Draft.id)
    )
    for draft, item, size in rows:
        key = (item.site_id, item.workorder_id)
        current = current_snapshot(
            WorkOrderKey(connection_id, *key), by_key[key], frozenset()
        ).baseline.model_dump(mode="json")
        # Only this verified WO's plan is released. Group contents/counts are withheld;
        # opening the draft rechecks every member through the existing restore policy.
        markers[key].append(
            {
                "draft_id": str(draft.id),
                "version": draft.version,
                "is_batch": size > 1,
                "updated_at": draft.updated_at.isoformat(),
                "changes": item.changes,
                "baseline_changed": item.baseline != current,
            }
        )
    return markers
