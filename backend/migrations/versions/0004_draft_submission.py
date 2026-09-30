"""Durable duplicate submission receipts, retained after draft deletion."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004_draft_submission"
down_revision = "0003_login_flow"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "draft_submission",
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), primary_key=True),
        sa.Column("request_id", sa.Uuid(), primary_key=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("result", JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade():
    op.drop_table("draft_submission")
