"""Verified login locator, per-connection PERSON binding and authorization audit."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005_person_access"
down_revision = "0004_draft_submission"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("app_user", sa.Column("login_name", sa.String(320), nullable=True))
    op.create_table(
        "maximo_person_binding",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("app_user.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column(
            "connection_id",
            sa.Uuid(),
            sa.ForeignKey("maximo_connection.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("person_id", sa.String(50), nullable=False),
        sa.UniqueConstraint("connection_id", "person_id", name="uq_connection_person_owner"),
    )
    op.create_table(
        "authorization_event",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "actor_id", sa.Uuid(), sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "connection_id",
            sa.Uuid(),
            sa.ForeignKey("maximo_connection.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("event", sa.String(30), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute(
        "CREATE TRIGGER authorization_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE "
        "ON authorization_event FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation()"
    )


def downgrade():
    op.drop_table("authorization_event")
    op.drop_table("maximo_person_binding")
    op.drop_column("app_user", "login_name")
