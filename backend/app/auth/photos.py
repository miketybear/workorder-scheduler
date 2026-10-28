"""Optional Graph photos; only bounded image bytes survive the login callback."""

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from fastapi import HTTPException, Request, Response

from app.auth.sessions import SESSION_COOKIE, SESSION_LIFETIME, resolve_session

PHOTO_URL = "https://graph.microsoft.com/v1.0/me/photos/48x48/$value"
PHOTO_MAX_BYTES = 128 * 1024
PHOTO_TIMEOUT_SECONDS = 5
PHOTO_CACHE_ENTRIES = 128
PHOTO_HEADERS = {
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
}


@dataclass(frozen=True)
class ProfilePhoto:
    content: bytes
    content_type: str


async def fetch_photo(access_token: str) -> ProfilePhoto | None:
    # Fixed HTTPS origin, no redirects/proxies, and no response/error logging.
    try:
        async with (
            asyncio.timeout(PHOTO_TIMEOUT_SECONDS),
            httpx.AsyncClient(
                timeout=PHOTO_TIMEOUT_SECONDS, trust_env=False, follow_redirects=False
            ) as client,
        ):
            async with client.stream(
                "GET", PHOTO_URL, headers={"Authorization": f"Bearer {access_token}"}
            ) as response:
                content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if response.status_code != 200 or content_type not in {"image/jpeg", "image/png"}:
                    return None
                content = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    if len(content) + len(chunk) > PHOTO_MAX_BYTES:
                        return None
                    content.extend(chunk)
                if not content:
                    return None
                return ProfilePhoto(bytes(content), content_type)
    except (httpx.HTTPError, TimeoutError):
        return None


class PhotoStore:
    """Per-process, session-hash keyed, FIFO bounded cache; never stores tokens."""

    def __init__(self, clock=lambda: datetime.now(UTC)):
        self._clock = clock
        self._items: OrderedDict[str, tuple[datetime, ProfilePhoto]] = OrderedDict()

    def purge(self):
        now = self._clock()
        for key in [key for key, (expiry, _) in self._items.items() if expiry <= now]:
            del self._items[key]

    def put(self, session_hash: str, photo: ProfilePhoto):
        self.purge()
        self.drop_session(session_hash)
        while len(self._items) >= PHOTO_CACHE_ENTRIES:
            self._items.popitem(last=False)
        self._items[session_hash] = (self._clock() + SESSION_LIFETIME, photo)

    def get(self, session_hash: str) -> ProfilePhoto | None:
        self.purge()
        item = self._items.get(session_hash)
        return item[1] if item else None

    def drop_session(self, session_hash: str):
        self._items.pop(session_hash, None)


async def session_photo(request: Request):
    async with request.app.state.sessions() as db:
        identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
    photo = request.app.state.profile_photos.get(identity.token_hash)
    if photo is None:
        raise HTTPException(404, "Profile photo unavailable", headers=PHOTO_HEADERS)
    return Response(photo.content, media_type=photo.content_type, headers=PHOTO_HEADERS)
