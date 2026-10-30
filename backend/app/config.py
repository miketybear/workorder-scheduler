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
    profile_photo_enabled: bool = True

    @property
    def login_scopes(self) -> list[str]:
        return ["User.Read"] if self.profile_photo_enabled else []

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


class WorkflowRouteAccount(BaseModel):
    """Shared Maximo position account that owns a discipline's BD_WO supervisor assignments."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    personid: str = Field(pattern=r"^[A-Z0-9_]{1,30}$")
    api_key: SecretStr

    @field_validator("api_key")
    @classmethod
    def required_key(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        if not raw.strip() or any(ord(char) < 33 or ord(char) > 126 for char in raw):
            raise ValueError("A nonempty API key is required")
        return value


class WorkflowRouteSettings(BaseModel):
    """Verified BD_WO route contract for one connection; any drift in Maximo locks the feature."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    process: str = Field(default="BD_WO", pattern=r"^[A-Z0-9_]{1,30}$")
    # None resolves the single active revision of the process at runtime; a number pins it.
    revision: int | None = Field(default=None, ge=1, le=100000)
    # Supervisor input node -> action id of "Route to Tech PIC for execution" at that node.
    nodes: dict[int, int] = Field(default_factory=lambda: {20: 427, 40: 437}, min_length=1)
    assignment_node: int = Field(default=34, ge=1)
    option_text: str = Field(
        default="Route to Tech PIC for execution", min_length=1, max_length=100
    )
    object_structure: Literal["MXAPIWFASSIGNMENT"] = "MXAPIWFASSIGNMENT"
    # Planners in this group may become SUPNAME of a work order that has none.
    supervisor_group: str = Field(default="ALLSUPN", pattern=r"^[A-Za-z0-9_& -]{1,50}$")

    @field_validator("nodes")
    @classmethod
    def positive_nodes(cls, values: dict[int, int]) -> dict[int, int]:
        if any(node < 1 or action < 1 for node, action in values.items()):
            raise ValueError("Route nodes and action ids must be positive")
        return values


class MaximoSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    collection_url: str
    api_key: SecretStr
    allow_http_for_test: bool = Field(default=False, strict=True)
    timeout_seconds: int = Field(default=15, ge=1, le=60)
    retrieval_timeout_seconds: int = Field(default=120, ge=1, le=300)
    page_size: int = Field(default=200, ge=1, le=1000)
    max_pages: int = Field(default=50, ge=1, le=200)
    max_rows: int = Field(default=5000, ge=1, le=20000)
    max_page_bytes: int = Field(default=4_000_000, ge=1024, le=16_000_000)
    # Explicit per-connection domain values, to be confirmed on the designated test system.
    open_statuses: list[str] = Field(min_length=1, max_length=30)
    crew_groups: dict[str, str] = Field(default_factory=dict)
    person_login_domain: str | None = None
    conditional_write_contract: Literal["native_rowstamp_test"] | None = None
    assignment_write_contract: Literal["native_assignment_rowstamp_test"] | None = None
    assignment_daily_write_contract: Literal["native_daily_assignment_rowstamp_test"] | None = None
    task_load_contract: Literal["bdsched_assignment_test"] | None = None
    paging_origin_aliases: list[str] = Field(default_factory=list, max_length=3)
    # Keyed by server-derived discipline; used only for BD_WO route actions, never for reads/fields.
    workflow_route_accounts: dict[str, WorkflowRouteAccount] = Field(default_factory=dict)
    workflow_route: WorkflowRouteSettings = Field(default_factory=WorkflowRouteSettings)

    @field_validator("workflow_route_accounts")
    @classmethod
    def safe_route_disciplines(cls, values: dict[str, WorkflowRouteAccount]):
        import re

        if any(not re.fullmatch(r"[A-Za-z0-9_& -]{1,50}", code) for code in values):
            raise ValueError("Invalid route account discipline code")
        return values

    @field_validator("paging_origin_aliases")
    @classmethod
    def trusted_paging_origins(cls, values):
        for value in values:
            url = urlsplit(value)
            if (
                url.scheme not in {"https", "http"}
                or not url.hostname
                or url.username
                or url.password
                or url.path
                or url.query
                or url.fragment
                or "\\" in value
            ):
                raise ValueError(
                    "Paging aliases must be explicit origins without credentials or paths"
                )
        return values

    @field_validator("person_login_domain")
    @classmethod
    def company_login_domain(cls, value: str | None) -> str | None:
        import re

        if value is None:
            return None
        if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)+", value):
            raise ValueError("A lowercase company login domain is required")
        return value

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
            url.scheme not in {"https", "http"}
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or "%" in url.path
            or "\\" in value
            or "/../" in url.path
            or "/./" in url.path
            or not any(
                url.path.rstrip("/").endswith("/oslc/os/" + name)
                for name in ("oslcmxwodetail", "BDSCHED_WO")
            )
        ):
            raise ValueError("A WO collection URL without credentials/query is required")
        return value.rstrip("/")

    @model_validator(mode="after")
    def require_http_opt_in(self):
        if urlsplit(self.collection_url).scheme == "http" and not self.allow_http_for_test:
            raise ValueError("HTTP Maximo requires explicit allow_http_for_test=true")
        return self

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


class MaximoDefaults(BaseModel):
    """Domain values shared by every connection; a connection's own value overrides them."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    open_statuses: list[str] | None = None
    crew_groups: dict[str, str] | None = None
    person_login_domain: str | None = None


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
    maximo_defaults: MaximoDefaults = Field(default_factory=MaximoDefaults)
    maximo: dict[UUID, MaximoSettings] = Field(default_factory=dict)
    maximo_ca_bundle: FilePath | None = None
    read_draft_request_timeout_seconds: int = Field(default=180, ge=1, le=300)
    assignment_summary_ttl_seconds: int = Field(default=300, ge=1, le=300)
    work_order_snapshot_ttl_seconds: int = Field(default=120, ge=1, le=300)
    work_order_snapshot_max_entries: int = Field(default=8, ge=1, le=32)
    work_order_snapshot_max_rows: int = Field(default=20000, ge=20, le=50000)
    work_order_snapshot_max_bytes: int = Field(default=33554432, ge=1024, le=134217728)

    @model_validator(mode="before")
    @classmethod
    def apply_maximo_defaults(cls, data):
        # Merge before MaximoSettings validation so shared values get the same checks.
        if not isinstance(data, dict) or not isinstance(data.get("maximo"), dict):
            return data
        shared = MaximoDefaults.model_validate(data.get("maximo_defaults") or {})
        values = shared.model_dump(exclude_none=True)
        if not values:
            return data
        maximo = {
            key: {**values, **entry} if isinstance(entry, dict) else entry
            for key, entry in data["maximo"].items()
        }
        return {**data, "maximo": maximo}

    @model_validator(mode="after")
    def require_production_identity(self):
        if self.environment in {"staging", "production"} and self.entra is None:
            raise ValueError("Entra configuration is required outside local development/test")
        if self.environment not in {"development", "test"} and any(
            connection.conditional_write_contract is not None
            or connection.assignment_write_contract is not None
            or connection.assignment_daily_write_contract is not None
            or bool(connection.workflow_route_accounts)
            for connection in self.maximo.values()
        ):
            raise ValueError("Verified conditional write contract is TEST-only")
        if self.environment == "production" and any(
            urlsplit(connection.collection_url).scheme == "http"
            for connection in self.maximo.values()
        ):
            raise ValueError("Production application settings require HTTPS Maximo connections")
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
