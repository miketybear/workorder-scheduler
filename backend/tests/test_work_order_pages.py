import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from app.maximo import page_routes
from app.maximo.pages import read_metadata_snapshot, verify_page_scope
from app.maximo.reader import MaximoReadError
from app.maximo.snapshots import SnapshotCache
from tests.test_maximo import END, START, config, record


def run(coroutine):
    return asyncio.run(coroutine)


def test_complete_metadata_one_call_keeps_scope_and_requires_real_total():
    calls = []

    async def scenario():
        def handler(request):
            calls.append(request)
            assert request.url.params["oslc.pageSize"] == "200"
            assert 'bdpocdiscipline="E&I"' in request.url.params["oslc.where"]
            return httpx.Response(
                200, json={"member": [record()], "responseInfo": {"totalCount": 1}}
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            orders = await read_metadata_snapshot(client, config(), "E&I", START, END, 10000)
            assert len(orders) == 1

    run(scenario())
    assert len(calls) == 1


@pytest.mark.parametrize(
    "fault", ["scope", "duplicate", "host", "loop", "count", "missing_next", "count_below_rows"]
)
def test_complete_metadata_rejects_scope_navigation_and_false_counts(fault):
    async def scenario():
        rows = [record(bdpocdiscipline="MECH")] if fault == "scope" else [record()]
        if fault == "duplicate":
            rows *= 2
        info = {}
        if fault == "host":
            info["nextPage"] = "https://evil.invalid/?pageno=2"
        if fault == "loop":
            info["nextPage"] = "?pageno=1"
        if fault == "count":
            info["totalCount"] = True
        if fault == "missing_next":
            info["totalCount"] = 117
        if fault == "count_below_rows":
            info["totalCount"] = 0
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"member": rows, "responseInfo": info})
            )
        ) as client:
            with pytest.raises(MaximoReadError):
                await read_metadata_snapshot(client, config(), "E&I", START, END, 10000)

    run(scenario())


async def route_case(
    monkeypatch, *, view="all", search="", cursor=None, complete=None, revoke=False
):
    connection_id, actor = uuid4(), SimpleNamespace(user_id=uuid4())
    settings, calls = config(), []
    complete = complete or set()

    @asynccontextmanager
    async def sessions():
        yield object()

    async def authorize(*_):
        if revoke and calls:
            raise HTTPException(404, "Denied")
        return object()

    async def sync(*_):
        pass

    async def identity(*_):
        return actor

    async def completed(*_):
        return complete

    async def summaries(_db, _connection, _discipline, orders, _ttl):
        return {
            (o.siteid, o.workorderid): {
                "state": "completed" if (o.siteid, o.workorderid) in complete else "unverified"
            }
            for o in orders
        }

    async def markers(_db, _actor, _connection, _discipline, orders):
        return {(o.siteid, o.workorderid): [] for o in orders}

    monkeypatch.setattr(page_routes, "authorized_connection", authorize)
    monkeypatch.setattr(page_routes, "sync_person_access", sync)
    monkeypatch.setattr(page_routes, "resolve_session", identity)
    monkeypatch.setattr(page_routes, "configured_connection", lambda *_: settings)
    monkeypatch.setattr(page_routes, "completed_keys", completed)
    monkeypatch.setattr(page_routes, "list_summaries", summaries)
    monkeypatch.setattr(page_routes, "planning_markers", markers)

    def upstream(request):
        number = int(request.url.params.get("pageno", "1"))
        if "workorderid in [" in request.url.params.get("oslc.where", ""):
            ids = request.url.params["oslc.where"].split("workorderid in [")[1].split("]")[0]
            calls.append("guard")
            return httpx.Response(
                200,
                json={
                    "member": [record(workorderid=int(i), wonum=f"WO{i}") for i in ids.split(",")]
                },
            )
        calls.append(number)
        return httpx.Response(
            200,
            json={
                "member": [
                    record(workorderid=i, wonum=f"WO{i}")
                    for i in range((number - 1) * 20, number * 20)
                ],
                "responseInfo": {"nextPage": f"?pageno={number + 1}", "totalCount": 100}
                if number < 5
                else {},
            },
        )

    app = SimpleNamespace(
        state=SimpleNamespace(
            sessions=sessions,
            work_order_snapshots=SnapshotCache(),
            settings=SimpleNamespace(assignment_summary_ttl_seconds=300),
            maximo_client_factory=lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            ),
        )
    )
    request = Request(
        {
            "type": "http",
            "app": app,
            "headers": [(b"cookie", b"wos_session=test")],
            "query_string": b"",
        }
    )
    # Use the product cookie name rather than relying on the test cookie above.
    request._cookies = {page_routes.SESSION_COOKIE: "test"}

    async def fetch(token=cursor, force=False):
        return await page_routes.work_order_page(
            request, Response(), connection_id, "E&I", START, END, view, search, token, force
        )

    fetch.cache = app.state.work_order_snapshots
    fetch.settings = settings
    fetch.app = app
    return fetch, calls


