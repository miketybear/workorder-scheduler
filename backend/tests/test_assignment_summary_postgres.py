import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from test_assignment_summary import task
from test_postgres import database, seed

from app.assignments.models import PlanningSnapshot
from app.assignments.summary import list_summaries, planning_summary
from app.maximo.page_routes import completed_keys
from app.scheduling.drafts import WorkOrderKey

pytestmark = pytest.mark.integration


def test_paged_completed_index_is_scoped_and_expires():
    async def scenario():
        async with database() as sessions:
            _, _, connections = await seed(sessions)
            demand = task()
            for source in demand["assignments"]:
                source.update(
                    laborcode="LAB", scheduledate="2026-10-01T00:00:00+07:00", status="ASSIGNED"
                )
            async with sessions.begin() as db:
                snapshot = PlanningSnapshot(
                    connection_id=connections[0].id,
                    site_id="SITE",
                    workorder_id="100",
                    discipline="E&I",
                    tasks=[demand],
                    verified_at=datetime.now(UTC),
                )
                db.add(snapshot)
                await db.flush()
                assert await completed_keys(db, connections[0].id, "E&I", 300) == {("SITE", "100")}
                assert await completed_keys(db, connections[1].id, "E&I", 300) == set()
                assert await completed_keys(db, connections[0].id, "MECH", 300) == set()
                snapshot.verified_at = datetime.now(UTC) - timedelta(seconds=301)
                await db.flush()
                assert await completed_keys(db, connections[0].id, "E&I", 300) == set()

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_verified_snapshot_expiry_connection_site_discipline_isolation():
    async def scenario():
        async with database() as sessions:
            _, _, connections = await seed(sessions)
            key = WorkOrderKey(connections[0].id, "SITE", "100")
            async with sessions.begin() as db:
                snapshot = PlanningSnapshot(
                    connection_id=key.connection_id,
                    site_id=key.site_id,
                    workorder_id=key.workorder_id,
                    discipline="E&I",
                    tasks=[task()],
                    verified_at=datetime.now(UTC),
                )
                db.add(snapshot)
                await db.flush()
                assert (await planning_summary(db, key, "E&I", 300))["state"] == "unallocated"
                assert (await planning_summary(db, key, "MECH", 300))["state"] == "unverified"
                assert (
                    await planning_summary(
                        db, WorkOrderKey(connections[1].id, "SITE", "100"), "E&I", 300
                    )
                )["state"] == "unverified"
                orders = [
                    SimpleNamespace(siteid="SITE", workorderid="100"),
                    SimpleNamespace(siteid="OTHER", workorderid="100"),
                ]
                summaries = await list_summaries(db, key.connection_id, "E&I", orders, 300)
                assert summaries[("SITE", "100")]["state"] == "unallocated"
                assert summaries[("OTHER", "100")]["state"] == "unverified"
                snapshot.verified_at = datetime.now(UTC) - timedelta(seconds=301)
                await db.flush()
                assert (await planning_summary(db, key, "E&I", 300))["state"] == "unverified"
                summaries = await list_summaries(db, key.connection_id, "E&I", orders, 300)
                assert summaries[("SITE", "100")]["state"] == "unverified"

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
