"""Maximo access for the BD_WO route.

maxauth and API keys go only to the configured connection. Every link Maximo returns is
validated and rewritten onto that connection, or refused, before a request is made.
"""

import base64
import json
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.config import MaximoSettings, WorkflowRouteAccount, WorkflowRouteSettings
from app.maximo.contract_probe import canonical_resource
from app.maximo.detail import code, read_pics
from app.maximo.reader import MaximoReadError, read_collection
from app.maximo.write_contract_probe import ibm_reason_code
from app.scheduling.drafts import WorkOrderKey

ORDER_SELECT = (
    "siteid,workorderid,wonum,bdpocdiscipline,worktype,status,istask,parent,schedstart,"
    "schedfinish,assignedto,assigneddate,supname,href,_rowstamp,"
    "rel.wfassignment{wfassignmentid,processname,processrev,nodeid,assignstatus,assigncode}"
)
POSITION_SELECT = (
    "wfassignmentid,ownerid,ownertable,processname,processrev,nodeid,assignstatus,assigncode,href"
)
# UNVERIFIED shape: confirm with one read-only probe of the revision before enabling.
PROCESS_SELECT = "processname,processrev,active,wfnode{*},wfaction{*}"


class UnsafeLink(Exception):
    """A Maximo-supplied link did not stay on the configured connection."""


class RouteTransportError(Exception):
    """Timeout or connection loss: whether Maximo applied the request is unknown."""


@dataclass(frozen=True)
class Reply:
    status: int
    location: str | None
    body: object
    reason: str | None


@dataclass(frozen=True)
class Assignment:
    id: str
    process: str
    revision: int | None
    node: int | None
    status: str
    assigncode: str | None


@dataclass(frozen=True)
class RouteOrder:
    siteid: str
    workorderid: str
    wonum: str
    discipline: str
    worktype: str
    status: str
    parent: str | None
    istask: bool
    has_schedule: bool
    assignedto: str | None
    has_assigneddate: bool
    supname: str | None
    resource_id: str | None
    rowstamp: str | None
    assignments: tuple[Assignment, ...]


@dataclass(frozen=True)
class PositionAssignment:
    id: str
    href: str
    process: str
    revision: int | None
    node: int | None
    assigncode: str | None


def text(value) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, str)):
        value = str(value).strip()
        return value or None
    return None


def integer(value) -> int | None:
    value = text(value)
    return int(value) if value and re.fullmatch(r"[0-9]{1,9}", value) else None


def os_url(config: MaximoSettings, name: str) -> str:
    return config.collection_url.rsplit("/", 1)[0] + "/" + name


def api_root(config: MaximoSettings) -> str:
    return urlsplit(config.collection_url).path.rsplit("/oslc/os/", 1)[0]


def rewrite_link(link, config: MaximoSettings, path_pattern: str) -> str:
    """Return the link on the configured host, or refuse. Credentials follow this URL only."""
    if (
        not isinstance(link, str)
        or not link
        or len(link) > 2000
        or "\\" in link
        or any(ord(char) <= 32 or ord(char) == 127 for char in link)
    ):
        raise UnsafeLink()
    try:
        target, base = urlsplit(link), urlsplit(config.collection_url)
        _ = target.port
    except ValueError:
        raise UnsafeLink() from None
    if target.username or target.password or target.query or target.fragment:
        raise UnsafeLink()
    if target.scheme or target.netloc:
        origin = f"{target.scheme}://{target.netloc}"
        same = (target.scheme, target.netloc) == (base.scheme, base.netloc)
        if not same and origin not in config.paging_origin_aliases:
            raise UnsafeLink()
    elif not target.path.startswith("/"):
        raise UnsafeLink()
    root = api_root(config)
    if not target.path.startswith(root + "/") or not re.fullmatch(
        path_pattern, target.path[len(root) :], flags=re.IGNORECASE
    ):
        raise UnsafeLink()
    return str(httpx.URL(config.collection_url).copy_with(path=target.path, query=None))


