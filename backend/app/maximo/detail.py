import json
import re
from collections.abc import Iterable
from urllib.parse import urlsplit

import httpx

from app.config import MaximoSettings
from app.maximo.reader import SELECT, MaximoReadError, map_work_order, read_collection
from app.scheduling.changes import WorkOrderBaseline
from app.scheduling.drafts import CurrentWorkOrder, WorkOrderKey


def code(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_& -]{1,100}", value):
        raise MaximoReadError("Unsupported identity code")
    return json.dumps(value)


async def read_detail(
    client: httpx.AsyncClient, settings: MaximoSettings, key: WorkOrderKey, discipline: str
):
    if not re.fullmatch(r"[0-9]{1,30}", key.workorder_id):
        raise MaximoReadError("Invalid work order identity")
    params = {
        "lean": "1",
        "oslc.select": SELECT,
        "oslc.pageSize": "2",
        "oslc.where": f"siteid={code(key.site_id)} and workorderid={int(key.workorder_id)}"
        f" and bdpocdiscipline={code(discipline)}",
    }

    def validate(raw):
        order = map_work_order(raw)
        if (
            order.siteid != key.site_id
            or order.workorderid != key.workorder_id
            or order.bdpocdiscipline != discipline
        ):
            raise MaximoReadError("Work order outside requested scope")
        return order, (order.siteid, order.workorderid)

    orders = await read_collection(client, settings, params, validate)
    if not orders:
        return None
    if len(orders) != 1:
        raise MaximoReadError("Ambiguous work order identity")
    return orders[0]


async def read_pics(
    client: httpx.AsyncClient, settings: MaximoSettings, discipline: str
) -> frozenset[str]:
    group = settings.crew_groups.get(discipline)
    if group is None:
        raise MaximoReadError("Crew group is not configured")
    # Derived only from the configured WO collection, never a browser-supplied host/path.
    crew_settings = settings.model_copy(
        update={"collection_url": settings.collection_url.rsplit("/", 1)[0] + "/mxpersongroup"}
    )
    params = {
        "lean": "1",
        "oslc.select": "persongroup,persongroupteam{respparty}",
        "oslc.where": f"persongroup={code(group)}",
        "oslc.pageSize": "2",
    }

    def validate(raw):
        if raw.get("persongroup") != group:
            raise MaximoReadError("Crew outside requested scope")
        if raw.get("persongroupteam_collectionref"):
            return raw, group
        if raw.get("persongroupteam_responseInfo"):
            raise MaximoReadError("Crew response is incomplete")
        team = raw.get("persongroupteam")
        if not isinstance(team, list) or len(team) > settings.max_rows:
            raise MaximoReadError("Invalid crew response")
        people = set()
        for person in team:
            name = person.get("respparty") if isinstance(person, dict) else None
            if not isinstance(name, str) or not name.strip() or len(name) > 200:
                raise MaximoReadError("Invalid crew member")
            people.add(name)
        return frozenset(people), group

    groups = await read_collection(client, crew_settings, params, validate)
    if len(groups) != 1:
        raise MaximoReadError("Configured crew group not found")
    result = groups[0]
    if isinstance(result, frozenset):
        return result
    relation = trusted_team_relation(result, crew_settings.collection_url)
    team_settings = crew_settings.model_copy(update={"collection_url": relation})

    def validate_person(raw):
        name = raw.get("respparty")
        href = raw.get("localref", raw.get("href"))
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise MaximoReadError("Invalid crew member")
        if not isinstance(href, str):
            raise MaximoReadError("Invalid crew identity")
        target, base = urlsplit(href), urlsplit(relation)
        if (
            target.scheme not in {"http", "https"}
            or target.username
            or target.password
            or not target.path.startswith(base.path + "/")
            or target.query
            or target.fragment
            or "\\" in href
            or any(ord(char) < 32 for char in href)
            or not re.fullmatch(r"[A-Za-z0-9_~-]+", target.path[len(base.path) + 1 :])
        ):
            raise MaximoReadError("Invalid crew identity")
        return name, (group, target.path)

    people = await read_collection(
        client,
        team_settings,
        {"lean": "1", "oslc.select": "respparty", "oslc.pageSize": str(settings.page_size)},
        validate_person,
    )
    return frozenset(people)


