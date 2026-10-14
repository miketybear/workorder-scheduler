"""LABOR REST read, scoped to one registered connection and organization."""

import asyncio
import base64
import json
import re
from uuid import UUID

import httpx

from app.maximo.reader import MaximoReadError, next_page_url


def labor_key(connection_id: UUID, orgid: str, laborcode: str) -> str:
    value = json.dumps([str(connection_id), orgid, laborcode], separators=(",", ":"))
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def related(value):
    if value is None:
        return []
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list) and all(isinstance(item, dict) for item in value):
        return value
    raise MaximoReadError("Invalid LABOR relationship")


def required(raw, key, limit=100):
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise MaximoReadError("Invalid LABOR identity")
    return value


async def read_labor(client, settings, connection_id: UUID, orgid: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,50}", orgid):
        raise MaximoReadError("Unsupported LABOR organization")
    labor_settings = settings.model_copy(
        update={"collection_url": settings.collection_url.rsplit("/", 1)[0] + "/mxlabor"}
    )
    params = {
        "lean": "1",
        "oslc.totalCount": "1",
        "oslc.where": f'status="ACTIVE" and orgid={json.dumps(orgid)}',
        "oslc.select": "laborcode,personid,orgid,status,person{displayname,title},"
        "laborcraftrate{craft,defaultcraft}",
        "oslc.pageSize": str(settings.page_size),
        "oslc.orderBy": "+laborcode",
    }

    def validate(raw):
        if raw.get("orgid") != orgid or raw.get("status") != "ACTIVE":
            raise MaximoReadError("LABOR response outside requested scope")
        code, person_id = required(raw, "laborcode"), required(raw, "personid")
        persons = related(raw.get("person"))
        if len(persons) != 1:
            raise MaximoReadError("Ambiguous LABOR person")
        name = required(persons[0], "displayname", 200)
        title = persons[0].get("title")
        if title is not None and (not isinstance(title, str) or len(title) > 200):
            raise MaximoReadError("Invalid PERSON title")
        crafts = set()
        for rate in related(raw.get("laborcraftrate")):
            flag = rate.get("defaultcraft")
            if type(flag) not in (bool, int) or flag not in (False, True, 0, 1):
                raise MaximoReadError("Invalid LABOR default craft")
            if flag:
                crafts.add(required(rate, "craft", 50))
        item = {
            "labor_key": labor_key(connection_id, orgid, code),
            "connection_id": str(connection_id),
            "orgid": orgid,
            "laborcode": code,
            "personid": person_id,
            "displayname": name,
            "title": title,
            "default_crafts": sorted(crafts),
        }
        return item, (orgid, code)

    return await complete_collection(client, labor_settings, params, validate)


async def complete_collection(client, settings, params, validate):
    url = str(httpx.URL(settings.collection_url).copy_merge_params(params))
    pages, keys, items, total = set(), set(), [], None
    try:
        async with asyncio.timeout(settings.retrieval_timeout_seconds):
            for _ in range(settings.max_pages):
                if url in pages:
                    raise MaximoReadError("LABOR paging loop")
                pages.add(url)
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
                        raise MaximoReadError("LABOR retrieval failed")
                    payload = bytearray()
                    async for chunk in response.aiter_bytes():
                        payload.extend(chunk)
                        if len(payload) > settings.max_page_bytes:
                            raise MaximoReadError("LABOR page exceeds limit")
                try:
                    body = json.loads(payload)
                except (ValueError, UnicodeError):
                    raise MaximoReadError("Invalid LABOR response") from None
                if not isinstance(body, dict) or not isinstance(body.get("member"), list):
                    raise MaximoReadError("Invalid LABOR response")
                info = body.get("responseInfo", {})
                if not isinstance(info, dict):
                    raise MaximoReadError("Invalid LABOR paging")
                reported = info.get("totalCount")
                if reported is not None:
                    if type(reported) is not int or reported < 0:
                        raise MaximoReadError("Invalid LABOR count")
                    if total is not None and total != reported:
                        raise MaximoReadError("LABOR changed during retrieval")
                    total = reported
                for raw in body["member"]:
                    if not isinstance(raw, dict):
                        raise MaximoReadError("Invalid LABOR record")
                    item, key = validate(raw)
                    if key in keys:
                        raise MaximoReadError("Duplicate LABOR across pages")
                    keys.add(key)
                    items.append(item)
                    if len(items) > settings.max_rows:
                        raise MaximoReadError("LABOR result exceeds limit")
                link = info.get("nextPage")
                if link is None:
                    if total is not None and total != len(items):
                        raise MaximoReadError("Incomplete LABOR snapshot")
                    if total is None and len(body["member"]) >= settings.page_size:
                        raise MaximoReadError("LABOR completeness not verified")
                    return items
                if isinstance(link, dict):
                    link = link.get("href")
                if not isinstance(link, str):
                    raise MaximoReadError("Invalid LABOR paging")
                url = next_page_url(link, settings, params)
    except (httpx.HTTPError, TimeoutError):
        raise MaximoReadError("LABOR unavailable or request timed out") from None
    raise MaximoReadError("LABOR page limit exceeded")
