"""Encrypted position-account credentials per Entra user, connection and discipline."""

import sqlalchemy as sa
from alembic import op

revision = "0018_workflow_route_credential"
down_revision = "0017_workflow_route_attempt"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workflow_route_credential",
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
            primary_key=True,
        ),
        sa.Column("discipline", sa.String(50), primary_key=True),
        sa.Column("personid", sa.String(30), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade():
    op.drop_table("workflow_route_credential")
