"""Read-only evidence for a test WO's exact resource and conditional-write token."""

import asyncio
import json
import re
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.config import MaximoSettings, Settings
from app.db.models import (
    AccessGrant,
    MaximoConnection,
    MaximoPersonBinding,
    PlannerPermission,
    User,
)
from app.maximo.connections import configured_connection
from app.maximo.detail import code
from app.maximo.person import person_id_from_login
from app.maximo.reader import MaximoReadError, WorkOrder, map_work_order
from app.scheduling.changes import WorkOrderBaseline

PROBE_SELECT = (
    "href,orgid,siteid,workorderid,wonum,bdpocdiscipline,worktype,status,istask,parent,"
    "schedstart,schedfinish,assignedtechname,estdur,targstartdate,targcompdate"
)
ETagStatus = Literal["missing", "weak", "invalid", "strong", "numeric_candidate"]


class ProbeAuthority(BaseModel):
    model_config = ConfigDict(frozen=True)
    user_id: UUID
    tenant_id: UUID
    object_id: UUID
    connection_id: UUID
    discipline: str
    person_id: str
    explicit_planner: bool


class ContractEvidence(BaseModel):
    model_config = ConfigDict(frozen=True)
    resource_path: str
    resource_id: str
    advertised_origin_changed: bool
    site_id: str
    workorder_id: str
    wonum: str
    orgid: str | None
    discipline: str
    worktype: Literal["CM"] = "CM"
    status: str
    lean_requested: bool = True
    resource_status: Literal[200] = 200
    collection_etag_status: ETagStatus
    resource_etag_status: ETagStatus
    resource_etag: str | None = Field(default=None, max_length=500)
    strong_etag: str | None = Field(default=None, max_length=500)
    baseline: WorkOrderBaseline


async def authorize_probe(
    db,
    settings: Settings,
    user_id: UUID,
    connection_id: UUID,
    discipline: str,
    tenant_id: UUID,
    object_id: UUID,
) -> tuple[MaximoSettings, ProbeAuthority]:
    """Trusted operator read: existing stable identity and scope, never creates a grant."""
    if settings.environment not in {"development", "test"}:
        raise MaximoReadError("Contract probe requires development/test application settings")
    if not settings.entra or tenant_id != settings.entra.tenant_id:
        raise MaximoReadError("Contract probe requires configured Entra identity")
    user = await db.get(User, user_id)
    connection = await db.get(MaximoConnection, connection_id)
    binding = await db.get(MaximoPersonBinding, (user_id, connection_id))
    if (
        not user
        or not user.active
        or user.tenant_id != tenant_id
        or user.object_id != object_id
        or not connection
        or not connection.enabled
        or connection.environment != "test"
        or not binding
    ):
        raise MaximoReadError("Contract probe identity or test connection is not authorized")
    try:
        config = configured_connection(settings, connection)
    except HTTPException:
        raise MaximoReadError("Contract probe connection is not configured") from None
    if (
        not config.person_login_domain
        or discipline not in config.crew_groups
        or person_id_from_login(user.login_name, config.person_login_domain) != binding.person_id
    ):
        raise MaximoReadError("Contract probe PERSON scope is not configured")
    grant = await db.scalar(
        select(AccessGrant).where(
            AccessGrant.user_id == user_id,
            AccessGrant.connection_id == connection_id,
            AccessGrant.discipline == discipline,
            AccessGrant.capability.in_(["read", "write"]),
        )
    )
    if grant is None:
        raise MaximoReadError("Contract probe scope is not authorized")
    planner = await db.get(PlannerPermission, (user_id, connection_id, discipline))
    return config, ProbeAuthority(
        user_id=user_id,
        tenant_id=tenant_id,
        object_id=object_id,
        connection_id=connection_id,
        discipline=discipline,
        person_id=binding.person_id,
        explicit_planner=planner is not None and grant.capability == "write",
    )


def canonical_resource(href: str, settings: MaximoSettings) -> tuple[str, str, bool]:
    """Extract one opaque identifier; credentials always stay on the configured origin."""
    if (
        not isinstance(href, str)
        or not href
        or len(href) > 4096
        or "\\" in href
        or any(ord(char) <= 32 or ord(char) == 127 for char in href)
    ):
        raise MaximoReadError("Invalid resource identifier")
    try:
        target, base = urlsplit(href), urlsplit(settings.collection_url)
        # Validate ports even though the advertised origin is never used for requests.
        _ = target.port
        if (
            target.username
            or target.password
            or target.query
            or target.fragment
            or (target.scheme and (target.scheme not in {"http", "https"} or not target.hostname))
            or (not target.scheme and target.netloc)
            or not target.path.startswith(base.path + "/")
        ):
            raise MaximoReadError("Unsafe resource identifier")
    except ValueError:
        raise MaximoReadError("Invalid resource identifier") from None
    resource_id = target.path[len(base.path) + 1 :]
    if not re.fullmatch(r"[A-Za-z0-9_~-]{1,500}", resource_id):
        raise MaximoReadError("Invalid opaque resource identifier")
    canonical = str(httpx.URL(settings.collection_url).copy_with(path=target.path))
    origin_changed = bool(
        target.scheme and (target.scheme, target.netloc) != (base.scheme, base.netloc)
    )
    return canonical, resource_id, origin_changed


