"""Mocked Maximo and in-memory ledger for the BD_WO route tests. No network is ever used."""

import asyncio
import base64
import copy
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import parse_qs

import httpx
from test_maximo import config

from app.config import WorkflowRouteSettings
from app.maximo.sender import NativeTestTransport
from app.workflow_route import service
from app.workflow_route.contract import resolve_contract
from app.workflow_route.credentials import RouteCredential, SecretString
from app.workflow_route.ledger import ACTIVE_STATES, Attempt, RequestIdReused, RouteBusy
from app.workflow_route.maximo import read_process

HOST = "maximo.invalid"
ROOT = f"https://{HOST}/maximo"
PASSWORD = "Pa55-word!synthetic"
MAXAUTH = base64.b64encode(f"enisup:{PASSWORD}".encode()).decode()
ROUTE_KEY = "synthetic-route-key"
INTEGRATION_KEY = "synthetic-test-key"
OPTION = "Route to Tech PIC for execution"
SECRETS = (PASSWORD, MAXAUTH, ROUTE_KEY, INTEGRATION_KEY)


def good_process():
    return {
        "processname": "BD_WO",
        "processrev": 27,
        "active": True,
        "wfnode": [
            {"nodeid": 20, "nodetype": "TASK"},
            {"nodeid": 40, "nodetype": "TASK"},
            {
                "nodeid": 34,
                "nodetype": "TASK",
                "wfassignment": [{"roleid": "WO ASS", "condition": None}],
            },
            {
                "nodeid": 101,
                "nodetype": "INPUT",
                "wfaction": [
                    {"actionid": 427, "instruction": OPTION, "ownernodeid": 101},
                    {"actionid": 431, "instruction": "Modify Plan", "ownernodeid": 101},
                ],
            },
            {
                "nodeid": 106,
                "nodetype": "INPUT",
                "wfaction": [{"actionid": 437, "instruction": OPTION, "ownernodeid": 106}],
            },
        ],
    }


@dataclass
class Call:
    method: str
    host: str
    path: str
    query: dict
    headers: dict
    body: object


