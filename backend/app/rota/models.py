import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class ResourcePool(Base):
    __tablename__ = "resource_pool"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("maximo_connection.id"))
    label: Mapped[str] = mapped_column(String(100))
    orgid: Mapped[str] = mapped_column(String(50))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)


class ResourcePoolGrant(Base):
    __tablename__ = "resource_pool_grant"
    __table_args__ = (CheckConstraint("capability IN ('read','write')"),)
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"), primary_key=True)
    capability: Mapped[str] = mapped_column(String(10))


class RotaImport(Base):
    __tablename__ = "rota_import"
    __table_args__ = (
        CheckConstraint("version >= 1"),
        CheckConstraint("status IN ('staged','cancelled','activated')"),
        Index("ix_rota_import_pool_created", "pool_id", "created_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"))
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="staged")
    file_name: Mapped[str] = mapped_column(String(200))
    sheet: Mapped[str] = mapped_column(String(100))
    source: Mapped[dict] = mapped_column(JSONB)
    labor: Mapped[list] = mapped_column(JSONB, default=list)
    mapping: Mapped[dict] = mapped_column(JSONB, default=dict)
    labor_error: Mapped[str | None] = mapped_column(String(200))
    labor_snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RotaEvent(Base):
    __tablename__ = "rota_event"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app_user.id"))
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"))
    import_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rota_import.id"))
    event: Mapped[str] = mapped_column(String(30))
    details: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ResourcePoolState(Base):
    __tablename__ = "resource_pool_state"
    __table_args__ = (CheckConstraint("version >= 0"),)
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=0)


class ResourcePerson(Base):
    __tablename__ = "resource_person"
    __table_args__ = (UniqueConstraint("pool_id", "person_key"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"))
    person_key: Mapped[str] = mapped_column(String(100))


class RotaActivation(Base):
    __tablename__ = "rota_activation"
    __table_args__ = (
        UniqueConstraint("pool_id", "pool_version"),
        CheckConstraint("coverage_before > coverage_from"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"))
    import_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rota_import.id"), unique=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    import_version: Mapped[int] = mapped_column(Integer)
    expected_pool_version: Mapped[int] = mapped_column(Integer)
    pool_version: Mapped[int] = mapped_column(Integer)
    coverage_from: Mapped[date] = mapped_column(Date)
    coverage_before: Mapped[date] = mapped_column(Date)
    snapshot: Mapped[dict] = mapped_column(JSONB)
    person_count: Mapped[int] = mapped_column(Integer)
    day_count: Mapped[int] = mapped_column(Integer)
    total_hours: Mapped[Decimal] = mapped_column(Numeric(12, 1))
    activated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PersonDayCapacity(Base):
    __tablename__ = "person_day_capacity"
    __table_args__ = (CheckConstraint("capacity_hours >= 0 AND capacity_hours <= 10.5"),)
    pool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_pool.id"), primary_key=True)
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resource_person.id"), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    activation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rota_activation.id"))
    person_key: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
    craft: Mapped[str] = mapped_column(String(20))
    role: Mapped[str] = mapped_column(String(30))
    laborcode: Mapped[str] = mapped_column(String(100))
    code: Mapped[str] = mapped_column(String(20))
    capacity_hours: Mapped[Decimal] = mapped_column(Numeric(3, 1))
