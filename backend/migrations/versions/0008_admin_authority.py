"""Append-only, connection-independent administrator bootstrap attribution."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008_admin_authority"
down_revision = "0007_connection_setting"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("app_user", "is_admin", server_default=sa.false())
    op.create_table(
        "admin_authority_event",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("operator", sa.String(200), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute(
        "CREATE TRIGGER admin_authority_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE "
        "ON admin_authority_event FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation()"
    )


def downgrade():
    op.drop_table("admin_authority_event")
    op.alter_column("app_user", "is_admin", server_default=None)
