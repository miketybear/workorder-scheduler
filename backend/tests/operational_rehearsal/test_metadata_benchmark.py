import asyncio
from collections import Counter
from pathlib import Path

import httpx
import pytest

from tests.operational_rehearsal.metadata_benchmark import (
    ReadClient,
    evidence_path,
    month_range,
    verification,
)


def test_evidence_path_cannot_write_outside_repository_evidence():
    with pytest.raises(ValueError, match="inside"):
        evidence_path(Path(__file__).parent / "report.json")


def test_month_range_rolls_december_and_keeps_business_timezone():
    start, end = month_range("2026-12")
    assert start.isoformat() == "2026-12-01T00:00:00+07:00"
    assert end.isoformat() == "2027-01-01T00:00:00+07:00"


def test_upstream_client_rejects_mutations_before_transport():
    async def scenario():
        counters = Counter()
        async with ReadClient(
            counters, transport=httpx.MockTransport(lambda _: httpx.Response(200))
        ) as client:
            with pytest.raises(ValueError, match="read-only"):
                await client.post("https://synthetic.invalid/")
        assert not counters

    asyncio.run(scenario())


def test_verification_fails_on_warm_metadata_reload_or_error_status():
    request = {"status": 200, "count": 20, "total_count": 166}
    cold = {
        "same_snapshot": True,
        "requests": [request, request],
        "upstream_requests": {"metadata": 1, "scope_guard": 2},
    }
    page = {**cold, "upstream_requests": {"scope_guard": 2}}
    search = {**page, "requests": [{"status": 200, "count": 1, "total_count": 1}] * 2}
    assert verification([cold], [page], [search], 166, 200)["passed"]
    assert not verification([cold], [cold], [search], 166, 200)["passed"]
    failed = {**search, "requests": [{"status": 502, "count": None, "total_count": None}] * 2}
    assert not verification([cold], [page], [failed], 166, 200)["passed"]