def assignment_href_pattern(route: WorkflowRouteSettings) -> str:
    return rf"/oslc/os/{re.escape(route.object_structure)}/[A-Za-z0-9_~-]{{1,200}}"


def location_pattern(route: WorkflowRouteSettings) -> str:
    return rf"/oslc/wf/{re.escape(route.object_structure)}_[A-Za-z0-9_~-]{{1,100}}"


def maxauth_value(username: str, password: str) -> str:
    return base64.b64encode(f"{username}:{password}".encode()).decode()


async def call(client, method, url, *, headers, timeout, json_body=None, limit=256_000) -> Reply:
    try:
        async with client.stream(
            method,
            url,
            headers=headers,
            json=json_body,
            follow_redirects=False,
            timeout=timeout,
        ) as response:
            payload = bytearray()
            async for chunk in response.aiter_bytes():
                payload.extend(chunk)
                if len(payload) > limit:
                    break
            status, location = response.status_code, response.headers.get("location")
    except httpx.HTTPError:
        raise RouteTransportError() from None
    try:
        body = json.loads(payload) if payload and len(payload) <= limit else None
    except (ValueError, UnicodeError):
        body = None
    return Reply(status, location, body, ibm_reason_code(payload) if status >= 400 else None)


async def whoami(client, config: MaximoSettings, maxauth: str) -> Reply:
    url = httpx.URL(config.collection_url).copy_with(path=api_root(config) + "/oslc/whoami")
    return await call(
        client,
        "GET",
        str(url.copy_with(query=None)),
        headers=route_headers(maxauth),
        timeout=config.timeout_seconds,
    )


def parse_assignment(raw) -> Assignment:
    if not isinstance(raw, dict):
        raise MaximoReadError("Invalid workflow assignment response")
    identifier, process = text(raw.get("wfassignmentid")), text(raw.get("processname"))
    if not identifier or not re.fullmatch(r"[0-9]{1,30}", identifier) or not process:
        raise MaximoReadError("Invalid workflow assignment response")
    return Assignment(
        identifier,
        process,
        integer(raw.get("processrev")),
        integer(raw.get("nodeid")),
        (text(raw.get("assignstatus")) or "").upper(),
        text(raw.get("assigncode")),
    )


async def read_route_order(client, config: MaximoSettings, key: WorkOrderKey, discipline: str):
    """Scoped BDSCHED_WO read with the data the route rules need; None when out of scope."""
    if not re.fullmatch(r"[0-9]{1,30}", key.workorder_id):
        raise MaximoReadError("Invalid work order identity")
    params = {
        "lean": "1",
        "oslc.select": ORDER_SELECT,
        "oslc.pageSize": "2",
        "oslc.where": f"siteid={code(key.site_id)} and workorderid={int(key.workorder_id)}"
        f" and bdpocdiscipline={code(discipline)}",
    }

    def validate(raw):
        site, workorder = text(raw.get("siteid")), text(raw.get("workorderid"))
        if (
            site != key.site_id
            or workorder != key.workorder_id
            or text(raw.get("bdpocdiscipline")) != discipline
            or not text(raw.get("wonum"))
        ):
            raise MaximoReadError("Work order outside requested scope")
        relation = raw.get("wfassignment", raw.get("rel.wfassignment")) or []
        if not isinstance(relation, list) or len(relation) > 200:
            raise MaximoReadError("Invalid workflow assignment response")
        href = raw.get("href")
        resource_id = canonical_resource(href, config)[1] if href else None
        rowstamp = text(raw.get("_rowstamp"))
        order = RouteOrder(
            site,
            workorder,
            text(raw.get("wonum")),
            discipline,
            text(raw.get("worktype")) or "",
            text(raw.get("status")) or "",
            text(raw.get("parent")),
            raw.get("istask") is True,
            bool(raw.get("schedstart")) and bool(raw.get("schedfinish")),
            text(raw.get("assignedto")),
            bool(raw.get("assigneddate")),
            text(raw.get("supname")),
            resource_id,
            rowstamp if rowstamp and re.fullmatch(r"[1-9][0-9]{0,29}", rowstamp) else None,
            tuple(parse_assignment(item) for item in relation),
        )
        return order, (order.siteid, order.workorderid)

    orders = await read_collection(client, config, params, validate)
    if not orders:
        return None
    if len(orders) != 1:
        raise MaximoReadError("Ambiguous work order identity")
    return orders[0]


