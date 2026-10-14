import asyncio
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.exc import SQLAlchemyError
from test_maximo import config

from app.assignments.uploads import verified_no_intent
from app.maximo.reader import MaximoReadError
from app.maximo.task_load import effective_load, read_load
from app.maximo.task_sender import read_target, send_assignment, siblings_unchanged


def run(coroutine):
    return asyncio.run(coroutine, loop_factory=asyncio.SelectorEventLoop)


def test_receipt_database_failure_cannot_prove_not_sent():
    class UnavailableSession:
        async def __aenter__(self):
            raise SQLAlchemyError("synthetic unavailable")

        async def __aexit__(self, *args):
            return False

    request = SimpleNamespace(
        state=SimpleNamespace(assignment_upload_actor_id=uuid4()),
        app=SimpleNamespace(state=SimpleNamespace(sessions=UnavailableSession)),
    )
    assert run(verified_no_intent(request, uuid4())) is False


def row(aid=1, **changes):
    return {
        "assignmentid": aid,
        "laborcode": "LAB",
        "craft": "OTHER",
        "scheduledate": "2026-10-01T06:30:00+07:00",
        "laborhrs": 1,
        "status": "COMPLETE",
        **changes,
    }


def root(wid, assignment):
    return {"siteid": "TEST", "workorderid": wid, "istask": True, "assignment": [assignment]}


def test_task_parent_duplicates_are_deduped_without_status_or_discipline_filter():
    async def scenario():
        def respond(request):
            assert "istask" not in request.url.params["oslc.where"]
            assert "bdpocdiscipline" not in request.url.params["oslc.where"]
            return httpx.Response(200, json={"member": [root(100, row()), root(101, row())]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            result = await read_load(
                client,
                config(task_load_contract="bdsched_assignment_test"),
                {"LAB"},
                date(2026, 10, 1),
                date(2026, 10, 2),
                "Asia/Ho_Chi_Minh",
            )
        assert len(result) == 1 and result["1"]["minutes"] == 60

    run(scenario())


@pytest.mark.parametrize(
    "bad", [row(laborhrs=-1), row(scheduledate="2026-10-01T06:00:00"), row(laborhrs="NaN")]
)
def test_invalid_remote_load_fails_closed(bad):
    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"member": [root(100, bad)]})
            )
        ) as client:
            with pytest.raises(MaximoReadError):
                await read_load(
                    client,
                    config(task_load_contract="bdsched_assignment_test"),
                    {"LAB"},
                    date(2026, 10, 1),
                    date(2026, 10, 2),
                    "Asia/Ho_Chi_Minh",
                )

    run(scenario())


def test_divergent_duplicate_load_fails_closed():
    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"member": [root(100, row()), root(101, row(laborhrs=2))]}
                )
            )
        ) as client:
            with pytest.raises(MaximoReadError):
                await read_load(
                    client,
                    config(task_load_contract="bdsched_assignment_test"),
                    {"LAB"},
                    date(2026, 10, 1),
                    date(2026, 10, 2),
                    "Asia/Ho_Chi_Minh",
                )

    run(scenario())


@pytest.mark.parametrize("assignments", [None, []])
def test_matching_parent_without_assignment_data_cannot_claim_zero_load(assignments):
    async def scenario():
        raw = {"siteid": "TEST", "workorderid": 100}
        if assignments is not None:
            raw["assignment"] = assignments
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"member": [raw]})
            )
        ) as client:
            with pytest.raises(MaximoReadError):
                await read_load(
                    client,
                    config(task_load_contract="bdsched_assignment_test"),
                    {"LAB"},
                    date(2026, 10, 1),
                    date(2026, 10, 2),
                    "Asia/Ho_Chi_Minh",
                )

    run(scenario())


