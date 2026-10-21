import asyncio
import re
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from test_maximo import config, record
from test_postgres import database, seed

from app.auth.sessions import SESSION_COOKIE, issue_session
from app.config import integration_settings
from app.db.models import Draft, DraftItem, DraftSubmission, MaximoConnection
from app.main import create_app
from app.scheduling.batches import BatchSave, BatchUpdate
from app.scheduling.routes import DraftRequest, DraftUpdate

SINGLE = {
    "connection_id": str(uuid4()),
    "site_id": "TEST",
    "workorder_id": "100",
    "discipline": "MECH",
    "changes": {"estdur": "9"},
    "baseline_token": "a" * 64,
    "request_id": str(uuid4()),
}


def test_rebase_is_accepted_only_on_updates_and_defaults_off():
    with pytest.raises(ValidationError):
        DraftRequest.model_validate({**SINGLE, "rebase": True})
    assert DraftUpdate.model_validate({**SINGLE, "version": 1}).rebase is False
    assert DraftUpdate.model_validate({**SINGLE, "version": 1, "rebase": True}).rebase is True
    with pytest.raises(ValidationError):
        DraftUpdate.model_validate({**SINGLE, "version": 1, "rebase": "maybe"})
    batch = {
        "connection_id": SINGLE["connection_id"],
        "discipline": "MECH",
        "items": [
            {
                "site_id": "TEST",
                "workorder_id": "100",
                "baseline_token": "a" * 64,
                "changes": {"estdur": "9"},
            }
        ],
        "request_id": SINGLE["request_id"],
    }
    with pytest.raises(ValidationError):
        BatchSave.model_validate({**batch, "rebase": True})
    assert BatchUpdate.model_validate({**batch, "version": 1}).rebase is False
    assert BatchUpdate.model_validate({**batch, "version": 1, "rebase": True}).rebase is True


@asynccontextmanager
async def rig():
    async with database() as sessions:
        user, admin, connections = await seed(sessions)
        async with sessions.begin() as db:
            (
                await db.get(MaximoConnection, connections[0].id)
            ).base_url = "https://maximo.invalid/maximo"
            token, csrf = await issue_session(db, user)
            other_token, other_csrf = await issue_session(db, admin)
        settings = integration_settings()
        settings.maximo = {connections[0].id: config(crew_groups={"MECH": "CREW"})}
        app = create_app(settings)
        app.state.sessions = sessions
        world = {"estdur": {"100": 8, "101": 8}, "worktype": "CM"}

        def upstream(request):
            if request.url.path.endswith("/mxpersongroup"):
                return httpx.Response(
                    200,
                    json={
                        "member": [
                            {"persongroup": "CREW", "persongroupteam": [{"respparty": "TECH"}]}
                        ]
                    },
                )
            if request.url.path.endswith("/mxperson"):
                return httpx.Response(
                    200, json={"member": [{"personid": "TECH", "displayname": "Tech"}]}
                )
            identifier = re.search(r"workorderid=(\d+)", request.url.params["oslc.where"]).group(1)
            return httpx.Response(
                200,
                json={
                    "member": [
                        record(
                            workorderid=int(identifier),
                            wonum="WO-" + identifier,
                            bdpocdiscipline="MECH",
                            worktype=world["worktype"],
                            estdur=world["estdur"][identifier],
                        )
                    ]
                },
            )

        app.state.maximo_client_factory = lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(upstream)
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://test.example"
        ) as client:
            client.cookies.set(SESSION_COOKIE, token)
            yield {
                "client": client,
                "sessions": sessions,
                "world": world,
                "connection_id": str(connections[0].id),
                "headers": {"X-CSRF-Token": csrf},
                "other_cookie": other_token,
                "other_csrf": other_csrf,
            }


async def stored(sessions, draft_id):
    async with sessions() as db:
        draft = await db.get(Draft, draft_id)
        items = (
            await db.scalars(
                select(DraftItem).where(DraftItem.draft_id == draft.id).order_by(DraftItem.wonum)
            )
        ).all()
        return draft.version, items


async def other_user_put(r, url, payload):
    # A different signed-in account has no grant for this connection and discipline.
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=r["client"]._transport.app),
        base_url="https://test.example",
        cookies={SESSION_COOKIE: r["other_cookie"]},
    ) as other:
        return await other.put(url, json=payload, headers={"X-CSRF-Token": r["other_csrf"]})


