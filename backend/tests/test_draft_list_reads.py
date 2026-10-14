import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from test_maximo import config

from app.scheduling import draft_list
from app.scheduling.drafts import WorkOrderKey


@pytest.mark.parametrize("mode", ["cancel", "budget"])
def test_page_read_cancels_and_drains_details_before_client_close(monkeypatch, mode):
    async def scenario():
        active = cancelled = 0
        started = asyncio.Event()
        closed = False

        async def pics(*args):
            return frozenset()

        async def detail(*args):
            nonlocal active, cancelled
            active += 1
            if active == 4:
                started.set()
            try:
                await asyncio.sleep(10)
            finally:
                assert not closed
                active -= 1
                cancelled += 1

        class Client(httpx.AsyncClient):
            async def __aexit__(self, *args):
                nonlocal closed
                assert active == 0
                closed = True
                await super().__aexit__(*args)

        monkeypatch.setattr(draft_list, "read_pics", pics)
        monkeypatch.setattr(draft_list, "read_detail", detail)
        request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(maximo_client_factory=Client))
        )
        settings = config()
        if mode == "budget":
            settings = settings.model_copy(update={"retrieval_timeout_seconds": 0.05})
        connection = uuid4()
        task = asyncio.create_task(
            draft_list.fresh_page(
                request,
                settings,
                connection,
                "MECH",
                [WorkOrderKey(connection, "TEST", str(number)) for number in range(20)],
            )
        )
        await started.wait()
        if mode == "cancel":
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            from fastapi import HTTPException

            with pytest.raises(HTTPException) as error:
                await task
            assert error.value.status_code == 503
        assert closed and active == 0 and cancelled == 4

    asyncio.run(scenario())
