"""Short-lived, single-use Entra authorization flows, bound to a browser cookie."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003_login_flow"
down_revision = "0002_workflow"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "login_flow",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("flow", JSONB, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_login_flow_expires_at", "login_flow", ["expires_at"])


def downgrade():
    op.drop_table("login_flow")