def test_snapshot_first_load_is_complete_and_next_page_only_guards_scope(monkeypatch):
    async def scenario():
        fetch, calls = await route_case(monkeypatch)
        page = await fetch()
        assert page["count"] == 20 and page["total_count"] == 100
        assert calls == [1, 2, 3, 4, 5, "guard"] and page["has_more"]
        second = await fetch(page["next_cursor"])
        assert (
            calls == [1, 2, 3, 4, 5, "guard", "guard"] and second["items"][0]["workorderid"] == "20"
        )

    run(scenario())


def test_search_covers_full_snapshot_and_has_exact_filtered_total(monkeypatch):
    async def scenario():
        fetch, calls = await route_case(monkeypatch, search="WO9")
        page = await fetch()
        assert page["count"] == 11 and page["total_count"] == 11 and not page["has_more"]
        assert "99" in [o["workorderid"] for o in page["items"]]
        assert calls == [1, 2, 3, 4, 5, "guard"]

    run(scenario())


def test_filtered_page_resumes_mid_source_page_without_skipping(monkeypatch):
    async def scenario():
        fetch, calls = await route_case(
            monkeypatch, view="backlog", complete={("TEST", str(i)) for i in range(10)}
        )
        page = await fetch()
        assert [o["workorderid"] for o in page["items"]] == [str(i) for i in range(10, 30)]
        assert calls == [1, 2, 3, 4, 5, "guard"] and page["total_count"] == 90
        second = await fetch(page["next_cursor"])
        assert [o["workorderid"] for o in second["items"]] == [str(i) for i in range(30, 50)]

    run(scenario())


def test_authority_is_rechecked_after_network(monkeypatch):
    async def scenario():
        fetch, _ = await route_case(monkeypatch, revoke=True)
        with pytest.raises(HTTPException) as caught:
            await fetch()
        assert caught.value.status_code == 404

    run(scenario())


def test_empty_completed_set_has_exact_zero_total(monkeypatch):
    async def scenario():
        fetch, calls = await route_case(monkeypatch, view="completed")
        page = await fetch()
        assert page["count"] == 0 and page["total_count"] == 0
        assert not page["has_more"] and calls == [1, 2, 3, 4, 5]

    run(scenario())


def test_completed_filter_returns_only_matching_site_and_keeps_continuation(monkeypatch):
    async def scenario():
        fetch, calls = await route_case(
            monkeypatch, view="completed", complete={("TEST", "21"), ("OTHER", "1")}
        )
        page = await fetch()
        assert [o["workorderid"] for o in page["items"]] == ["21"]
        assert (
            page["total_count"] == 1 and not page["has_more"] and calls == [1, 2, 3, 4, 5, "guard"]
        )

    run(scenario())


def test_changed_summary_during_release_fails_closed(monkeypatch):
    async def scenario():
        fetch, _ = await route_case(monkeypatch, view="backlog")

        async def changed(_db, _connection, _discipline, orders, _ttl):
            return {(o.siteid, o.workorderid): {"state": "completed"} for o in orders}

        monkeypatch.setattr(page_routes, "list_summaries", changed)
        with pytest.raises(HTTPException) as caught:
            await fetch()
        assert caught.value.status_code == 409

    run(scenario())


def test_same_id_in_another_site_is_not_hidden_from_backlog(monkeypatch):
    async def scenario():
        fetch, _ = await route_case(monkeypatch, view="backlog", complete={("OTHER", "1")})
        page = await fetch()
        assert "1" in [o["workorderid"] for o in page["items"]]

    run(scenario())


def test_cursor_membership_change_is_a_conflict_without_network(monkeypatch):
    async def scenario():
        fetch, calls = await route_case(monkeypatch, view="backlog")
        page = await fetch()

        async def changed(*_):
            return {("TEST", "1")}

        monkeypatch.setattr(page_routes, "completed_keys", changed)
        with pytest.raises(HTTPException) as caught:
            await fetch(page["next_cursor"])
        assert caught.value.status_code == 409 and calls == [1, 2, 3, 4, 5, "guard"]

    run(scenario())


@pytest.mark.parametrize("value", ["bad", "e30=", page_routes.encode_cursor({"query": "x"})])
def test_cursor_rejects_untrusted_shape(value):
    with pytest.raises(HTTPException):
        page_routes.decode_cursor(value, 20)