class FakeMaximo:
    def __init__(self):
        self.calls: list[Call] = []
        self.wo = {
            "siteid": "TEST",
            "workorderid": 100,
            "wonum": "PM-100",
            "bdpocdiscipline": "E&I",
            "worktype": "PM",
            "status": "SCHED",
            "istask": False,
            "parent": None,
            "schedstart": "2026-10-01T08:00:00+07:00",
            "schedfinish": "2026-10-01T10:00:00+07:00",
            "assignedto": "TECH1",
            "assigneddate": "2026-10-01T00:00:00+07:00",
            "supname": "SUP1",
            "href": f"{ROOT}/oslc/os/BDSCHED_WO/_V0Mx",
            "_rowstamp": "100",
        }
        self.assignments = [
            {
                "wfassignmentid": "900",
                "processname": "BD_WO",
                "processrev": 27,
                "nodeid": 40,
                "assignstatus": "ACTIVE",
                "assigncode": "ENISUP",
            }
        ]
        self.process = good_process()
        self.extra_processes: list[dict] = []
        self.supervisors = ["SUP1", "PLANNER1"]
        self.crew = ["TECH1", "TECH2"]
        self.complete_status = 200
        self.choose_status = 200
        self.complete_error: Exception | None = None
        self.choose_error: Exception | None = None
        self.read_error_after_choose = False
        self.chosen = False
        self.options = [
            {"actionid": 437, "instruction": OPTION},
            {"actionid": 431, "instruction": "Modify Plan"},
        ]
        self.href = f"{ROOT}/oslc/os/mxapiwfassignment/_A900"
        self.location = f"{ROOT}/oslc/wf/mxapiwfassignment_77"
        self.creates_assignment = True
        self.supname_status = 204
        self.supname_conflict = False
        self.applies_anyway = False
        self.on_complete = None
        self.password = PASSWORD

    def kind(self, call: Call) -> str:
        if call.path.endswith("/oslc/whoami"):
            return "whoami"
        if call.method == "POST" and "completeAssignment" in str(call.query):
            return "complete"
        if call.method == "POST" and "/oslc/wf/" in call.path:
            return "choose"
        if call.method == "POST":
            return "supname"
        return "read"

    def of(self, *kinds) -> list[Call]:
        return [call for call in self.calls if self.kind(call) in kinds]

    @property
    def writes(self) -> list[Call]:
        return self.of("complete", "choose", "supname")

    def active(self):
        return [a for a in self.assignments if a["assignstatus"] == "ACTIVE"]

    async def handle(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        call = Call(
            request.method,
            url.host,
            url.path,
            parse_qs(url.query.decode()),
            {key.lower(): value for key, value in request.headers.items()},
            request.content.decode() if request.content else None,
        )
        self.calls.append(call)
        if url.host != HOST:
            return httpx.Response(404)
        kind, path = self.kind(call), url.path
        if kind == "whoami":
            if (
                call.headers.get("maxauth")
                == base64.b64encode(f"enisup:{self.password}".encode()).decode()
            ):
                return httpx.Response(200, json={"personid": "ENISUP"})
            return httpx.Response(401, json={"Error": {"reasonCode": "BMXAA9549E"}})
        if kind == "complete":
            return await self.complete(call)
        if kind == "choose":
            return self.choose(call)
        if kind == "supname":
            return self.write_supname(call)
        if path.endswith("/BDSCHED_WO"):
            return self.read_order(call)
        if path.endswith("/mxapiwfassignment"):
            if call.headers.get("apikey") != ROUTE_KEY:
                return httpx.Response(400, json={"Error": {"reasonCode": "BMXAA0024E"}})
            return self.read_position(call)
        if path.endswith("/mxapiwfprocess"):
            return httpx.Response(200, json={"member": [self.process, *self.extra_processes]})
        if path.endswith("/mxpersongroup"):
            group = "ALLSUPN" if "ALLSUPN" in call.query["oslc.where"][0] else "CREW"
            names = self.supervisors if group == "ALLSUPN" else self.crew
            team = [{"respparty": name} for name in names]
            return httpx.Response(
                200, json={"member": [{"persongroup": group, "persongroupteam": team}]}
            )
        return httpx.Response(404)

    def read_order(self, call):
        assert call.headers["apikey"] == INTEGRATION_KEY
        where = call.query["oslc.where"][0]
        if (
            f"workorderid={self.wo['workorderid']}" not in where
            or f'bdpocdiscipline="{self.wo["bdpocdiscipline"]}"' not in where
        ):
            return httpx.Response(200, json={"member": []})
        if self.read_error_after_choose and self.chosen:
            return httpx.Response(500)
        member = {**self.wo, "wfassignment": copy.deepcopy(self.assignments)}
        return httpx.Response(200, json={"member": [member]})

    def read_position(self, call):
        members = [
            {
                **a,
                "ownerid": self.wo["workorderid"],
                "ownertable": "WORKORDER",
                "href": self.href,
            }
            for a in self.active()
            if a["assigncode"] == "ENISUP" and a["processname"] == "BD_WO"
        ]
        return httpx.Response(200, json={"member": members})

    async def complete(self, call):
        assert call.headers.get("x-method-override") == "PATCH"
        assert call.headers.get("maxauth") == MAXAUTH
        assert "apikey" not in call.headers
        if self.on_complete:
            await self.on_complete()
        if self.complete_error:
            raise self.complete_error
        if self.complete_status != 200:
            return httpx.Response(
                self.complete_status, json={"Error": {"reasonCode": "BMXAA1649E"}}
            )
        for a in self.assignments:
            if a["assignstatus"] == "ACTIVE" and a["nodeid"] in (20, 40):
                a["assignstatus"] = "COMPLETE"
        return httpx.Response(
            200,
            json={"actions": self.options},
            headers={"Location": self.location} if self.location else {},
        )

    def choose(self, call):
        assert call.headers.get("maxauth") == MAXAUTH
        failing = self.choose_error or self.choose_status not in (200, 201, 204)
        if failing and not self.applies_anyway:
            if self.choose_error:
                raise self.choose_error
            return httpx.Response(self.choose_status, json={"Error": {"reasonCode": "BMXAA4473E"}})
        self.chosen = True
        if self.creates_assignment:
            self.assignments.append(
                {
                    "wfassignmentid": "901",
                    "processname": "BD_WO",
                    "processrev": 27,
                    "nodeid": 34,
                    "assignstatus": "ACTIVE",
                    "assigncode": self.wo["assignedto"],
                }
            )
        if self.choose_error:
            raise self.choose_error
        return httpx.Response(self.choose_status if failing else 200, json={})

    def write_supname(self, call):
        import json

        body = json.loads(call.body)
        assert set(body) == {"supname", "_rowstamp"}
        assert call.headers.get("apikey") == INTEGRATION_KEY
        if self.supname_conflict or body["_rowstamp"] != self.wo["_rowstamp"]:
            return httpx.Response(
                412, json={"Error": {"reasonCode": "BMXAA8229W", "message": "stale"}}
            )
        if self.supname_status in (200, 204):
            self.wo["supname"] = body["supname"]
            self.wo["_rowstamp"] = str(int(self.wo["_rowstamp"]) + 1)
        return httpx.Response(self.supname_status)

    def client(self):
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handle))


