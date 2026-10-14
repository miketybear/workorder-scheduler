"""Operator-only audited provisioning. This helper is not a web endpoint."""

import re
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from app.db.models import MaximoConnection, User
from app.maximo.connections import configured_connection
from app.rota.models import ResourcePool, ResourcePoolGrant, RotaEvent


async def provision_pool(db, settings, connection_id, orgid, label, operator, reason):
    if not operator.strip() or not reason.strip() or len(operator) > 200 or len(reason) > 500:
        raise HTTPException(422, "Operator and reason are required")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,50}", orgid) or not 1 <= len(label) <= 100:
        raise HTTPException(422, "Invalid pool organization or label")
    connection = await db.get(MaximoConnection, connection_id)
    if not connection or not connection.enabled:
        raise HTTPException(404, "Configured connection not found")
    configured_connection(settings, connection)
    pool = ResourcePool(connection_id=connection_id, orgid=orgid, label=label, enabled=True)
    db.add(pool)
    await db.flush()
    db.add(
        RotaEvent(
            pool_id=pool.id,
            event="pool_provision",
            details={
                "operator": operator,
                "reason": reason,
                "connection_id": str(connection_id),
                "environment": connection.environment,
                "orgid": orgid,
            },
        )
    )
    return pool


async def change_pool_grant(
    db, settings, pool_id, tenant_id: UUID, object_id: UUID, capability, operator, reason
):
    if not operator.strip() or not reason.strip() or len(operator) > 200 or len(reason) > 500:
        raise HTTPException(422, "Operator and reason are required")
    if capability not in (None, "read", "write"):
        raise HTTPException(422, "Invalid capability")
    if not settings.entra or settings.entra.tenant_id != tenant_id:
        raise HTTPException(404, "Tenant user not found")
    user = await db.scalar(
        select(User)
        .where(User.tenant_id == tenant_id, User.object_id == object_id)
        .with_for_update()
    )
    pool = await db.get(ResourcePool, pool_id)
    if not user or not user.active or not pool or not pool.enabled:
        raise HTTPException(404, "Active user or pool not found")
    connection = await db.get(MaximoConnection, pool.connection_id)
    if not connection or not connection.enabled:
        raise HTTPException(404, "Configured connection not found")
    configured_connection(settings, connection)
    grant = await db.get(ResourcePoolGrant, (pool_id, user.id))
    before = grant.capability if grant else None
    if capability is None:
        if grant:
            await db.delete(grant)
    elif grant:
        grant.capability = capability
    else:
        db.add(ResourcePoolGrant(pool_id=pool_id, user_id=user.id, capability=capability))
    db.add(
        RotaEvent(
            pool_id=pool_id,
            event="pool_grant",
            details={
                "operator": operator,
                "reason": reason,
                "tenant_id": str(tenant_id),
                "object_id": str(object_id),
                "user_id": str(user.id),
                "before": before,
                "after": capability,
            },
        )
    )
