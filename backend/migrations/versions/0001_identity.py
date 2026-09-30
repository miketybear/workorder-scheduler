"""Identity and connection-scoped grants; no seeded users or credentials."""

import sqlalchemy as sa
from alembic import op

revision = "0001_identity"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "app_user",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("tenant_id", "object_id", name="uq_user_entra"),
    )
    op.create_table(
        "maximo_connection",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("system", sa.String(20), nullable=False),
        sa.Column("environment", sa.String(20), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("base_url", sa.String(500), nullable=False),
        sa.Column("timezone", sa.String(100), nullable=False),
        sa.Column("secret_reference", sa.String(200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.CheckConstraint("system IN ('onshore', 'offshore')", name="ck_connection_system"),
        sa.CheckConstraint(
            "environment IN ('test', 'production')", name="ck_connection_environment"
        ),
        sa.UniqueConstraint("system", "environment", name="uq_connection_system_environment"),
    )
    op.create_table(
        "access_grant",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "connection_id",
            sa.Uuid(),
            sa.ForeignKey("maximo_connection.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("discipline", sa.String(50), nullable=False),
        sa.Column("capability", sa.String(10), nullable=False),
        sa.UniqueConstraint("user_id", "connection_id", "discipline", name="uq_grant_scope"),
        sa.CheckConstraint("capability IN ('read', 'write')", name="ck_grant_capability"),
        sa.CheckConstraint("length(trim(discipline)) > 0", name="ck_grant_discipline"),
    )


def downgrade():
    op.drop_table("access_grant")
    op.drop_table("maximo_connection")
    op.drop_table("app_user")
