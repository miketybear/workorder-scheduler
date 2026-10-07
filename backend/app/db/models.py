import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "app_user"
    __table_args__ = (UniqueConstraint("tenant_id", "object_id", name="uq_user_entra"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID]
    object_id: Mapped[uuid.UUID]
    login_name: Mapped[str | None] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MaximoConnection(Base):
    __tablename__ = "maximo_connection"
    __table_args__ = (
        CheckConstraint("system IN ('onshore', 'offshore')", name="ck_connection_system"),
        CheckConstraint("environment IN ('test', 'production')", name="ck_connection_environment"),
        UniqueConstraint("system", "environment", name="uq_connection_system_environment"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    system: Mapped[str] = mapped_column(String(20))
    environment: Mapped[str] = mapped_column(String(20))
    label: Mapped[str] = mapped_column(String(100))
    base_url: Mapped[str] = mapped_column(String(500))
    timezone: Mapped[str] = mapped_column(String(100))
    secret_reference: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)


class UserConnectionSetting(Base):
    __tablename__ = "user_connection_setting"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maximo_connection.id", ondelete="CASCADE")
    )


class AccessGrant(Base):
    __tablename__ = "access_grant"
    __table_args__ = (
        UniqueConstraint("user_id", "connection_id", "discipline", name="uq_grant_scope"),
        CheckConstraint("capability IN ('read', 'write')", name="ck_grant_capability"),
        CheckConstraint("length(trim(discipline)) > 0", name="ck_grant_discipline"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maximo_connection.id", ondelete="CASCADE")
    )
    discipline: Mapped[str] = mapped_column(String(50))
    capability: Mapped[str] = mapped_column(String(10))


class PlannerPermission(Base):
    __tablename__ = "planner_permission"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="RESTRICT"), primary_key=True
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maximo_connection.id", ondelete="RESTRICT"), primary_key=True
    )
    discipline: Mapped[str] = mapped_column(String(50), primary_key=True)
    __table_args__ = (
        CheckConstraint("length(trim(discipline)) > 0", name="ck_planner_discipline"),
    )


class MaximoPersonBinding(Base):
    __tablename__ = "maximo_person_binding"
    __table_args__ = (
        UniqueConstraint("connection_id", "person_id", name="uq_connection_person_owner"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="RESTRICT"), primary_key=True
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maximo_connection.id", ondelete="RESTRICT"), primary_key=True
    )
    person_id: Mapped[str] = mapped_column(String(50))


class AuthorizationEvent(Base):
    __tablename__ = "authorization_event"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id", ondelete="RESTRICT"))
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maximo_connection.id", ondelete="RESTRICT")
    )
    event: Mapped[str] = mapped_column(String(30))
    details: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LoginSession(Base):
    __tablename__ = "login_session"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_session_expiry"),
        Index("ix_session_user_expiry", "user_id", "expires_at"),
    )
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LoginFlow(Base):
    __tablename__ = "login_flow"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    flow: Mapped[dict] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Draft(Base):
    __tablename__ = "draft"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_draft_version"),
        Index("ix_draft_owner_connection", "owner_id", "connection_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id", ondelete="RESTRICT"))
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maximo_connection.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DraftItem(Base):
    __tablename__ = "draft_item"
    __table_args__ = (
        UniqueConstraint("draft_id", "site_id", "workorder_id", name="uq_draft_item_identity"),
        CheckConstraint("length(trim(site_id)) > 0", name="ck_draft_item_site"),
        CheckConstraint("length(trim(discipline)) > 0", name="ck_draft_item_discipline"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    draft_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("draft.id", ondelete="CASCADE"))
    site_id: Mapped[str] = mapped_column(String(50))
    workorder_id: Mapped[str] = mapped_column(String(100))
    wonum: Mapped[str] = mapped_column(String(100))
    discipline: Mapped[str] = mapped_column(String(50))
    upstream_revision: Mapped[str | None] = mapped_column(String(500))
    baseline: Mapped[dict] = mapped_column(JSONB)
    changes: Mapped[dict] = mapped_column(JSONB)


class DraftSubmission(Base):
    __tablename__ = "draft_submission"
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"), primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UploadBatch(Base):
    __tablename__ = "upload_batch"
    __table_args__ = (UniqueConstraint("actor_id", "idempotency_key", name="uq_batch_idempotency"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id", ondelete="RESTRICT"))
    idempotency_key: Mapped[uuid.UUID]
    request_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UploadItem(Base):
    __tablename__ = "upload_item"
    __table_args__ = (
        UniqueConstraint(
            "batch_id", "connection_id", "site_id", "workorder_id", name="uq_batch_wo"
        ),
        CheckConstraint(
            "state IN ('pending','sending','confirmed','failed','conflict','unknown')",
            name="ck_upload_state",
        ),
        CheckConstraint("length(trim(site_id)) > 0", name="ck_upload_site"),
        Index(
            "uq_active_upload_wo",
            "connection_id",
            "site_id",
            "workorder_id",
            unique=True,
            postgresql_where=text("state IN ('pending','sending','unknown')"),
        ),
        Index("ix_upload_state_updated", "state", "updated_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("upload_batch.id", ondelete="RESTRICT"))
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maximo_connection.id", ondelete="RESTRICT")
    )
    site_id: Mapped[str] = mapped_column(String(50))
    workorder_id: Mapped[str] = mapped_column(String(100))
    wonum: Mapped[str] = mapped_column(String(100))
    discipline: Mapped[str] = mapped_column(String(50))
    upstream_revision: Mapped[str | None] = mapped_column(String(500))
    before: Mapped[dict] = mapped_column(JSONB)
    changes: Mapped[dict] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(20), default="pending")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditEvent(Base):
    __tablename__ = "audit_event"
    __table_args__ = (Index("ix_audit_item_created", "upload_item_id", "created_at"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    upload_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("upload_item.id", ondelete="RESTRICT")
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id", ondelete="RESTRICT"))
    event: Mapped[str] = mapped_column(String(30))
    # Restricted structured data, never raw upstream responses or credentials.
    details: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