def test_expired_snapshot_cursor_is409_without_network(monkeypatch):
    from dataclasses import replace
    from datetime import UTC, datetime, timedelta

    async def scenario():
        fetch, calls = await route_case(monkeypatch)
        first = await fetch()
        for key, value in list(fetch.cache.entries.items()):
            fetch.cache.entries[key] = replace(
                value, expires_at=datetime.now(UTC) - timedelta(seconds=1)
            )
        with pytest.raises(HTTPException) as error:
            await fetch(first["next_cursor"])
        assert error.value.status_code == 409 and calls == [1, 2, 3, 4, 5, "guard"]

    run(scenario())


def test_refresh_replaces_generation_and_old_cursor_conflicts(monkeypatch):
    async def scenario():
        fetch, calls = await route_case(monkeypatch)
        first = await fetch()
        second = await fetch(force=True)
        assert first["snapshot_id"] != second["snapshot_id"]
        assert calls == [1, 2, 3, 4, 5, "guard"] * 2
        with pytest.raises(HTTPException) as error:
            await fetch(first["next_cursor"])
        assert error.value.status_code == 409
        with pytest.raises(HTTPException) as error:
            await fetch(second["next_cursor"], force=True)
        assert error.value.status_code == 422

    run(scenario())


def test_cached_page_moved_scope_fails_closed_and_discards_snapshot(monkeypatch):
    async def scenario():
        fetch, _ = await route_case(monkeypatch)
        first = await fetch()
        fetch.app.state.maximo_client_factory = lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"member": []}))
        )
        with pytest.raises(HTTPException) as error:
            await fetch(first["next_cursor"])
        assert error.value.status_code == 502 and not fetch.cache.entries

    run(scenario())


def test_cache_scope_key_changes_when_credentials_rotate(monkeypatch):
    from pydantic import SecretStr

    async def scenario():
        fetch, calls = await route_case(monkeypatch)
        first = await fetch()
        fetch.settings.api_key = SecretStr("rotated-synthetic-key")
        with pytest.raises(HTTPException) as error:
            await fetch(first["next_cursor"])
        assert error.value.status_code == 409 and calls == [1, 2, 3, 4, 5, "guard"]

    run(scenario())


def test_live_guard_keeps_composite_site_identity_even_if_upstream_ids_match():
    from app.maximo.reader import map_work_order

    async def scenario():
        def response(_):
            return httpx.Response(200, json={"member": [record(siteid="OTHER")]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            with pytest.raises(MaximoReadError):
                await verify_page_scope(
                    client, config(), "E&I", START, END, [map_work_order(record())]
                )

    run(scenario())


def test_full_metadata_builder_rejects_aggregate_byte_budget():
    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"member": [record(description="x" * 2048)]})
            )
        ) as client:
            with pytest.raises(MaximoReadError, match="byte budget"):
                await read_metadata_snapshot(client, config(), "E&I", START, END, 1024)

    run(scenario())


def test_fresh_snapshot_page_fails_if_wo_moves_between_source_pages(monkeypatch):
    async def scenario():
        fetch, _ = await route_case(monkeypatch)
        calls = []

        def upstream(request):
            calls.append(request)
            if "workorderid in [" in request.url.params["oslc.where"]:
                # WO 0 moved after source page 1. Scope filtering excludes it now.
                body = {"member": [record(workorderid=1)]}
            elif request.url.params.get("pageno") == "2":
                body = {"member": [record(workorderid=1)], "responseInfo": {"totalCount": 2}}
            else:
                body = {
                    "member": [record(workorderid=0)],
                    "responseInfo": {"totalCount": 2, "nextPage": "?pageno=2"},
                }
            return httpx.Response(200, json=body)

        fetch.app.state.maximo_client_factory = lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(upstream)
        )
        with pytest.raises(HTTPException) as error:
            await fetch()
        assert error.value.status_code == 502 and len(calls) == 3
        assert not fetch.cache.entries

    run(scenario())


def test_metadata_count_changes_mid_retrieval_fail_closed():
    async def scenario():
        def upstream(request):
            second = request.url.params.get("pageno") == "2"
            info = {"totalCount": 3 if second else 2}
            if not second:
                info["nextPage"] = "?pageno=2"
            return httpx.Response(
                200, json={"member": [record(workorderid=1 if second else 0)], "responseInfo": info}
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            with pytest.raises(MaximoReadError, match="count changed"):
                await read_metadata_snapshot(client, config(), "E&I", START, END, 10000)

    run(scenario())
