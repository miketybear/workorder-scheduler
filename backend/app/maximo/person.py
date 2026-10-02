import asyncio
import json
import re

import httpx

from app.config import MaximoSettings
from app.maximo.reader import MaximoReadError


def person_id_from_login(login_name: str | None, domain: str) -> str | None:
    if not login_name or login_name.count("@") != 1:
        return None
    local, actual_domain = login_name.lower().split("@")
    if actual_domain != domain or not re.fullmatch(r"[a-z0-9_.-]{1,50}", local):
        return None
    return local


async def read_person_discipline(
    client: httpx.AsyncClient, settings: MaximoSettings, person_id: str
) -> str | None:
    if not re.fullmatch(r"[a-z0-9_.-]{1,50}", person_id):
        raise MaximoReadError("Invalid PERSON locator")
    # Derive the sibling object structure only from the trusted configured WO URL.
    url = settings.collection_url.rsplit("/", 1)[0] + "/mxperson"
    params = {
        "lean": "1",
        "oslc.select": "personid,ct_discipline",
        "oslc.where": f"personid={json.dumps(person_id)}",
        "ignorers": "1",
        "ignorekeyref": "1",
        "oslc.pageSize": "2",
    }
    try:
        async with asyncio.timeout(settings.retrieval_timeout_seconds):
            async with client.stream(
                "GET",
                url,
                params=params,
                follow_redirects=False,
                headers={
                    "apikey": settings.api_key.get_secret_value(),
                    "Accept": "application/json",
                },
                timeout=settings.timeout_seconds,
            ) as response:
                if response.status_code != 200:
                    raise MaximoReadError("PERSON lookup failed")
                payload = bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > min(settings.max_page_bytes, 64000):
                        raise MaximoReadError("PERSON response too large")
            body = json.loads(payload)
    except (httpx.HTTPError, TimeoutError, ValueError, UnicodeError):
        raise MaximoReadError("PERSON lookup unavailable or invalid") from None
    if not isinstance(body, dict) or not isinstance(body.get("member"), list):
        raise MaximoReadError("Invalid PERSON response")
    info = body.get("responseInfo", {})
    if not isinstance(info, dict) or info.get("nextPage") is not None:
        raise MaximoReadError("Ambiguous PERSON response")
    members = body["member"]
    if not members:
        return None
    if len(members) != 1 or not isinstance(members[0], dict):
        raise MaximoReadError("Ambiguous PERSON response")
    person = members[0]
    actual_id = person.get("personid")
    if not isinstance(actual_id, str) or actual_id.lower() != person_id:
        raise MaximoReadError("PERSON response outside requested scope")
    discipline = person.get("ct_discipline")
    if discipline is None or discipline == "":
        return None
    if not isinstance(discipline, str) or not re.fullmatch(r"[A-Za-z0-9_& -]{1,50}", discipline):
        raise MaximoReadError("Invalid PERSON discipline")
    if not discipline.strip():
        return None
    return discipline
