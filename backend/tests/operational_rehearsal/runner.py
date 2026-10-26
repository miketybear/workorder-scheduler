"""Test-only Linux Uvicorn runner; fake upstream never opens network sockets."""

import asyncio
import json
import re
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import uvicorn
from fastapi import Request
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.sessions import issue_session
from app.config import EntraSettings, MaximoSettings, Settings
from app.db.models import AccessGrant, MaximoConnection, PlannerPermission, User
from app.main import create_app


def validate_data(data, path):
    """Reject arbitrary infrastructure before constructing an engine or application."""
    run_id = data.get("run_id", "")
    if not re.fullmatch(r"[a-f0-9]{32}", run_id) or path.name != f"private-{run_id}.json":
        raise ValueError("Invalid rehearsal identity")
    url = make_url(data["database_url"])
    if (
        (url.drivername, url.host, url.port, url.username, url.database)
        != ("postgresql+psycopg", "pg", 5432, "rehearsal", f"rehearsal_{run_id}")
        or url.query
        or url.password != "synthetic"
    ):
        raise ValueError("Only the owned synthetic rehearsal database is allowed")
    UUID(data["tenant_id"])
    for name, default, low, high in (
        ("shutdown_grace_seconds", 5, 1, 320),
        ("retrieval_timeout_seconds", 120, 1, 300),
    ):
        value = data.get(name, default)
        if type(value) is not int or not low <= value <= high:
            raise ValueError("Invalid synthetic timeout")
        if name == "shutdown_grace_seconds" and value not in {5, 320}:
            raise ValueError("Only baseline or staging grace is supported")
    connections = data["connections"]
    if len(connections) != 2 or [row["system"] for row in connections] != ["onshore", "offshore"]:
        raise ValueError("Invalid synthetic connections")
    identifiers = set()
    for row in connections:
        identifiers.add(UUID(row["id"]))
        if row["host"] != f"{row['system']}.invalid":
            raise ValueError("Only synthetic upstream hosts are allowed")
    if len(identifiers) != 2:
        raise ValueError("Distinct connection identities are required")


def settings(data):
    return Settings(
        _env_file=None,
        environment="test",
        database_url=data["database_url"],
        entra=EntraSettings(
            tenant_id=data["tenant_id"],
            client_id=uuid4(),
            client_secret="synthetic",
            redirect_uri="https://test.invalid/api/auth/callback",
        ),
        maximo={
            UUID(row["id"]): MaximoSettings(
                collection_url=f"https://{row['host']}/maximo/oslc/os/oslcmxwodetail",
                api_key="synthetic",
                retrieval_timeout_seconds=data.get("retrieval_timeout_seconds", 120),
                open_statuses=["APPR"],
                crew_groups={"MECH": "CREW", "E&I": "CREW"},
                person_login_domain="example.invalid",
            )
            for row in data["connections"]
        },
    )


async def seed(data, path):
    engine = create_async_engine(data["database_url"])
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    data["users"] = []
    async with sessions.begin() as db:
        for row in data["connections"]:
            db.add(
                MaximoConnection(
                    id=UUID(row["id"]),
                    system=row["system"],
                    environment="test",
                    label=row["system"],
                    base_url=f"https://{row['host']}/maximo",
                    timezone="Asia/Ho_Chi_Minh",
                    secret_reference="synthetic",
                    enabled=True,
                )
            )
        await db.flush()
        for i in range(10):
            row = data["connections"][i % 2]
            discipline = "MECH" if i % 2 == 0 else "E&I"
            user = User(
                tenant_id=UUID(data["tenant_id"]),
                object_id=uuid4(),
                login_name=f"planner{i}@example.invalid",
                display_name=f"Planner {i}",
            )
            db.add(user)
            await db.flush()
            db.add_all(
                [
                    AccessGrant(
                        user_id=user.id,
                        connection_id=UUID(row["id"]),
                        discipline=discipline,
                        capability="write",
                    ),
                    PlannerPermission(
                        user_id=user.id, connection_id=UUID(row["id"]), discipline=discipline
                    ),
                ]
            )
            token, csrf = await issue_session(db, user)
            data["users"].append(
                dict(
                    id=str(user.id),
                    token=token,
                    csrf=csrf,
                    connection_id=row["id"],
                    discipline=discipline,
                )
            )
            if i == 0:
                token2, csrf2 = await issue_session(db, user)
                data["same_actor_session"] = dict(token=token2, csrf=csrf2)
    await engine.dispose()
    path.write_text(json.dumps(data), encoding="utf-8")