@pytest.mark.integration
def test_single_draft_rebase_lifecycle():
    async def scenario():
        async with rig() as r:
            client, headers, sessions, world = r["client"], r["headers"], r["sessions"], r["world"]
            key = {
                "connection_id": r["connection_id"],
                "site_id": "TEST",
                "workorder_id": "100",
                "discipline": "MECH",
            }

            async def token():
                detail = await client.get("/api/work-orders/detail", params=key)
                return detail.json()["baseline_token"]

            def body(**extra):
                return {**key, "changes": {"estdur": "9"}, "request_id": str(uuid4()), **extra}

            created = await client.post(
                "/api/drafts", json=body(baseline_token=await token()), headers=headers
            )
            assert created.status_code == 201, created.text
            draft_id = created.json()["draft_id"]
            url = "/api/drafts/" + draft_id
            rejected = await client.post(
                "/api/drafts", json=body(baseline_token=await token(), rebase=True), headers=headers
            )
            assert rejected.status_code == 422

            world["estdur"]["100"] = 10
            put = {"baseline_token": await token(), "version": 1, "changes": {"estdur": "11"}}
            plain = await client.put(url, json=body(**put), headers=headers)
            assert plain.status_code == 409
            assert "baseline changed" in plain.json()["detail"]
            explicit = await client.put(url, json=body(**put, rebase=False), headers=headers)
            assert explicit.status_code == 409
            restored = (await client.get(url)).json()["items"][0]
            assert restored["baseline_changed"] is True

            stale = await client.put(
                url, json=body(**{**put, "version": 5}, rebase=True), headers=headers
            )
            assert stale.status_code == 409 and "Draft changed" in stale.json()["detail"]
            wrong = await client.put(
                url, json=body(**{**put, "baseline_token": "0" * 64}, rebase=True), headers=headers
            )
            assert wrong.status_code == 409 and "reload" in wrong.json()["detail"]
            equal = await client.put(
                url, json=body(**{**put, "changes": {"estdur": "10"}}, rebase=True), headers=headers
            )
            assert equal.status_code == 422
            world["worktype"] = "PM"
            pm_changes = {
                "estdur": "11",
                "change_target": True,
                "targcompdate": "2026-10-02T00:00:00+07:00",
            }
            pm = await client.put(
                url,
                json=body(baseline_token=await token(), version=1, changes=pm_changes, rebase=True),
                headers=headers,
            )
            assert pm.status_code == 422
            world["worktype"] = "CM"
            denied = await other_user_put(r, url, body(**put, rebase=True))
            assert denied.status_code in {403, 404}
            version, items = await stored(sessions, draft_id)
            assert version == 1 and items[0].baseline["estdur"] == "8"
            assert items[0].changes == {"estdur": "9"}

            ok_body = body(**put, rebase=True)
            ok = await client.put(url, json=ok_body, headers=headers)
            assert ok.status_code == 200, ok.text
            assert ok.json()["version"] == 2
            assert ok.json()["updated_at"] > created.json()["updated_at"]
            assert len(ok.json()["rebased_from"]) == 1
            version, items = await stored(sessions, draft_id)
            assert version == 2
            assert items[0].baseline["estdur"] == "10" and items[0].changes == {"estdur": "11"}
            assert (await client.put(url, json=ok_body, headers=headers)).json() == ok.json()
            async with sessions() as db:
                assert await db.scalar(select(func.count()).select_from(DraftSubmission)) == 2
            # The same request ID without rebase is a different request.
            changed = await client.put(
                url, json={**ok_body, "rebase": False, "version": 2}, headers=headers
            )
            assert changed.status_code == 409
            restored = (await client.get(url)).json()["items"][0]
            assert restored["baseline_changed"] is False
            assert restored["changes_valid_now"] is True
            assert restored["baseline"]["estdur"] == "10"
            # Rebase against an unchanged baseline is an ordinary save with no refresh marker.
            again = await client.put(
                url,
                json=body(
                    baseline_token=await token(), version=2, changes={"estdur": "12"}, rebase=True
                ),
                headers=headers,
            )
            assert again.status_code == 200 and "rebased_from" not in again.json()

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)


