import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.maximo.reader import MaximoReadError, map_work_order
from app.maximo.snapshots import SnapshotCache
from tests.test_maximo import record


def rows(count=1, description="Short"):
    return [map_work_order(record(workorderid=i, description=description)) for i in range(count)]


def test_ttl_lru_rows_and_bytes_are_bounded():
    async def scenario():
        cache = SnapshotCache(max_entries=2, max_rows=3)

        async def load():
            return rows(2)

        first, _ = await cache.acquire("a", load)
        await cache.acquire("b", load)
        assert await cache.current("a") is None  # Row budget evicts even below entry limit.
        assert len(cache.entries) == 1
        cache.entries["b"] = replace(
            cache.entries["b"], expires_at=datetime.now(UTC) - timedelta(seconds=1)
        )
        assert await cache.current("b") is None
        assert await cache.current("a", first.id) is None
        tiny = SnapshotCache(max_bytes=64)
        with pytest.raises(MaximoReadError):
            await tiny.acquire("a", load)
        assert not tiny.entries and not tiny.flights
        limited = SnapshotCache(max_entries=2)
        for key in ("a", "b", "c"):
            await limited.acquire(key, load)
        assert list(limited.entries) == ["b", "c"]

    asyncio.run(scenario())


def test_same_scope_singleflight_and_refresh_coalesce():
    async def scenario():
        cache = SnapshotCache()
        entered, proceed = asyncio.Event(), asyncio.Event()
        calls = 0

        async def load():
            nonlocal calls
            calls += 1
            entered.set()
            await proceed.wait()
            return rows()

        owner = asyncio.create_task(cache.acquire("a", load, refresh=True))
        await entered.wait()
        waiter = asyncio.create_task(cache.acquire("a", load, refresh=True))
        await asyncio.sleep(0)
        proceed.set()
        a, b = await asyncio.gather(owner, waiter)
        assert a[0].id == b[0].id and calls == 1
        assert (await cache.acquire("a", load, refresh=True))[0].id == a[0].id
        assert (
            calls == 1
        )  # Concurrent refresh requests reaching cache just after publication coalesce.

    asyncio.run(scenario())


def test_failed_loads_are_not_cached_and_distinct_flights_are_bounded():
    async def scenario():
        cache = SnapshotCache(max_entries=1)
        entered, proceed = asyncio.Event(), asyncio.Event()

        async def fail():
            entered.set()
            await proceed.wait()
            raise MaximoReadError("Synthetic failure")

        owner = asyncio.create_task(cache.acquire("a", fail))
        await entered.wait()

        async def good():
            return rows()

        with pytest.raises(MaximoReadError):
            await cache.acquire("b", good)
        proceed.set()
        with pytest.raises(MaximoReadError):
            await owner
        assert not cache.entries and not cache.flights
        assert (await cache.acquire("a", good))[1]

    asyncio.run(scenario())


def test_cancelled_waiter_does_not_cancel_builder_and_shutdown_cancels_builders():
    async def scenario():
        cache = SnapshotCache()
        entered, proceed = asyncio.Event(), asyncio.Event()

        async def load():
            entered.set()
            await proceed.wait()
            return rows()

        owner = asyncio.create_task(cache.acquire("a", load))
        await entered.wait()
        waiter = asyncio.create_task(cache.acquire("a", load))
        await asyncio.sleep(0)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        assert not owner.done()
        await cache.close()
        assert owner.cancelled() and not cache.flights and not cache.entries
        with pytest.raises(MaximoReadError):
            await cache.acquire("a", load)

    asyncio.run(scenario())
