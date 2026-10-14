"""One monotonic deadline for read-only upstream and local draft requests."""

import asyncio

from fastapi import HTTPException, Request
from fastapi.routing import APIRoute


class ReadDraftDeadlineRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded_handler(request: Request):
            # The outer timeout includes validation, dependencies, PERSON checks, all
            # sequential/fan-out reads and local DB work. Inner timeouts cannot renew it.
            deadline = asyncio.timeout(
                request.app.state.settings.read_draft_request_timeout_seconds
            )
            try:
                async with deadline:
                    return await handler(request)
            except TimeoutError:
                if not deadline.expired():
                    raise
                # Local transactions may already have committed near the deadline.
                # Keep submission receipts; callers must reuse the same request ID.
                raise HTTPException(
                    504,
                    "Request timed out; no automatic retry was performed",
                    headers={"Cache-Control": "no-store"},
                ) from None

        return bounded_handler
