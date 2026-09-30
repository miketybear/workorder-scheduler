"""
Session, drafts and upload/audit persistence. Frozen PostgreSQL DDL.

Generated from reviewed models at this revision; does not import live models.
Audit immutability protects application DML, not a database owner who can drop triggers.
"""

from alembic import op

revision = "0002_workflow"
down_revision = "0001_identity"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE draft (
            id UUID NOT NULL,
            owner_id UUID NOT NULL,
            connection_id UUID NOT NULL,
            version INTEGER NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_draft_version CHECK (version > 0),
            FOREIGN KEY(owner_id) REFERENCES app_user (id) ON DELETE RESTRICT,
            FOREIGN KEY(connection_id) REFERENCES maximo_connection (id) ON DELETE RESTRICT
        )
        """
    )
    op.execute("CREATE INDEX ix_draft_owner_connection ON draft (owner_id, connection_id)")
    op.execute(
        """
        CREATE TABLE login_session (
            token_hash VARCHAR(64) NOT NULL,
            csrf_hash VARCHAR(64) NOT NULL,
            user_id UUID NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            PRIMARY KEY (token_hash),
            CONSTRAINT ck_session_expiry CHECK (expires_at > created_at),
            FOREIGN KEY(user_id) REFERENCES app_user (id) ON DELETE CASCADE
        )
        """
    )
    op.execute("CREATE INDEX ix_session_user_expiry ON login_session (user_id, expires_at)")
    op.execute(
        """
        CREATE TABLE upload_batch (
            id UUID NOT NULL,
            actor_id UUID NOT NULL,
            idempotency_key UUID NOT NULL,
            request_hash VARCHAR(64) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT uq_batch_idempotency UNIQUE (actor_id, idempotency_key),
            FOREIGN KEY(actor_id) REFERENCES app_user (id) ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        """
        CREATE TABLE draft_item (
            id UUID NOT NULL,
            draft_id UUID NOT NULL,
            site_id VARCHAR(50) NOT NULL,
            workorder_id VARCHAR(100) NOT NULL,
            wonum VARCHAR(100) NOT NULL,
            discipline VARCHAR(50) NOT NULL,
            upstream_revision VARCHAR(500),
            baseline JSONB NOT NULL,
            changes JSONB NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT uq_draft_item_identity UNIQUE (draft_id, site_id, workorder_id),
            CONSTRAINT ck_draft_item_site CHECK (length(trim(site_id)) > 0),
            CONSTRAINT ck_draft_item_discipline CHECK (length(trim(discipline)) > 0),
            FOREIGN KEY(draft_id) REFERENCES draft (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE TABLE upload_item (
            id UUID NOT NULL,
            batch_id UUID NOT NULL,
            connection_id UUID NOT NULL,
            site_id VARCHAR(50) NOT NULL,
            workorder_id VARCHAR(100) NOT NULL,
            wonum VARCHAR(100) NOT NULL,
            discipline VARCHAR(50) NOT NULL,
            upstream_revision VARCHAR(500),
            before JSONB NOT NULL,
            changes JSONB NOT NULL,
            state VARCHAR(20) NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT uq_batch_wo UNIQUE (batch_id, connection_id, site_id, workorder_id),
            CONSTRAINT ck_upload_state CHECK (
                state IN ('pending','sending','confirmed','failed','conflict','unknown')),
            CONSTRAINT ck_upload_site CHECK (length(trim(site_id)) > 0),
            FOREIGN KEY(batch_id) REFERENCES upload_batch (id) ON DELETE RESTRICT,
            FOREIGN KEY(connection_id) REFERENCES maximo_connection (id) ON DELETE RESTRICT
        )
        """
    )
    op.execute("CREATE INDEX ix_upload_state_updated ON upload_item (state, updated_at)")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_active_upload_wo
        ON upload_item (connection_id, site_id, workorder_id)
        WHERE state IN ('pending','sending','unknown')
        """
    )
    op.execute(
        """
        CREATE TABLE audit_event (
            id UUID NOT NULL,
            upload_item_id UUID NOT NULL,
            actor_id UUID NOT NULL,
            event VARCHAR(30) NOT NULL,
            details JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(upload_item_id) REFERENCES upload_item (id) ON DELETE RESTRICT,
            FOREIGN KEY(actor_id) REFERENCES app_user (id) ON DELETE RESTRICT
        )
        """
    )
    op.execute("CREATE INDEX ix_audit_item_created ON audit_event (upload_item_id, created_at)")
    op.execute(
        """
        CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
         RAISE EXCEPTION 'audit_event is append-only';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
        ON audit_event FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation()
        """
    )


def downgrade():
    op.drop_table("audit_event")
    op.drop_table("upload_item")
    op.drop_table("draft_item")
    op.drop_table("upload_batch")
    op.drop_table("login_session")
    op.drop_table("draft")
    op.execute("DROP FUNCTION reject_audit_mutation()")
