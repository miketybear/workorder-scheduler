"""Atomic pool-scoped rota revisions and materialized daily capacity."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0010_rota_activation"
down_revision = "0009_rota_staging"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE rota_import DROP CONSTRAINT rota_import_status_check")
    op.create_check_constraint(
        "rota_import_status_check", "rota_import", "status IN ('staged','cancelled','activated')"
    )
    op.create_table(
        "resource_pool_state",
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("version >= 0"),
    )
    op.create_table(
        "resource_person",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), nullable=False),
        sa.Column("person_key", sa.String(100), nullable=False),
        sa.UniqueConstraint("pool_id", "person_key"),
    )
    op.create_table(
        "rota_activation",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), nullable=False),
        sa.Column(
            "import_id", sa.Uuid(), sa.ForeignKey("rota_import.id"), nullable=False, unique=True
        ),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("import_version", sa.Integer(), nullable=False),
        sa.Column("expected_pool_version", sa.Integer(), nullable=False),
        sa.Column("pool_version", sa.Integer(), nullable=False),
        sa.Column("coverage_from", sa.Date(), nullable=False),
        sa.Column("coverage_before", sa.Date(), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.Column("person_count", sa.Integer(), nullable=False),
        sa.Column("day_count", sa.Integer(), nullable=False),
        sa.Column("total_hours", sa.Numeric(12, 1), nullable=False),
        sa.Column(
            "activated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("pool_id", "pool_version"),
        sa.CheckConstraint("coverage_before > coverage_from"),
    )
    op.create_table(
        "person_day_capacity",
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), primary_key=True),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("resource_person.id"), primary_key=True),
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column("activation_id", sa.Uuid(), sa.ForeignKey("rota_activation.id"), nullable=False),
        sa.Column("person_key", sa.String(100), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("craft", sa.String(20), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("laborcode", sa.String(100), nullable=False),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("capacity_hours", sa.Numeric(3, 1), nullable=False),
        sa.CheckConstraint("capacity_hours >= 0 AND capacity_hours <= 10.5"),
    )
    op.execute(
        "CREATE TRIGGER rota_activation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE "
        "ON rota_activation FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation()"
    )
    op.execute("""CREATE OR REPLACE FUNCTION preserve_rota_source()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (NEW.pool_id,NEW.actor_id,NEW.file_name,NEW.sheet,NEW.source,NEW.created_at)
           IS DISTINCT FROM
           (OLD.pool_id,OLD.actor_id,OLD.file_name,OLD.sheet,OLD.source,OLD.created_at)
        THEN RAISE EXCEPTION 'Rota source is immutable'; END IF;
        IF OLD.status IN ('cancelled','activated') THEN
          RAISE EXCEPTION 'Final rota is immutable'; END IF;
        RETURN NEW;
      END $$""")


def downgrade():
    raise RuntimeError("Activation history cannot be discarded; restore a reviewed backup instead")