def display_name(raw) -> str | None:
    """Maximo displayname, else lastname + firstname (Maximo's own display order)."""
    parts = [raw.get(field) for field in ("displayname", "firstname", "lastname")]
    if not all(part is None or isinstance(part, str) for part in parts):
        return None
    display, first, last = (" ".join((part or "").split()) for part in parts)
    name = display or " ".join(part for part in (last, first) if part)
    return name if 0 < len(name) <= 200 and name.isprintable() else None


async def read_pic_names(
    client: httpx.AsyncClient, settings: MaximoSettings, codes: Iterable[str | None]
) -> dict[str, str]:
    """PERSON display names for already-authorized codes; unknown names are omitted.

    Names are display-only, so an unavailable PERSON read yields no names instead of
    failing the work order response. Names never come from the browser.
    """
    quoted = {}
    for value in sorted({value for value in codes if value}):
        try:
            quoted[value] = code(value)
        except MaximoReadError:
            continue  # Not a valid PERSON code; there is nothing safe to look up.
    person_settings = settings.model_copy(
        update={"collection_url": settings.collection_url.rsplit("/", 1)[0] + "/mxperson"}
    )
    names: dict[str, str] = {}
    values = list(quoted)
    for start in range(0, len(values), 100):
        chunk = values[start : start + 100]
        params = {
            "lean": "1",
            "oslc.select": "personid,displayname,firstname,lastname",
            "oslc.where": "personid in [" + ",".join(quoted[value] for value in chunk) + "]",
            "oslc.pageSize": str(len(chunk)),
        }

        def validate(raw, chunk=chunk):
            personid = raw.get("personid")
            if not isinstance(personid, str):
                raise MaximoReadError("Invalid PERSON response")
            # Ignore anything that was not requested rather than trusting it.
            return (personid, display_name(raw) if personid in chunk else None), personid

        try:
            people = await read_collection(client, person_settings, params, validate)
        except MaximoReadError:
            return {}
        names.update({personid: name for personid, name in people if name})
    return names


def trusted_team_relation(raw: dict, collection_url: str) -> str:
    parent, relation = raw.get("href"), raw.get("persongroupteam_collectionref")
    if not isinstance(parent, str) or not isinstance(relation, str):
        raise MaximoReadError("Invalid crew relation")
    base, resource, target = urlsplit(collection_url), urlsplit(parent), urlsplit(relation)
    if (
        any("\\" in value or any(ord(char) < 32 for char in value) for value in (parent, relation))
        or resource.scheme not in {"http", "https"}
        or resource.username
        or resource.password
        or resource.query
        or resource.fragment
        or not resource.path.startswith(base.path + "/")
        or not re.fullmatch(r"[A-Za-z0-9_~-]+", resource.path[len(base.path) + 1 :])
        or target.scheme not in {"http", "https"}
        or target.username
        or target.password
        or target.query
        or target.fragment
        or target.path
        not in {resource.path + "/persongroupteam", resource.path + "/allpersongroupteam"}
    ):
        raise MaximoReadError("Unsafe crew relation")
    # Maximo test can advertise its production public URL. Use only validated resource
    # path segments as identifiers; credentials always stay on the configured test origin.
    return str(httpx.URL(collection_url).copy_with(path=target.path))


def current_snapshot(
    key: WorkOrderKey, order, pics: frozenset[str], pic_names: dict[str, str] | None = None
) -> CurrentWorkOrder:
    baseline = WorkOrderBaseline.model_validate(
        {field: getattr(order, field) for field in WorkOrderBaseline.model_fields}
    )
    # Collection ETags are not record revisions. Leave revision unset until verified on test.
    return CurrentWorkOrder(
        key, order.wonum, order.bdpocdiscipline, None, baseline, pics, pic_names or {}
    )