class MemoryLedger:
    """Same contract as PostgresLedger, including both uniqueness rules."""

    def __init__(self):
        self.rows: list[Attempt] = []
        self.unsynced_keys: set[tuple] = set()
        self.fail_insert = False
        self.snapshots: list[list[tuple]] = []

    async def insert(self, **fields):
        if self.fail_insert:
            raise RuntimeError("database unavailable")
        for row in self.rows:
            same_wo = (row.connection_id, row.site_id, row.workorder_id) == (
                fields["connection_id"],
                fields["site_id"],
                fields["workorder_id"],
            )
            if same_wo and row.request_id == fields["request_id"]:
                raise RequestIdReused()
            if same_wo and row.state in ACTIVE_STATES and fields["state"] in ACTIVE_STATES:
                raise RouteBusy()
        now = datetime.now(UTC)
        row = Attempt(id=uuid.uuid4(), evidence={}, created_at=now, updated_at=now, **fields)
        self.rows.append(row)
        return copy.copy(row)

    async def reserve(self, **fields):
        return await self.insert(state="pending", **fields)

    async def reject(self, code, **fields):
        return await self.insert(state="rejected", error_code=code, **fields)

    async def update(self, attempt_id, allowed_from, **fields):
        row = next(row for row in self.rows if row.id == attempt_id)
        if row.state not in allowed_from:
            return False
        for name, value in fields.items():
            setattr(row, name, copy.deepcopy(value))
        row.updated_at = datetime.now(UTC)
        return row.updated_at

    async def for_request(self, actor_user_id, request_id):
        return [
            copy.deepcopy(row)
            for row in self.rows
            if row.actor_user_id == actor_user_id and row.request_id == request_id
        ]

    async def unsynced(self, actor_user_id, connection_id, site_id, workorder_id):
        return (connection_id, site_id, workorder_id) in self.unsynced_keys


class Writer:
    """SUPNAME writer through the real conditional-write transport and the mocked Maximo."""

    def __init__(self, fake, config_, attempt_id, actor_id, connection_id):
        self.fake, self.config, self.attempt_id = fake, config_, attempt_id
        self.actor_id, self.connection_id = actor_id, connection_id

    async def write_supname(self, resource_id, revision, supname):
        async with self.fake.client() as client:
            transport = NativeTestTransport(None, self.actor_id, self.connection_id, "E&I", client)
            transport.attempt_id = self.attempt_id

            async def authorize():
                return self.config

            transport.authorize = authorize
            await transport.write_supname(resource_id, revision, supname)


def route_config(revision=None, **overrides):
    return config(
        collection_url=f"{ROOT}/oslc/os/BDSCHED_WO",
        conditional_write_contract="native_rowstamp_test",
        crew_groups={"E&I": "CREW"},
        workflow_route=WorkflowRouteSettings(**({"revision": revision} if revision else {})),
        workflow_route_accounts={"E&I": {"personid": "ENISUP", "api_key": ROUTE_KEY}},
        paging_origin_aliases=["https://alias.invalid:9443"],
        **overrides,
    )


def make_ctx(
    fake, ledger=None, planner="planner1", contract=None, credential=True, revision=None, **extra
):
    config_ = route_config(revision)
    connection_id, actor_id = uuid.uuid4(), uuid.uuid4()
    ledger = ledger or MemoryLedger()
    authorizations = []

    async def authorize():
        authorizations.append(1)

    async def verdict():
        # The real runtime resolution of the active revision, unless a verdict is forced.
        if contract is not None:
            return contract, None
        async with fake.client() as client:
            records = await read_process(client, config_, config_.workflow_route)
        return resolve_contract(records, config_.workflow_route)

    dropped = []
    ctx = service.RouteContext(
        actor_id=actor_id,
        actor_name="Pat Planner",
        connection_id=connection_id,
        discipline="E&I",
        config=config_,
        route=config_.workflow_route,
        account=config_.workflow_route_accounts["E&I"],
        planner_person=planner,
        ledger=ledger,
        client_factory=fake.client,
        authorize=authorize,
        contract=verdict,
        transport_factory=lambda attempt_id: Writer(
            fake, config_, attempt_id, actor_id, connection_id
        ),
        credential=RouteCredential(
            SecretString(MAXAUTH), "ENISUP", actor_id, datetime(2099, 1, 1, tzinfo=UTC)
        )
        if credential
        else None,
        drop_credential=lambda: dropped.append(1),
        sleep=lambda seconds: asyncio.sleep(0),
        readback_delay=0,
        **extra,
    )
    ctx.authorizations, ctx.dropped = authorizations, dropped
    return ctx
