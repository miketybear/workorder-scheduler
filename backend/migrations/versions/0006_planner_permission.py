"""Explicit Planner permission intersected with verified PERSON discipline."""

import sqlalchemy as sa
from alembic import op

revision = "0006_planner_permission"
down_revision = "0005_person_access"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "planner_permission",
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
        sa.Column("discipline", sa.String(50), primary_key=True),
        sa.CheckConstraint("length(trim(discipline)) > 0", name="ck_planner_discipline"),
    )


def downgrade():
    op.drop_table("planner_permission")