def run(data):
    app = create_app(settings(data))
    state = dict(
        delay=0.005,
        hold=False,
        moved=False,
        active=0,
        peak=0,
        calls=0,
        cancelled=0,
        entered=0,
        response_hold=False,
        response_waiting=0,
    )
    release = asyncio.Event()
    release.set()

    async def upstream(request):
        assert request.method == "GET", "No outbound writes authorized"
        state["calls"] += 1
        where = request.url.params.get("oslc.where", "")
        offshore = request.url.host == "offshore.invalid"
        discipline = "E&I" if offshore else "MECH"
        if request.url.path.endswith("mxperson"):
            person = json.loads(where.split("=", 1)[1])
            person_index = int(person.removeprefix("planner"))
            members = (
                []
                if (person_index % 2 == 1) != offshore
                else [dict(personid=person, ct_discipline=discipline)]
            )
        elif request.url.path.endswith("mxpersongroup"):
            members = [dict(persongroup="CREW", persongroupteam=[dict(respparty="TECH")])]
        else:
            state["active"] += 1
            state["entered"] += 1
            state["peak"] = max(state["peak"], state["active"])
            try:
                await release.wait()
                await asyncio.sleep(state["delay"])
                match = re.search(r"workorderid=(\d+)", where)
                ids = [int(match[1])] if match else range(1000, 1200)
                members = [
                    dict(
                        siteid="TEST",
                        workorderid=i,
                        wonum=f"WO-{i}",
                        description=f"{discipline} synthetic {i}",
                        bdpocdiscipline="OTHER" if state["moved"] else discipline,
                        worktype="CM",
                        status="APPR",
                        istask=False,
                        parent=None,
                        targcompdate="2026-09-30T23:59:59+07:00",
                        estdur=8,
                        assignedto="TECH",
                    )
                    for i in ids
                ]
            except asyncio.CancelledError:
                state["cancelled"] += 1
                raise
            finally:
                state["active"] -= 1
        return httpx.Response(200, json={"member": members})

    original = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(instance):
        async with original(instance):
            instance.state.maximo_client_factory = lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(upstream)
            )
            try:
                yield
            finally:
                if data.get("shutdown_grace_seconds") == 320:
                    Path(f"/evidence/shutdown-state-{data['run_id']}.json").write_text(
                        json.dumps(state), encoding="utf-8"
                    )

    app.router.lifespan_context = lifespan

    @app.middleware("http")
    async def lose_committed_response(request, call_next):
        response = await call_next(request)
        if state["response_hold"] and response.status_code == 201:
            state["response_waiting"] += 1
            try:
                await asyncio.Event().wait()
            finally:
                state["response_waiting"] -= 1
        return response

    @app.post("/__rehearsal/control")
    async def control(request: Request):
        changes = await request.json()
        if "deadline" in changes:
            app.state.settings.read_draft_request_timeout_seconds = changes.pop("deadline")
        state.update(changes)
        if state["hold"]:
            release.clear()
        else:
            release.set()
        return state

    @app.get("/__rehearsal/state")
    async def current():
        return state

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        access_log=False,
        proxy_headers=data.get("shutdown_grace_seconds") != 320,
        timeout_graceful_shutdown=data.get("shutdown_grace_seconds", 5),
        log_level="warning",
    )


if __name__ == "__main__":
    path = Path(sys.argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    validate_data(data, path)
    if len(sys.argv) > 2 and sys.argv[2] == "seed":
        asyncio.run(seed(data, path))
    else:
        run(data)