@pytest.mark.integration
def test_batch_draft_rebase_lifecycle():
    async def scenario():
        async with rig() as r:
            client, headers, sessions, world = r["client"], r["headers"], r["sessions"], r["world"]
            scope = {"connection_id": r["connection_id"], "discipline": "MECH"}
            keys = [{"site_id": "TEST", "workorder_id": i} for i in ("100", "101")]

            async def edits(changes):
                prepared = await client.post(
                    "/api/draft-batches/prepare", json={**scope, "items": keys}, headers=headers
                )
                return [
                    {
                        **key,
                        "baseline_token": item["baseline_token"],
                        "changes": changes[key["workorder_id"]],
                    }
                    for key, item in zip(keys, prepared.json()["items"], strict=True)
                ]

            def body(items, **extra):
                return {**scope, "items": items, "request_id": str(uuid4()), **extra}

            same = {"100": {"estdur": "9"}, "101": {"estdur": "9"}}
            created = await client.post(
                "/api/draft-batches", json=body(await edits(same)), headers=headers
            )
            assert created.status_code == 201, created.text
            draft_id = created.json()["draft_id"]
            url = "/api/draft-batches/" + draft_id
            on_create = await client.post(
                "/api/draft-batches", json=body(await edits(same), rebase=True), headers=headers
            )
            assert on_create.status_code == 422

            world["estdur"]["101"] = 10
            moved = {"100": {"estdur": "9"}, "101": {"estdur": "11"}}
            plain = await client.put(url, json=body(await edits(moved), version=1), headers=headers)
            assert plain.status_code == 409 and "baseline changed" in plain.json()["detail"]
            stale = await client.put(
                url, json=body(await edits(moved), version=4, rebase=True), headers=headers
            )
            assert stale.status_code == 409
            # A failure on any item rejects the whole save.
            bad_pic = {"100": {"estdur": "9"}, "101": {"estdur": "11", "assignedtechname": "BAD"}}
            for bad, code in (
                ({"100": {"estdur": "9"}, "101": {"estdur": "10"}}, "empty_changes"),
                (bad_pic, "invalid_changes"),
            ):
                response = await client.put(
                    url, json=body(await edits(bad), version=1, rebase=True), headers=headers
                )
                assert response.status_code == 409
                assert response.json()["detail"]["errors"] == [
                    {"site_id": "TEST", "workorder_id": "101", "code": code}
                ]
            world["worktype"] = "PM"
            pm = {
                "100": {"estdur": "9"},
                "101": {
                    "estdur": "11",
                    "change_target": True,
                    "targcompdate": "2026-10-02T00:00:00+07:00",
                },
            }
            response = await client.put(
                url, json=body(await edits(pm), version=1, rebase=True), headers=headers
            )
            assert response.status_code == 409
            assert {e["code"] for e in response.json()["detail"]["errors"]} == {"invalid_changes"}
            world["worktype"] = "CM"
            denied = await other_user_put(r, url, body(await edits(moved), version=1, rebase=True))
            assert denied.status_code in {403, 404}
            version, items = await stored(sessions, draft_id)
            assert version == 1
            assert [i.baseline["estdur"] for i in items] == ["8", "8"]
            assert [i.changes for i in items] == [{"estdur": "9"}, {"estdur": "9"}]

            ok_body = body(await edits(moved), version=1, rebase=True)
            ok = await client.put(url, json=ok_body, headers=headers)
            assert ok.status_code == 200, ok.text
            assert ok.json()["version"] == 2
            assert [e["workorder_id"] for e in ok.json()["rebased_from"]] == ["101"]
            version, items = await stored(sessions, draft_id)
            assert version == 2
            assert [i.baseline["estdur"] for i in items] == ["8", "10"]
            assert [i.changes["estdur"] for i in items] == ["9", "11"]
            assert (await client.put(url, json=ok_body, headers=headers)).json() == ok.json()
            restored = (await client.get(url)).json()["items"]
            assert [i["baseline_changed"] for i in restored] == [False, False]
            assert [i["changes_valid_now"] for i in restored] == [True, True]
            async with sessions() as db:
                assert await db.scalar(select(func.count()).select_from(Draft)) == 1

    asyncio.run(scenario(), loop_factory=asyncio.SelectorEventLoop)
