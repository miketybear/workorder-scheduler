"""Explicit resource authority and durable immutable-source rota staging."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0009_rota_staging"
down_revision = "0008_admin_authority"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "resource_pool",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "connection_id", sa.Uuid(), sa.ForeignKey("maximo_connection.id"), nullable=False
        ),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("orgid", sa.String(50), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_table(
        "resource_pool_grant",
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("app_user.id"), primary_key=True),
        sa.Column("capability", sa.String(10), nullable=False),
        sa.CheckConstraint("capability IN ('read','write')"),
    )
    op.create_table(
        "rota_import",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("file_name", sa.String(200), nullable=False),
        sa.Column("sheet", sa.String(100), nullable=False),
        sa.Column("source", JSONB, nullable=False),
        sa.Column("labor", JSONB, nullable=False),
        sa.Column("mapping", JSONB, nullable=False),
        sa.Column("labor_error", sa.String(200)),
        sa.Column("labor_snapshot_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("version >= 1"),
        sa.CheckConstraint("status IN ('staged','cancelled')"),
    )
    op.create_index("ix_rota_import_pool_created", "rota_import", ["pool_id", "created_at"])
    op.create_table(
        "rota_event",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id")),
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), nullable=False),
        sa.Column("import_id", sa.Uuid(), sa.ForeignKey("rota_import.id")),
        sa.Column("event", sa.String(30), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute(
        "CREATE TRIGGER rota_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE "
        "ON rota_event FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation()"
    )
    op.execute("""CREATE FUNCTION preserve_rota_source() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF (NEW.pool_id,NEW.actor_id,NEW.file_name,NEW.sheet,NEW.source,NEW.created_at)
             IS DISTINCT FROM
             (OLD.pool_id,OLD.actor_id,OLD.file_name,OLD.sheet,OLD.source,OLD.created_at) THEN
            RAISE EXCEPTION 'Rota source is immutable';
          END IF;
          IF OLD.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled rota is immutable'; END IF;
          RETURN NEW;
        END $$""")
    op.execute(
        "CREATE TRIGGER rota_source_immutable BEFORE UPDATE ON rota_import "
        "FOR EACH ROW EXECUTE FUNCTION preserve_rota_source()"
    )


def downgrade():
    op.drop_table("rota_event")
    op.drop_table("rota_import")
    op.execute("DROP FUNCTION preserve_rota_source()")
    op.drop_table("resource_pool_grant")
    op.drop_table("resource_pool")
