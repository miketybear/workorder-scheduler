"""Durable approved business proposals and sequential bulk synchronization receipts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0016_plan_upload_batches"
down_revision = "0015_daily_plan_uploads"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "assignment_plan_upload_batch",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("request_id", sa.Uuid(), unique=True, nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("confirmation_request_id", sa.Uuid(), unique=True),
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), nullable=False),
        sa.Column(
            "connection_id", sa.Uuid(), sa.ForeignKey("maximo_connection.id"), nullable=False
        ),
        sa.Column("discipline", sa.String(50), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("start_time", sa.String(5), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "assignment_plan_upload_batch_item",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "batch_id", sa.Uuid(), sa.ForeignKey("assignment_plan_upload_batch.id"), nullable=False
        ),
        sa.Column(
            "allocation_id", sa.Uuid(), sa.ForeignKey("assignment_allocation.id"), nullable=False
        ),
        sa.Column("plan_id", sa.Uuid(), sa.ForeignKey("assignment_plan.id")),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Uuid(), unique=True, nullable=False),
        sa.Column("frozen", JSONB, nullable=False),
        sa.Column("proposal", JSONB),
        sa.Column("labels", JSONB),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("reason", sa.String(100)),
        sa.Column("attempt_id", sa.Uuid(), sa.ForeignKey("assignment_plan_upload.id")),
        sa.Column("claimed_until", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "uq_plan_upload_batch_position",
        "assignment_plan_upload_batch_item",
        ["batch_id", "position"],
        unique=True,
    )


def downgrade():
    op.drop_table("assignment_plan_upload_batch_item")
    op.drop_table("assignment_plan_upload_batch")