def test_synced_exact_copy_counts_once_but_local_or_divergent_counts_conservatively():
    day = date(2026, 10, 1)
    item = SimpleNamespace(
        id=uuid4(), assignment_id="1", laborcode="LAB", date=day, minutes=60, sync_state="synced"
    )
    remote = {"1": {"laborcode": "LAB", "date": day, "minutes": 60}}
    assert effective_load([item], remote, "LAB", day)["allocated_minutes"] == 60
    assert effective_load([item], remote, "LAB", day)["synced_minutes"] == 60
    item.sync_state = "local"
    assert effective_load([item], remote, "LAB", day)["allocated_minutes"] == 120
    assert effective_load([item], remote, "LAB", day, item.id)["allocated_minutes"] == 60


@pytest.mark.parametrize(
    "status,outcome",
    [
        (200, "accepted"),
        (204, "accepted"),
        (412, "conflict"),
        (403, "failed"),
        (500, "unknown"),
        (302, "unknown"),
    ],
)
def test_writer_outcomes_no_retry(status, outcome):
    async def scenario():
        requests = []

        def respond(request):
            requests.append(request)
            assert request.headers["patchtype"] == "MERGE"
            return httpx.Response(status)

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            assert (
                await send_assignment(client, config(), {"resource_id": "safe"}, {}, uuid4())
                == outcome
            )
        assert len(requests) == 1

    run(scenario())


@pytest.mark.parametrize(
    "change",
    ["none", "deleted", "added", "hours", "labor", "status", "revision", "missing_baseline"],
)
def test_quantity_two_requires_untargeted_assignment_unchanged(change):
    selected = {
        "assignmentid": 10,
        "craft": "MECH",
        "laborhrs": 5,
        "status": "WAITASGN",
        "_rowstamp": "1",
    }
    sibling = {
        "assignmentid": 20,
        "craft": "MECH",
        "laborhrs": 5,
        "status": "WAITASGN",
        "_rowstamp": "2",
    }
    before = {"assignments": [selected, sibling]}
    after = {
        "assignments": [
            {**selected, "laborcode": "LAB", "status": "ASSIGNED", "_rowstamp": "3"},
            dict(sibling),
        ]
    }
    if change == "deleted":
        after["assignments"].pop()
    elif change == "added":
        after["assignments"].append({**sibling, "assignmentid": 30})
    elif change in {"hours", "labor", "status", "revision"}:
        field, value = {
            "hours": ("laborhrs", 4),
            "labor": ("laborcode", "OTHER"),
            "status": ("status", "ASSIGNED"),
            "revision": ("_rowstamp", "99"),
        }[change]
        after["assignments"][1][field] = value
    elif change == "missing_baseline":
        before = {"assignment": selected}
    assert siblings_unchanged(before, after, "10") == (change == "none")


def test_timeout_unknown_never_retries():
    async def scenario():
        count = 0

        def respond(request):
            nonlocal count
            count += 1
            raise httpx.ReadTimeout("synthetic")

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            assert (
                await send_assignment(client, config(), {"resource_id": "safe"}, {}, uuid4())
                == "unknown"
            )
        assert count == 1

    run(scenario())


@pytest.mark.parametrize("suffix", ["", "?evil=1", "#evil", "/extra"])
def test_target_lowercase_structure_preserves_resource_and_rejects_unsafe_href(suffix):
    async def scenario():
        allocation = SimpleNamespace(
            site_id="TEST", task_workorder_id="200", assignment_id="300", discipline="MECH"
        )
        data = {
            "siteid": "TEST",
            "workorderid": 200,
            "_rowstamp": "123",
            "href": "https://advertised.invalid/maximo/oslc/os/bdsched_wo/_AbC--" + suffix,
            "assignment": [{"assignmentid": 300, "craft": "MECH", "_rowstamp": "124"}],
        }
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"member": [data]})
            )
        ) as client:
            settings = config(collection_url="https://maximo.invalid/maximo/oslc/os/BDSCHED_WO")
            if suffix:
                with pytest.raises(MaximoReadError):
                    await read_target(client, settings, allocation)
            else:
                target = await read_target(client, settings, allocation)
                assert target["resource_id"] == "_AbC--"

    run(scenario())
