from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    FilePath,
    SecretStr,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


class EntraSettings(BaseModel):
    tenant_id: UUID
    client_id: UUID
    client_secret: SecretStr
    redirect_uri: str
    timeout_seconds: int = 10

    @field_validator("client_secret")
    @classmethod
    def nonempty_secret(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("Entra credential is required")
        return value

    @field_validator("redirect_uri")
    @classmethod
    def secure_callback(cls, value: str) -> str:
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path != "/api/auth/callback"
        ):
            raise ValueError("Entra callback must be an HTTPS URL ending in /api/auth/callback")
        return value

    @field_validator("timeout_seconds")
    @classmethod
    def bounded_timeout(cls, value: int) -> int:
        if not 1 <= value <= 30:
            raise ValueError("Entra timeout must be between 1 and 30 seconds")
        return value


class MaximoSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    collection_url: str
    api_key: SecretStr
    timeout_seconds: int = Field(default=15, ge=1, le=60)
    retrieval_timeout_seconds: int = Field(default=120, ge=1, le=300)
    page_size: int = Field(default=200, ge=1, le=1000)
    max_pages: int = Field(default=50, ge=1, le=200)
    max_rows: int = Field(default=5000, ge=1, le=20000)
    max_page_bytes: int = Field(default=4_000_000, ge=1024, le=16_000_000)
    # Explicit per-connection domain values, to be confirmed on the designated test system.
    open_statuses: list[str] = Field(min_length=1, max_length=30)
    crew_groups: dict[str, str] = Field(default_factory=dict)

    @field_validator("crew_groups")
    @classmethod
    def safe_crew_codes(cls, values: dict[str, str]) -> dict[str, str]:
        import re

        if any(
            not re.fullmatch(r"[A-Za-z0-9_& -]{1,50}", code)
            for pair in values.items()
            for code in pair
        ):
            raise ValueError("Invalid discipline or person group code")
        return values

    @field_validator("collection_url")
    @classmethod
    def trusted_collection(cls, value: str) -> str:
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or "%" in url.path
            or "\\" in value
            or "/../" in url.path
            or "/./" in url.path
            or not url.path.rstrip("/").endswith("/oslc/os/oslcmxwodetail")
        ):
            raise ValueError("An HTTPS WO collection URL without credentials/query is required")
        return value.rstrip("/")

    @field_validator("api_key")
    @classmethod
    def required_key(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        if not raw.strip() or any(ord(char) < 32 or ord(char) > 126 for char in raw):
            raise ValueError("A nonempty API key is required")
        return value

    @field_validator("open_statuses")
    @classmethod
    def status_codes(cls, values: list[str]) -> list[str]:
        import re

        if any(not re.fullmatch(r"[A-Za-z0-9_& -]{1,50}", value) for value in values):
            raise ValueError("Invalid status code")
        return values


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="WOS_",
        env_file=".env",
        env_nested_delimiter="__",
        extra="forbid",
        hide_input_in_errors=True,
    )

    environment: Literal["development", "test", "staging", "production"]
    database_url: SecretStr
    entra: EntraSettings | None = None
    maximo: dict[UUID, MaximoSettings] = Field(default_factory=dict)
    maximo_ca_bundle: FilePath | None = None

    @model_validator(mode="after")
    def require_production_identity(self):
        if self.environment in {"staging", "production"} and self.entra is None:
            raise ValueError("Entra configuration is required outside local development/test")
        return self

    @field_validator("database_url")
    @classmethod
    def require_postgres(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
        except ArgumentError:
            raise ValueError("Invalid database URL") from None
        if url.drivername != "postgresql+psycopg" or not url.host or not url.database:
            raise ValueError("A PostgreSQL psycopg URL with host and database is required")
        if not url.username or not url.password:
            raise ValueError("Database credentials are required")
        return value


def integration_settings() -> Settings:
    """Guard tests from accidentally connecting to a shared or production database."""
    settings = Settings(_env_file=".env.integration")
    url = make_url(settings.database_url.get_secret_value())
    if (
        settings.environment != "test"
        or url.host != "127.0.0.1"
        or url.port != 55432
        or url.database != "scheduler_test"
    ):
        raise ValueError("Integration tests require the isolated local scheduler_test database")
    return settings
