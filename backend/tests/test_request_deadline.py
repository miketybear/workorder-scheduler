import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import ValidationError
from test_maximo import config, record

from app.config import Settings
from app.main import create_app
from app.maximo import routes as maximo_routes
from app.maximo.reader import MaximoReadError, WorkOrder
from app.request_deadline import ReadDraftDeadlineRoute
from app.scheduling import batches, routes
from app.scheduling.upload_routes import router as upload_router


def settings(**kwargs):
    return Settings(
        _env_file=None,
        environment="test",
        database_url="postgresql+psycopg://test:test@127.0.0.1:55432/scheduler_test",
        **kwargs,
    )


@pytest.mark.parametrize("value", [0, 301])
def test_request_budget_is_bounded(value):
    with pytest.raises(ValidationError):
        settings(read_draft_request_timeout_seconds=value)


def test_request_budget_default():
    assert settings().read_draft_request_timeout_seconds == 180


@pytest.mark.parametrize("case", ["success", "authorization", "inner-timeout", "dependency"])
def test_wrapper_preserves_success_and_errors_and_bounds_dependencies(case):
    async def scenario():
        app = FastAPI()
        app.state.settings = settings(read_draft_request_timeout_seconds=1)
        router = APIRouter(route_class=ReadDraftDeadlineRoute)
        cancelled = False

        async def dependency():
            nonlocal cancelled
            if case == "dependency":
                try:
                    await asyncio.sleep(10)
                finally:
                    cancelled = True

        @router.get("/bounded", dependencies=[Depends(dependency)])
        async def endpoint():
            if case == "authorization":
                raise HTTPException(403, "Denied")
            if case == "inner-timeout":
                raise TimeoutError("inner sentinel")
            return {"ok": True}

        app.include_router(router)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://test.example"
        ) as client:
            if case == "inner-timeout":
                with pytest.raises(TimeoutError, match="inner sentinel"):
                    await client.get("/bounded")
                return
            response = await client.get("/bounded")
        assert (
            response.status_code == {"success": 200, "authorization": 403, "dependency": 504}[case]
        )
        if case == "dependency":
            assert cancelled
            assert response.headers["Cache-Control"] == "no-store"
            assert (
                response.json()["detail"] == "Request timed out; no automatic retry was performed"
            )

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_detail_sequential_scope_wo_and_pic_reads_share_one_budget(monkeypatch):
    async def scenario():
        connection = uuid4()
        app = create_app(settings(read_draft_request_timeout_seconds=1))
        calls = []
        config_value = config(crew_groups={"MECH": "CREW"})

        async def checked(*args, **kwargs):
            calls.append("scope")
            await asyncio.sleep(0.4)
            return SimpleNamespace(user_id=uuid4()), config_value

        async def detail(*args):
            calls.append("WO")
            await asyncio.sleep(0.4)
            return WorkOrder.model_validate(record(bdpocdiscipline="MECH"))

        async def pics(*args):
            calls.append("PIC")
            try:
                await asyncio.sleep(0.4)
            finally:
                calls.append("PIC drained")

        @asynccontextmanager
        async def factory():
            try:
                yield object()
            finally:
                assert calls[-1] == "PIC drained"
                calls.append("client closed")

        monkeypatch.setattr(routes, "checked_settings", checked)
        monkeypatch.setattr(routes, "read_detail", detail)
        monkeypatch.setattr(routes, "read_pics", pics)
        app.state.maximo_client_factory = factory
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://test.example"
        ) as client:
            started = asyncio.get_running_loop().time()
            response = await client.get(
                "/api/work-orders/detail",
                params={
                    "connection_id": str(connection),
                    "site_id": "TEST",
                    "workorder_id": "100",
                    "discipline": "MECH",
                },
            )
            assert asyncio.get_running_loop().time() - started < 2
        assert response.status_code == 504
        assert calls == ["scope", "WO", "PIC", "PIC drained", "client closed"]

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_batch_deadline_cancels_running_and_queued_children_before_client_close(monkeypatch):
    async def scenario():
        app = create_app(settings(read_draft_request_timeout_seconds=1))
        started, drained = set(), set()
        config_value = config(crew_groups={"MECH": "CREW"})

        async def checked(*args, **kwargs):
            return SimpleNamespace(user_id=uuid4()), config_value

        async def pics(*args):
            return frozenset({"TECH"})

        async def detail(client, config, key, discipline):
            started.add(key.workorder_id)
            try:
                await asyncio.sleep(10)
            finally:
                drained.add(key.workorder_id)

        @asynccontextmanager
        async def factory():
            try:
                yield object()
            finally:
                assert drained == started
                assert len(started) == 4

        monkeypatch.setattr(batches, "checked_settings", checked)
        monkeypatch.setattr(batches, "read_pics", pics)
        monkeypatch.setattr(batches, "read_detail", detail)
        app.state.maximo_client_factory = factory
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://test.example"
        ) as client:
            response = await client.post(
                "/api/draft-batches/prepare",
                json={
                    "connection_id": str(uuid4()),
                    "discipline": "MECH",
                    "items": [{"site_id": "TEST", "workorder_id": str(i)} for i in range(8)],
                },
            )
        assert response.status_code == 504
        assert response.headers["Cache-Control"] == "no-store"
        assert drained == started

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


def test_only_read_and_local_draft_routes_have_deadlines():
    bounded = [
        route.path
        for router in (maximo_routes.router, routes.router, batches.router)
        for route in router.routes
        if isinstance(route, ReadDraftDeadlineRoute)
    ]
    assert "/api/work-orders" in bounded
    assert "/api/work-orders/detail" in bounded
    assert "/api/drafts" in bounded
    assert "/api/draft-batches/prepare" in bounded
    assert not any(isinstance(route, ReadDraftDeadlineRoute) for route in upload_router.routes)
    assert all(
        path.startswith(("/api/work-orders", "/api/drafts", "/api/draft-batches"))
        for path in bounded
    )


def test_normal_upstream_read_error_is_still_502(monkeypatch):
    async def scenario():
        app = create_app(settings(read_draft_request_timeout_seconds=1))

        async def unavailable(*args, **kwargs):
            raise MaximoReadError("Maximo retrieval timed out")

        monkeypatch.setattr(routes, "retrieve_snapshot", unavailable)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://test.example"
        ) as client:
            response = await client.get(
                "/api/work-orders/detail",
                params={
                    "connection_id": str(uuid4()),
                    "site_id": "TEST",
                    "workorder_id": "100",
                    "discipline": "MECH",
                },
            )
        assert response.status_code == 502
        assert response.json() == {"detail": "Maximo retrieval timed out"}
        assert response.headers["Cache-Control"] == "no-store"

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
