"""Internal workforce reservations, attributed audit and duplicate receipts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0011_assignments"
down_revision = "0010_rota_activation"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "assignment_allocation",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), nullable=False),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("resource_person.id"), nullable=False),
        sa.Column(
            "connection_id", sa.Uuid(), sa.ForeignKey("maximo_connection.id"), nullable=False
        ),
        sa.Column("site_id", sa.String(50), nullable=False),
        sa.Column("workorder_id", sa.String(30), nullable=False),
        sa.Column("discipline", sa.String(50), nullable=False),
        sa.Column("craft", sa.String(20), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("laborcode", sa.String(100), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.CheckConstraint("minutes BETWEEN 1 AND 630"),
        sa.CheckConstraint("version >= 1"),
        sa.CheckConstraint("state IN ('reserved','released')"),
    )
    op.create_index(
        "ix_assignment_pool_day", "assignment_allocation", ["pool_id", "person_id", "date", "state"]
    )
    op.create_table(
        "assignment_event",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column(
            "allocation_id", sa.Uuid(), sa.ForeignKey("assignment_allocation.id"), nullable=False
        ),
        sa.Column("event", sa.String(20), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_table(
        "assignment_submission",
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), primary_key=True),
        sa.Column("request_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "allocation_id", sa.Uuid(), sa.ForeignKey("assignment_allocation.id"), nullable=False
        ),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("result", JSONB, nullable=False),
    )
    for table in ("assignment_event", "assignment_submission"):
        op.execute(
            f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE OR TRUNCATE "
            f"ON {table} FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation()"
        )


def downgrade():
    raise RuntimeError("Assignment audit cannot be discarded; restore a reviewed backup instead")
