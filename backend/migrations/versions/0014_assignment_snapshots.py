"""Bounded verified task snapshots for planning summaries."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0014_assignment_snapshots"
down_revision = "0013_assignment_plans"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "assignment_planning_snapshot",
        sa.Column(
            "connection_id", sa.Uuid(), sa.ForeignKey("maximo_connection.id"), primary_key=True
        ),
        sa.Column("site_id", sa.String(50), primary_key=True),
        sa.Column("workorder_id", sa.String(30), primary_key=True),
        sa.Column("discipline", sa.String(50), primary_key=True),
        sa.Column("tasks", JSONB, nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("assignment_planning_snapshot")
