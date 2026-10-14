"""Bounded process-local metadata snapshots; grants are checked by each caller."""

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.maximo.reader import MaximoReadError


@dataclass(frozen=True)
class Snapshot:
    id: str
    orders: tuple
    expires_at: datetime
    byte_count: int
    refreshed: bool = False


class SnapshotCache:
    def __init__(self, ttl=120, max_entries=8, max_rows=20000, max_bytes=32 * 1024 * 1024):
        self.ttl = ttl
        self.max_entries = max_entries
        self.max_rows = max_rows
        self.max_bytes = max_bytes
        self.entries = OrderedDict()
        self.flights = {}
        self.lock = asyncio.Lock()
        self.owners = {}
        self.closed = False

    async def close(self):
        async with self.lock:
            self.closed = True
            tasks = list(self.owners.values())
            self.entries.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def _prune(self):
        now = datetime.now(UTC)
        for key, entry in list(self.entries.items()):
            if entry.expires_at <= now:
                self.entries.pop(key)

    async def current(self, key, snapshot_id=None):
        async with self.lock:
            self._prune()
            entry = self.entries.get(key)
            if entry and (snapshot_id is None or entry.id == snapshot_id):
                self.entries.move_to_end(key)
                return entry
            return None

    async def discard(self, key, snapshot_id):
        async with self.lock:
            entry = self.entries.get(key)
            if entry and entry.id == snapshot_id:
                self.entries.pop(key)

    async def acquire(self, key, loader, *, refresh=False):
        async with self.lock:
            if self.closed:
                raise MaximoReadError("Snapshot service is stopping")
            self._prune()
            future = self.flights.get(key)
            if future is None:
                entry = self.entries.get(key)
                recently_refreshed = (
                    entry
                    and entry.refreshed
                    and (entry.expires_at - timedelta(seconds=self.ttl - 2) > datetime.now(UTC))
                )
                if entry and (not refresh or recently_refreshed):
                    self.entries.move_to_end(key)
                    return entry, False
                self.entries.pop(key, None)
                # Bound concurrent scopes too, not only completed entries.
                if len(self.flights) >= self.max_entries:
                    raise MaximoReadError("Snapshot retrieval capacity reached; try again")
                future = asyncio.get_running_loop().create_future()
                future.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
                self.flights[key] = future
                self.owners[key] = asyncio.current_task()
                owner = True
            else:
                owner = False
        if not owner:
            # A cancelled waiter must not cancel another user's active retrieval.
            return await asyncio.shield(future), False
        try:
            orders = tuple(await loader())
            if len(orders) > self.max_rows:
                raise MaximoReadError("Snapshot row budget exceeded; narrow the date range")
            byte_count = sum(len(o.model_dump_json().encode("utf-8")) for o in orders)
            if byte_count > self.max_bytes:
                raise MaximoReadError("Snapshot byte budget exceeded; narrow the date range")
            entry = Snapshot(
                str(uuid4()),
                orders,
                datetime.now(UTC) + timedelta(seconds=self.ttl),
                byte_count,
                refresh,
            )
            async with self.lock:
                while self.entries and (
                    len(self.entries) >= self.max_entries
                    or sum(len(e.orders) for e in self.entries.values()) + len(orders)
                    > self.max_rows
                    or sum(e.byte_count for e in self.entries.values()) + byte_count
                    > self.max_bytes
                ):
                    self.entries.popitem(last=False)
                self.entries[key] = entry
                self.flights.pop(key, None)
                self.owners.pop(key, None)
                future.set_result(entry)
            return entry, True
        except BaseException as error:
            async with self.lock:
                self.flights.pop(key, None)
                self.owners.pop(key, None)
                future.set_exception(
                    MaximoReadError("Snapshot retrieval interrupted")
                    if isinstance(error, asyncio.CancelledError)
                    else error
                )
            raise
