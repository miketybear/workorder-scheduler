import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models import Base


class Allocation(Base):
    __tablename__ = "assignment_allocation"
    __table_args__ = (
        CheckConstraint("minutes BETWEEN 1 AND 630"),
        CheckConstraint("version >= 1"),
        CheckConstraint("state IN ('reserved','released')"),
        Index("ix_assignment_pool_day", "pool_id", "person_id", "date", "state"),
        CheckConstraint(
            "(task_workorder_id IS NULL AND task_id IS NULL AND assignment_id IS NULL) "
            "OR (task_workorder_id IS NOT NULL AND task_id IS NOT NULL "
            "AND assignment_id IS NOT NULL)",
            name="ck_assignment_task_identity",
        ),
        Index(
            "uq_assignment_remote_reserved",
            "connection_id",
            "assignment_id",
            unique=True,
            postgresql_where=text(
                "state='reserved' AND assignment_id IS NOT NULL AND plan_id IS NULL"
            ),
        ),
        Index(
            "uq_assignment_plan_day",
            "plan_id",
            "date",
            unique=True,
            postgresql_where=text("state='reserved' AND plan_id IS NOT NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"))
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_person.id"))
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("maximo_connection.id"))
    site_id: Mapped[str] = mapped_column(String(50))
    workorder_id: Mapped[str] = mapped_column(String(30))
    discipline: Mapped[str] = mapped_column(String(50))
    craft: Mapped[str] = mapped_column(String(20))
    role: Mapped[str] = mapped_column(String(30))
    laborcode: Mapped[str] = mapped_column(String(100))
    date: Mapped[date] = mapped_column(Date)
    minutes: Mapped[int] = mapped_column(Integer)
    version: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[str] = mapped_column(String(20), default="reserved")
    task_workorder_id: Mapped[str | None] = mapped_column(String(30))
    task_id: Mapped[int | None] = mapped_column(Integer)
    assignment_id: Mapped[str | None] = mapped_column(String(30))
    task_description: Mapped[str | None] = mapped_column(String(1000))
    upstream_baseline: Mapped[dict | None] = mapped_column(JSONB)
    sync_state: Mapped[str] = mapped_column(String(20), default="local", server_default="local")
    plan_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assignment_plan.id"))
    plan: Mapped["AssignmentPlan | None"] = relationship(lazy="joined")


class AssignmentPlan(Base):
    __tablename__ = "assignment_plan"
    __table_args__ = (
        CheckConstraint("demand_minutes BETWEEN 1 AND 230580"),
        CheckConstraint("state IN ('reserved','released')"),
        Index(
            "uq_assignment_plan_source",
            "connection_id",
            "assignment_id",
            unique=True,
            postgresql_where=text("state='reserved'"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"))
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("maximo_connection.id"))
    assignment_id: Mapped[str] = mapped_column(String(30))
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_person.id"))
    laborcode: Mapped[str] = mapped_column(String(100))
    demand_minutes: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(20), default="reserved")


class AssignmentEvent(Base):
    __tablename__ = "assignment_event"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    allocation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assignment_allocation.id"))
    event: Mapped[str] = mapped_column(String(20))
    details: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AssignmentSubmission(Base):
    __tablename__ = "assignment_submission"
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"), primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    allocation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assignment_allocation.id"))
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSONB)


class PlanningSnapshot(Base):
    __tablename__ = "assignment_planning_snapshot"
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("maximo_connection.id"), primary_key=True
    )
    site_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    workorder_id: Mapped[str] = mapped_column(String(30), primary_key=True)
    discipline: Mapped[str] = mapped_column(String(50), primary_key=True)
    tasks: Mapped[list] = mapped_column(JSONB)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AssignmentUpload(Base):
    __tablename__ = "assignment_upload"
    __table_args__ = (
        CheckConstraint(
            "state IN ('unknown','confirmed','conflict','failed')",
            name="ck_assignment_upload_state",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    request_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    allocation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assignment_allocation.id"))
    request_hash: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(20), default="unknown")
    intent: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