async def read_position_assignments(
    client,
    config: MaximoSettings,
    route: WorkflowRouteSettings,
    account: WorkflowRouteAccount,
    workorder_id: str,
) -> list[PositionAssignment]:
    """The shared position account's ACTIVE BD_WO work for one WO, read with its own API key."""
    if not re.fullmatch(r"[0-9]{1,30}", workorder_id):
        raise MaximoReadError("Invalid work order identity")
    scoped = config.model_copy(
        update={
            "collection_url": os_url(config, route.object_structure.lower()),
            "api_key": account.api_key,
        }
    )
    params = {
        "lean": "1",
        "oslc.select": POSITION_SELECT,
        "oslc.pageSize": "20",
        "oslc.where": f'ownerid={int(workorder_id)} and ownertable="WORKORDER"'
        f' and assignstatus="ACTIVE" and processname={code(route.process)}',
    }

    def validate(raw):
        assignment = parse_assignment(raw)
        try:
            href = rewrite_link(
                raw.get("localref", raw.get("href")), config, assignment_href_pattern(route)
            )
        except UnsafeLink:
            raise MaximoReadError("Unsafe workflow assignment link") from None
        if (
            text(raw.get("ownerid")) != str(int(workorder_id))
            or (text(raw.get("ownertable")) or "").upper() != "WORKORDER"
            or assignment.process != route.process
            or assignment.status != "ACTIVE"
        ):
            raise MaximoReadError("Workflow assignment outside requested scope")
        return (
            PositionAssignment(
                assignment.id,
                href,
                assignment.process,
                assignment.revision,
                assignment.node,
                assignment.assigncode,
            ),
            assignment.id,
        )

    return await read_collection(client, scoped, params, validate)


async def read_process(client, config: MaximoSettings, route: WorkflowRouteSettings) -> list[dict]:
    scoped = config.model_copy(update={"collection_url": os_url(config, "mxapiwfprocess")})
    params = {
        "lean": "1",
        "oslc.select": PROCESS_SELECT,
        "oslc.pageSize": "5",
        "oslc.where": f"processname={code(route.process)}"
        # Unpinned: only the active revision is needed; every revision would be several MB of nodes.
        + (f" and processrev={route.revision}" if route.revision is not None else " and active=1"),
    }

    def validate(raw):
        return raw, (text(raw.get("processname")), text(raw.get("processrev")))

    return await read_collection(client, scoped, params, validate)


async def read_supervisors(client, config: MaximoSettings, route: WorkflowRouteSettings):
    """Members of the configured supervisor group, through the verified crew reader."""
    scoped = config.model_copy(update={"crew_groups": {"supervisors": route.supervisor_group}})
    return await read_pics(client, scoped, "supervisors")


def route_headers(maxauth: str) -> dict[str, str]:
    return {"maxauth": maxauth, "Accept": "application/json"}


async def complete_assignment(client, config, href: str, maxauth: str, memo: str) -> Reply:
    return await call(
        client,
        "POST",
        href + "?action=wsmethod:completeAssignment",
        headers={**route_headers(maxauth), "x-method-override": "PATCH"},
        json_body={"memo": memo, "accepted": True},
        timeout=config.timeout_seconds,
    )


async def choose_option(
    client, config, location: str, maxauth: str, action_id: int, memo: str
) -> Reply:
    # Exactly one attempt: a repeated choice could double-route or corrupt the instance.
    return await call(
        client,
        "POST",
        location,
        headers=route_headers(maxauth),
        json_body={"actionid": action_id, "memo": memo},
        timeout=config.timeout_seconds,
    )
