"""Separate daily child identities and durable plan-level upload intents."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0015_daily_plan_uploads"
down_revision = "0014_assignment_snapshots"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("assignment_allocation", sa.Column("remote_assignment_id", sa.String(30)))
    op.create_index(
        "uq_assignment_daily_remote",
        "assignment_allocation",
        ["connection_id", "remote_assignment_id"],
        unique=True,
        postgresql_where=sa.text("state='reserved' AND remote_assignment_id IS NOT NULL"),
    )
    op.add_column(
        "assignment_plan", sa.Column("version", sa.Integer(), nullable=False, server_default="1")
    )
    op.add_column(
        "assignment_plan",
        sa.Column("sync_state", sa.String(20), nullable=False, server_default="local"),
    )
    op.create_table(
        "assignment_plan_upload_preview",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("plan_id", sa.Uuid(), sa.ForeignKey("assignment_plan.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("intent", JSONB, nullable=False),
    )
    op.create_table(
        "assignment_plan_upload",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("plan_id", sa.Uuid(), sa.ForeignKey("assignment_plan.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("intent", JSONB, nullable=False),
        sa.Column("mapping", JSONB),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("state IN ('unknown','confirmed','conflict','failed')"),
    )


def downgrade():
    op.drop_table("assignment_plan_upload")
    op.drop_table("assignment_plan_upload_preview")
    op.drop_column("assignment_plan", "sync_state")
    op.drop_column("assignment_plan", "version")
    op.drop_index("uq_assignment_daily_remote", table_name="assignment_allocation")
    op.drop_column("assignment_allocation", "remote_assignment_id")
