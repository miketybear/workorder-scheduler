"""Durable audit intent and per-WO lock for BD_WO route attempts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0017_workflow_route_attempt"
down_revision = "0016_plan_upload_batches"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workflow_route_attempt",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column(
            "actor_user_id",
            sa.Uuid(),
            sa.ForeignKey("app_user.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "connection_id",
            sa.Uuid(),
            sa.ForeignKey("maximo_connection.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("site_id", sa.String(50), nullable=False),
        sa.Column("workorder_id", sa.String(100), nullable=False),
        sa.Column("wonum", sa.String(100)),
        sa.Column("discipline", sa.String(50), nullable=False),
        sa.Column("process", sa.String(30), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("node_id", sa.Integer()),
        sa.Column("wfassignment_id_before", sa.String(40)),
        sa.Column("chosen_action_id", sa.Integer()),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("error_code", sa.String(60)),
        sa.Column("wfassignment_id_after", sa.String(40)),
        sa.Column("assigncode_after", sa.String(50)),
        sa.Column("evidence", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "state IN ('pending','sending','confirmed','failed','stranded','unknown','rejected')",
            name="ck_route_state",
        ),
        sa.CheckConstraint("length(trim(site_id)) > 0", name="ck_route_site"),
        sa.UniqueConstraint(
            "request_id", "connection_id", "site_id", "workorder_id", name="uq_route_request_wo"
        ),
    )
    op.create_index(
        "uq_active_route_wo",
        "workflow_route_attempt",
        ["connection_id", "site_id", "workorder_id"],
        unique=True,
        postgresql_where=sa.text("state IN ('pending','sending')"),
    )
    op.create_index(
        "ix_route_actor_request", "workflow_route_attempt", ["actor_user_id", "request_id"]
    )


def downgrade():
    op.drop_table("workflow_route_attempt")