def etag_evidence(headers: httpx.Headers) -> tuple[ETagStatus, str | None]:
    values = headers.get_list("etag")
    if not values:
        return "missing", None
    if len(values) != 1:
        return "invalid", None
    value = values[0]
    if len(value) > 500:
        return "invalid", None
    # RFC entity-tag syntax restricted to printable ASCII for safe future HTTPX headers.
    if re.fullmatch(r'"[\x21\x23-\x7e]*"', value):
        return "strong", value
    # Maximo documents bare numeric ETags. Preserve evidence without calling them RFC strong.
    if re.fullmatch(r"-?[0-9]{1,30}", value):
        return "numeric_candidate", value
    if re.fullmatch(r'W/"[\x21\x23-\x7e]*"', value):
        return "weak", None
    return "invalid", None


async def bounded_get(client: httpx.AsyncClient, settings: MaximoSettings, url: str, params: dict):
    async with client.stream(
        "GET",
        url,
        params=params,
        headers={"apikey": settings.api_key.get_secret_value(), "Accept": "application/json"},
        timeout=settings.timeout_seconds,
        follow_redirects=False,
    ) as response:
        if response.status_code != 200:
            raise MaximoReadError("Contract resource retrieval failed")
        etag = etag_evidence(response.headers)
        payload = bytearray()
        async for chunk in response.aiter_bytes():
            payload.extend(chunk)
            if len(payload) > min(settings.max_page_bytes, 256_000):
                raise MaximoReadError("Contract response size limit exceeded")
    try:
        body = json.loads(payload)
    except (ValueError, UnicodeError):
        raise MaximoReadError("Invalid contract resource response") from None
    if not isinstance(body, dict):
        raise MaximoReadError("Invalid contract resource response")
    return body, etag


def validate_order(
    raw: dict, settings: MaximoSettings, site_id: str, workorder_id: str, discipline: str
) -> tuple[WorkOrder, str | None]:
    order = map_work_order(raw)
    if (
        order.siteid != site_id
        or order.workorderid != workorder_id
        or order.bdpocdiscipline != discipline
        or order.worktype != "CM"
        or order.status not in settings.open_statuses
        or order.istask
        or order.parent not in (None, "")
    ):
        raise MaximoReadError("Contract resource outside requested CM scope")
    orgid = raw.get("orgid")
    if orgid is not None and (
        not isinstance(orgid, str)
        or not re.fullmatch(r"[A-Za-z0-9_& -]{1,50}", orgid)
        or not orgid.strip()
    ):
        raise MaximoReadError("Invalid contract organization identity")
    return order, orgid


async def probe_contract(
    client: httpx.AsyncClient,
    settings: MaximoSettings,
    site_id: str,
    workorder_id: str,
    discipline: str,
) -> ContractEvidence:
    if not re.fullmatch(r"[0-9]{1,30}", workorder_id) or str(int(workorder_id)) != workorder_id:
        raise MaximoReadError("Invalid contract work order identity")
    statuses = json.dumps(settings.open_statuses, separators=(",", ":"))
    params = {
        "lean": "1",
        "oslc.select": PROBE_SELECT,
        "oslc.pageSize": "2",
        "oslc.where": f"siteid={code(site_id)} and workorderid={int(workorder_id)}"
        f' and bdpocdiscipline={code(discipline)} and worktype="CM" and istask=0'
        f' and parent!="*" and status in {statuses}',
    }
    try:
        async with asyncio.timeout(settings.retrieval_timeout_seconds):
            body, (collection_etag_status, _) = await bounded_get(
                client, settings, settings.collection_url, params
            )
            members, info = body.get("member"), body.get("responseInfo", {})
            if (
                not isinstance(members, list)
                or len(members) != 1
                or not isinstance(members[0], dict)
                or not isinstance(info, dict)
                or info.get("nextPage") is not None
            ):
                raise MaximoReadError("Contract collection must contain exactly one scoped WO")
            initial, orgid = validate_order(members[0], settings, site_id, workorder_id, discipline)
            url, resource_id, origin_changed = canonical_resource(members[0].get("href"), settings)
            resource, (resource_etag_status, resource_etag) = await bounded_get(
                client, settings, url, {"lean": "1", "oslc.select": PROBE_SELECT}
            )
            order, resource_orgid = validate_order(
                resource, settings, site_id, workorder_id, discipline
            )
            if order.wonum != initial.wonum or resource_orgid != orgid:
                raise MaximoReadError("Contract resource identity changed")
            if resource.get("href") is not None:
                returned_url, _, _ = canonical_resource(resource["href"], settings)
                if returned_url != url:
                    raise MaximoReadError("Contract resource identifier changed")
            return ContractEvidence(
                resource_path=urlsplit(url).path,
                resource_id=resource_id,
                advertised_origin_changed=origin_changed,
                site_id=order.siteid,
                workorder_id=order.workorderid,
                wonum=order.wonum,
                orgid=resource_orgid,
                discipline=discipline,
                status=order.status,
                collection_etag_status=collection_etag_status,
                resource_etag_status=resource_etag_status,
                resource_etag=resource_etag,
                strong_etag=resource_etag if resource_etag_status == "strong" else None,
                baseline=WorkOrderBaseline.model_validate(
                    {field: getattr(order, field) for field in WorkOrderBaseline.model_fields}
                ),
            )
    except (httpx.HTTPError, TimeoutError):
        raise MaximoReadError("Contract probe unavailable or timed out") from None
