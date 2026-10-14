"""Task identities preserve legacy reservations without guessing task mappings."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0012_task_assignments"
down_revision = "0011_assignments"
branch_labels = None
depends_on = None


def upgrade():
    for name, kind in (
        ("task_workorder_id", sa.String(30)),
        ("task_id", sa.Integer()),
        ("assignment_id", sa.String(30)),
        ("task_description", sa.String(1000)),
        ("upstream_baseline", JSONB),
    ):
        op.add_column("assignment_allocation", sa.Column(name, kind, nullable=True))
    op.add_column(
        "assignment_allocation",
        sa.Column("sync_state", sa.String(20), nullable=False, server_default="local"),
    )
    op.create_check_constraint(
        "ck_assignment_task_identity",
        "assignment_allocation",
        "(task_workorder_id IS NULL AND task_id IS NULL AND assignment_id IS NULL) "
        "OR (task_workorder_id IS NOT NULL AND task_id IS NOT NULL AND assignment_id IS NOT NULL)",
    )
    op.create_index(
        "uq_assignment_remote_reserved",
        "assignment_allocation",
        ["connection_id", "assignment_id"],
        unique=True,
        postgresql_where=sa.text("state='reserved' AND assignment_id IS NOT NULL"),
    )
    op.create_table(
        "assignment_upload",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "allocation_id", sa.Uuid(), sa.ForeignKey("assignment_allocation.id"), nullable=False
        ),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("intent", JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_check_constraint(
        "ck_assignment_upload_state",
        "assignment_upload",
        "state IN ('unknown','confirmed','conflict','failed')",
    )


def downgrade():
    raise RuntimeError("Task identity and audit must be preserved; restore a reviewed backup")
