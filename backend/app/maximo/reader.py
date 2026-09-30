import asyncio
import json
import re
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from urllib.parse import parse_qsl, urljoin, urlsplit

import httpx
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.config import MaximoSettings


class MaximoReadError(Exception):
    """Sanitized failure; never contains upstream content, query values or credentials."""


class WorkOrder(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    siteid: str = Field(min_length=1, max_length=50)
    workorderid: str = Field(min_length=1, max_length=100)
    wonum: str = Field(min_length=1, max_length=100)
    bdpocdiscipline: str = Field(min_length=1, max_length=50)
    worktype: str = Field(min_length=1, max_length=50)
    status: str = Field(min_length=1, max_length=50)
    description: str | None = None
    wolo10: Decimal | None = Field(default=None, ge=0, le=100)
    location: str | None = None
    systemid: str | None = None
    schedstart: AwareDatetime | None = None
    schedfinish: AwareDatetime | None = None
    actstart: AwareDatetime | None = None
    actfinish: AwareDatetime | None = None
    wopriority: int | None = None
    wopriority_description: str | None = None
    lead: str | None = None
    assignedtechname: str | None = None
    estdur: Decimal | None = Field(default=None, ge=0)
    targstartdate: AwareDatetime | None = None
    targcompdate: AwareDatetime
    istask: bool
    parent: str | None = None

    @field_validator("workorderid", mode="before")
    @classmethod
    def normalize_id(cls, value):
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)
        return value


SELECT = (
    "siteid,workorderid,wonum,bdpocdiscipline,description,worktype,wolo10,location,"
    "lochierarchy{systemid},schedstart,schedfinish,actstart,actfinish,status,"
    "wopriority,wopriority_description,lead,assignedtechname,estdur,targstartdate,"
    "targcompdate,istask,parent"
)


def query_parameters(settings: MaximoSettings, discipline: str, start: datetime, end: datetime):
    # Restrict codes rather than relying on undocumented escaping/wildcard semantics.
    if not re.fullmatch(r"[A-Za-z0-9_& -]{1,50}", discipline):
        raise MaximoReadError("Unsupported discipline code")
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise MaximoReadError("Invalid date range")
    where = (
        f'bdpocdiscipline={json.dumps(discipline)} and istask=0 and parent!="*"'
        f" and status in {json.dumps(settings.open_statuses)}"
        f" and targcompdate>={json.dumps(start.isoformat())}"
        f" and targcompdate<{json.dumps(end.isoformat())}"
    )
    return {
        "lean": "1",
        "oslc.select": SELECT,
        "oslc.where": where,
        "oslc.pageSize": str(settings.page_size),
        "oslc.orderBy": "+siteid,+workorderid",
    }


def next_page_url(link: str, settings: MaximoSettings, original: dict[str, str]) -> str:
    if not link or len(link) > 16000 or "\\" in link or any(ord(c) < 32 for c in link):
        raise MaximoReadError("Invalid paging response")
    target = urlsplit(urljoin(settings.collection_url, link))
    base = urlsplit(settings.collection_url)
    if (
        target.scheme != base.scheme
        or target.netloc != base.netloc
        or target.path.rstrip("/") != base.path
        or target.username
        or target.password
        or target.fragment
    ):
        raise MaximoReadError("Unsafe paging response")
    pairs = parse_qsl(target.query, keep_blank_values=True)
    params = dict(pairs)
    if len(pairs) != len(params):
        raise MaximoReadError("Invalid paging response")
    if any(key not in original and key not in {"pageno", "stableId"} for key in params):
        raise MaximoReadError("Unsupported paging response")
    if any(key in params and params[key] != value for key, value in original.items()):
        raise MaximoReadError("Paging scope changed")
    # Some installations omit the original filters from nextPage. Reapply them on every request.
    return str(httpx.URL(settings.collection_url).copy_merge_params({**params, **original}))


def map_work_order(raw: dict) -> WorkOrder:
    hierarchy = raw.get("lochierarchy")
    if isinstance(hierarchy, list):
        if len(hierarchy) > 1:
            raise MaximoReadError("Ambiguous System ID")
        hierarchy = hierarchy[0] if hierarchy else None
    if hierarchy is not None and not isinstance(hierarchy, dict):
        raise MaximoReadError("Invalid System ID")
    try:
        return WorkOrder.model_validate(
            {**raw, "systemid": hierarchy.get("systemid") if hierarchy else None}
        )
    except ValidationError:
        raise MaximoReadError("Invalid work order response") from None


async def read_open_orders(
    client: httpx.AsyncClient,
    settings: MaximoSettings,
    discipline: str,
    start: datetime,
    end: datetime,
) -> list[WorkOrder]:
    def validate(raw):
        order = map_work_order(raw)
        if (
            order.bdpocdiscipline != discipline
            or order.status not in settings.open_statuses
            or order.istask
            or order.parent not in (None, "")
            or not start <= order.targcompdate < end
        ):
            raise MaximoReadError("Maximo response outside requested scope")
        return order, (order.siteid, order.workorderid)

    return await read_collection(
        client, settings, query_parameters(settings, discipline, start, end), validate
    )


async def read_collection(
    client: httpx.AsyncClient,
    settings: MaximoSettings,
    original: dict[str, str],
    validate: Callable,
) -> list:
    url = str(httpx.URL(settings.collection_url).copy_merge_params(original))
    seen_pages: set[str] = set()
    seen_records: set[tuple[str, str]] = set()
    orders = []
    try:
        async with asyncio.timeout(settings.retrieval_timeout_seconds):
            for _ in range(settings.max_pages):
                if url in seen_pages:
                    raise MaximoReadError("Paging loop detected")
                seen_pages.add(url)
                async with client.stream(
                    "GET",
                    url,
                    headers={
                        "apikey": settings.api_key.get_secret_value(),
                        "Accept": "application/json",
                    },
                    timeout=settings.timeout_seconds,
                    follow_redirects=False,
                ) as response:
                    if response.status_code != 200:
                        raise MaximoReadError("Maximo retrieval failed")
                    payload = bytearray()
                    async for chunk in response.aiter_bytes():
                        payload.extend(chunk)
                        if len(payload) > settings.max_page_bytes:
                            raise MaximoReadError("Page size limit exceeded")
                try:
                    body = json.loads(payload)
                except (ValueError, UnicodeError):
                    raise MaximoReadError("Invalid Maximo response") from None
                if not isinstance(body, dict) or not isinstance(body.get("member"), list):
                    raise MaximoReadError("Invalid Maximo response")
                for raw in body["member"]:
                    if not isinstance(raw, dict):
                        raise MaximoReadError("Invalid work order response")
                    order, identity = validate(raw)
                    if identity in seen_records:
                        raise MaximoReadError("Duplicate work order across pages")
                    seen_records.add(identity)
                    orders.append(order)
                    if len(orders) > settings.max_rows:
                        raise MaximoReadError("Result limit exceeded; narrow the date range")
                info = body.get("responseInfo", {})
                if not isinstance(info, dict):
                    raise MaximoReadError("Invalid paging response")
                link = info.get("nextPage")
                if link is None:
                    return orders
                if isinstance(link, dict):
                    link = link.get("href")
                if not isinstance(link, str):
                    raise MaximoReadError("Invalid paging response")
                url = next_page_url(link, settings, original)
    except (httpx.HTTPError, TimeoutError):
        raise MaximoReadError("Maximo unavailable or request timed out") from None
    raise MaximoReadError("Page limit exceeded; narrow the date range")
