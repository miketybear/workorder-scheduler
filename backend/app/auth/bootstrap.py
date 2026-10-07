"""First-admin recovery boundary for trusted database operators, never an HTTP route."""

from uuid import UUID

from sqlalchemy import select, text

from app.db.models import AdminAuthorityEvent, User


async def bootstrap_admin(
    db, settings, tenant: UUID, object_id: UUID, operator: str, reason: str, *, execute=True
):
    operator, reason = operator.strip(), reason.strip()
    if not operator or len(operator) > 200 or not reason or len(reason) > 500:
        raise ValueError(
            "Operator attribution and reason are required (200/500 characters maximum)"
        )
    if not settings.entra or tenant != settings.entra.tenant_id:
        raise ValueError("Bootstrap requires the configured Entra tenant")
    # A transaction-scoped global lock serializes first-admin checks across operator processes.
    await db.execute(text("SELECT pg_advisory_xact_lock(803701008)"))
    if await db.scalar(select(User.id).where(User.is_admin.is_(True)).limit(1)):
        raise ValueError("An administrator already exists; bootstrap is first-admin only")
    user = await db.scalar(
        select(User)
        .where(
            User.tenant_id == tenant,
            User.object_id == object_id,
            User.active.is_(True),
        )
        .with_for_update()
    )
    if not user:
        raise ValueError("Target must be an existing active Entra identity")
    preview = {
        "user_id": str(user.id),
        "tenant_id": str(tenant),
        "object_id": str(object_id),
        "display_name": user.display_name,
        "operator": operator,
        "reason": reason,
        "before": False,
        "after": True,
        "wo_grants_added": 0,
    }
    if not execute:
        return preview
    user.is_admin = True
    db.add(
        AdminAuthorityEvent(
            user_id=user.id,
            operator=operator,
            reason=reason,
            details={
                "event": "first_admin_bootstrap",
                "tenant_id": str(tenant),
                "object_id": str(object_id),
                "before": False,
                "after": True,
                "source": "trusted_database_operator",
            },
        )
    )
    await db.flush()
    return preview
