"""Persist each user's selected configured Maximo connection."""

import sqlalchemy as sa
from alembic import op

revision = "0007_connection_setting"
down_revision = "0006_planner_permission"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_connection_setting",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("app_user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "connection_id",
            sa.Uuid(),
            sa.ForeignKey("maximo_connection.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )


def downgrade():
    op.drop_table("user_connection_setting")
