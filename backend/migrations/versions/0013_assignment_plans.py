"""Local multi-day plans retain source identity and immutable demand."""

import sqlalchemy as sa
from alembic import op

revision = "0013_assignment_plans"
down_revision = "0012_task_assignments"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "assignment_plan",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("pool_id", sa.Uuid(), sa.ForeignKey("resource_pool.id"), nullable=False),
        sa.Column(
            "connection_id", sa.Uuid(), sa.ForeignKey("maximo_connection.id"), nullable=False
        ),
        sa.Column("assignment_id", sa.String(30), nullable=False),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("resource_person.id"), nullable=False),
        sa.Column("laborcode", sa.String(100), nullable=False),
        sa.Column("demand_minutes", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.CheckConstraint("demand_minutes BETWEEN 1 AND 230580"),
        sa.CheckConstraint("state IN ('reserved','released')"),
    )
    op.create_index(
        "uq_assignment_plan_source",
        "assignment_plan",
        ["connection_id", "assignment_id"],
        unique=True,
        postgresql_where=sa.text("state='reserved'"),
    )
    op.add_column(
        "assignment_allocation",
        sa.Column("plan_id", sa.Uuid(), sa.ForeignKey("assignment_plan.id"), nullable=True),
    )
    op.drop_index("uq_assignment_remote_reserved", table_name="assignment_allocation")
    op.create_index(
        "uq_assignment_remote_reserved",
        "assignment_allocation",
        ["connection_id", "assignment_id"],
        unique=True,
        postgresql_where=sa.text(
            "state='reserved' AND assignment_id IS NOT NULL AND plan_id IS NULL"
        ),
    )
    op.create_index(
        "uq_assignment_plan_day",
        "assignment_allocation",
        ["plan_id", "date"],
        unique=True,
        postgresql_where=sa.text("state='reserved' AND plan_id IS NOT NULL"),
    )


def downgrade():
    raise RuntimeError("Plan history must be preserved; restore a reviewed backup")
