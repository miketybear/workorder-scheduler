import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError
from route_fakes import (
    HOST,
    MAXAUTH,
    OPTION,
    PASSWORD,
    ROOT,
    SECRETS,
    FakeMaximo,
    MemoryLedger,
    good_process,
    make_ctx,
    route_config,
)
from test_maximo import config

from app.config import Settings, WorkflowRouteSettings
from app.maximo.reader import MaximoReadError
from app.maximo.sender import NativeTestTransport
from app.scheduling.drafts import WorkOrderKey
from app.scheduling.upload_service import WriteRejected
from app.workflow_route import service
from app.workflow_route.contract import contract_problem, expected_option_offered
from app.workflow_route.credentials import (
    CredentialStore,
    LoginLimiter,
    RouteCredential,
    SecretString,
)
from app.workflow_route.ledger import Attempt
from app.workflow_route.maximo import (
    Assignment,
    RouteOrder,
    UnsafeLink,
    assignment_href_pattern,
    location_pattern,
    read_process,
    rewrite_link,
)
from app.workflow_route.routes import route_enabled


def run(coroutine):
    return asyncio.run(coroutine)


def route_once(fake, ctx=None, **kwargs):
    ctx = ctx or make_ctx(fake, **kwargs)
    result = run(service.route_one(ctx, uuid.uuid4(), ctx.key("TEST", "100")))
    return ctx, result


def assert_no_secrets(*values):
    text = "\n".join(repr(value) for value in values)
    for secret in SECRETS:
        assert secret not in text


# ---------------------------------------------------------------- configuration and gate


def test_route_block_defaults_to_verified_contract_and_is_test_only(monkeypatch):
    identity = uuid.uuid4()
    base = {
        "collection_url": f"{ROOT}/oslc/os/BDSCHED_WO",
        "api_key": "synthetic-test-key",
        "open_statuses": ["APPR"],
    }
    monkeypatch.setenv("WOS_ENVIRONMENT", "test")
    monkeypatch.setenv("WOS_DATABASE_URL", "postgresql+psycopg://u:p@localhost/db")
    monkeypatch.setenv("WOS_MAXIMO", json.dumps({str(identity): base}))
    route = Settings(_env_file=None).maximo[identity].workflow_route
    assert (route.process, route.revision, route.assignment_node) == ("BD_WO", None, 34)
    assert route.nodes == {20: 427, 40: 437}
    assert route.option_text == "Route to Tech PIC for execution"
    assert route.object_structure == "MXAPIWFASSIGNMENT"
    monkeypatch.setenv("WOS_ENVIRONMENT", "staging")
    monkeypatch.setenv(
        f"WOS_MAXIMO__{identity}__WORKFLOW_ROUTE_ACCOUNTS",
        '{"E&I": {"personid": "ENISUP", "api_key": "synthetic-route-key"}}',
    )
    with pytest.raises(ValidationError):  # accounts (and so the route) are test-only
        Settings(_env_file=None)


@pytest.mark.parametrize(
    "block",
    [
        {"revision": 0},
        {"revision": None, "object_structure": "BDWF_ASGN"},
        {"revision": 27, "object_structure": "BDWF_ASGN"},
        {"revision": 27, "nodes": {"20": 0}},
        {"revision": 27, "unknown": 1},
        {"revision": 27, "process": "bd wo"},
    ],
)
def test_route_block_rejects_unsafe_values(block):
    with pytest.raises(ValidationError):
        WorkflowRouteSettings(**block)


@pytest.mark.parametrize(
    "field,value",
    [
        (None, True),
        ("environment", "production"),
        ("system", "offshore"),
        ("enabled", False),
        ("app_environment", "staging"),
        ("app_environment", "production"),
        ("no_accounts", None),
        ("no_contract", None),
        ("wo_collection", None),
    ],
)
def test_route_enabled_mirrors_write_gate(field, value):
    identity = uuid.uuid4()
    connection = SimpleNamespace(id=identity, system="onshore", environment="test", enabled=True)
    config_ = route_config()
    app = SimpleNamespace(environment="development", maximo={identity: config_})
    if field == "app_environment":
        app.environment = value
    elif field == "no_accounts":
        config_.workflow_route_accounts = {}
    elif field == "no_contract":
        config_.conditional_write_contract = None
    elif field == "wo_collection":
        config_.collection_url = f"{ROOT}/oslc/os/oslcmxwodetail"
    elif field:
        setattr(connection, field, value)
    assert route_enabled(app, connection) is (field is None)


# ---------------------------------------------------------------- credentials


def test_credentials_are_dropped_on_logout_expiry_and_scope_change():
    now = datetime(2026, 10, 23, tzinfo=UTC)
    clock = [now]
    store = CredentialStore(clock=lambda: clock[0])
    user, connection = uuid.uuid4(), uuid.uuid4()

    def credential(minutes):
        return RouteCredential(SecretString("x"), "ENISUP", user, now + timedelta(minutes=minutes))

    store.put("s1", connection, "E&I", credential(30))
    assert store.get("s1", connection, "E&I")
    assert store.get("s1", connection, "MECH") is None
    assert store.get("s2", connection, "E&I") is None
    store.put("s1", connection, "MECH", credential(30))  # discipline change replaces
    assert store.get("s1", connection, "E&I") is None and len(store) == 1
    store.drop_session("s1")
    assert len(store) == 0
    store.put("s1", connection, "E&I", credential(5))
    clock[0] = now + timedelta(minutes=6)
    assert store.get("s1", connection, "E&I") is None and len(store) == 0


def test_secret_string_never_prints_or_pickles():
    import pickle

    secret = SecretString(PASSWORD)
    assert PASSWORD not in repr(secret) and PASSWORD not in str(secret)
    assert PASSWORD not in repr(RouteCredential(secret, "ENISUP", uuid.uuid4(), datetime.now(UTC)))
    with pytest.raises(TypeError):
        pickle.dumps(secret)


def test_login_limits_are_per_user_and_per_shared_account():
    clock = [0.0]
    limiter = LoginLimiter(clock=lambda: clock[0])
    user, other = uuid.uuid4(), uuid.uuid4()
    account = (uuid.uuid4(), "ENISUP")
    assert [limiter.reserve(user, account) for _ in range(3)] == [None] * 3
    assert limiter.reserve(user, account) >= 1  # 3 per 5 minutes per user
    clock[0] = 301
    assert limiter.reserve(user, account) is None
    limiter.release(user, account)  # a success does not consume budget
    assert limiter.remaining(user) == 3
    shared = LoginLimiter(clock=lambda: clock[0])
    clock[0] = 1000
    assert [shared.reserve(uuid.uuid4(), account) for _ in range(10)] == [None] * 10
    assert shared.reserve(other, account) is not None  # 10 per hour per position account
    assert shared.reserve(other, (account[0], "MECHSUP")) is None  # another account is separate
    clock[0] = 1000 + 3601
    assert shared.reserve(other, account) is None


# ---------------------------------------------------------------- links


def test_links_are_rewritten_onto_the_configured_host_or_refused():
    cfg, route = route_config(), WorkflowRouteSettings(revision=27)
    href = assignment_href_pattern(route)
    assert (
        rewrite_link("https://alias.invalid:9443/maximo/oslc/os/MXAPIWFASSIGNMENT/_A9", cfg, href)
        == f"{ROOT}/oslc/os/MXAPIWFASSIGNMENT/_A9"
    )
    assert rewrite_link("/maximo/oslc/os/mxapiwfassignment/_A9", cfg, href).startswith(ROOT)
    assert rewrite_link(f"{ROOT}/oslc/wf/mxapiwfassignment_77", cfg, location_pattern(route))
    for bad in (
        "https://evil.invalid/maximo/oslc/os/mxapiwfassignment/_A9",
        "https://user:pw@maximo.invalid/maximo/oslc/os/mxapiwfassignment/_A9",
        f"{ROOT}/oslc/os/mxapiwfassignment/_A9?apikey=x",
        f"{ROOT}/oslc/os/mxapiwfassignment/_A9#frag",
        f"{ROOT}/oslc/os/mxapiwfassignment/../x",
        f"{ROOT}/oslc/os/bdsched_wo/_A9",
        f"{ROOT}/oslc/wf/mxapiwfassignment_77",  # location where an href is expected
        "http://maximo.invalid/maximo/oslc/os/mxapiwfassignment/_A9",
        "\\\\evil/oslc/os/mxapiwfassignment/_A9",
        "mxapiwfassignment/_A9",
        None,
        "",
    ):
        with pytest.raises(UnsafeLink):
            rewrite_link(bad, cfg, href)


# ---------------------------------------------------------------- preview reason codes


def mutate_order(**values):
    return lambda fake, ctx: fake.wo.update(values)


def mutate_assignments(update):
    return lambda fake, ctx: update(fake.assignments)


def unsynced(fake, ctx):
    ctx.ledger.unsynced_keys.add((ctx.connection_id, "TEST", "100"))


def contract_changed(fake, ctx):
    async def verdict():
        return "node_34_condition_present", None

    ctx.contract = verdict


@pytest.mark.parametrize(
    "mutation,expected",
    [
        (mutate_order(bdpocdiscipline="MECH"), "out_of_scope"),
        (unsynced, "not_synced"),
        (mutate_order(supname=None, wonum="PM-100"), "supervisor_missing"),
        (mutate_order(parent="99"), "is_child"),
        (mutate_order(istask=True), "is_child"),
        (mutate_order(status="CLOSE"), "status_not_routable"),
        (mutate_order(status="WAPPR"), "status_not_routable"),
        (mutate_order(schedstart=None), "missing_schedule"),
        (mutate_order(schedfinish=None), "missing_schedule"),
        (mutate_order(assignedto=None), "missing_assignee"),
        (mutate_order(assigneddate=None), "missing_assignee"),
        (mutate_assignments(lambda rows: rows.clear()), "no_workflow"),
        (
            mutate_assignments(lambda rows: rows[0].update(assigncode="OTHER")),
            "no_active_assignment",
        ),
        (mutate_assignments(lambda rows: rows[0].update(processrev=26)), "no_active_assignment"),
        (mutate_assignments(lambda rows: rows[0].update(nodeid=9)), "no_active_assignment"),
        (mutate_assignments(lambda rows: rows[0].update(processname="SR")), "no_workflow"),
        (
            mutate_assignments(lambda rows: rows.append({**rows[0], "wfassignmentid": "901"})),
            "multiple_assignments",
        ),
        (
            mutate_assignments(
                lambda rows: rows.append({**rows[0], "wfassignmentid": "902", "nodeid": 34})
            ),
            "already_routed",
        ),
        (contract_changed, "contract_changed"),
        (lambda fake, ctx: None, "ready"),
    ],
)
def test_every_preview_reason_code(mutation, expected):
    fake = FakeMaximo()
    ctx = make_ctx(fake, planner="outsider")
    mutation(fake, ctx)
    evaluation = run(service.evaluate(ctx, ctx.key("TEST", "100")))
    assert evaluation.code == expected
    assert not fake.writes and not fake.of("whoami")
    assert all("maxauth" not in call.headers for call in fake.calls)


@pytest.mark.parametrize(
    "has_draft,has_upload,expected",
    [(True, False, "not_synced"), (False, True, "upload_pending"), (True, True, "upload_pending")],
)
def test_unsent_draft_and_unresolved_upload_block_preview_and_route(
    has_draft, has_upload, expected
):
    fake = FakeMaximo()
    ctx = make_ctx(fake)
    key = ctx.key("TEST", "100")
    identity = (key.connection_id, key.site_id, key.workorder_id)
    if has_draft:
        ctx.ledger.unsynced_keys.add(identity)
    if has_upload:
        ctx.ledger.upload_pending_keys.add(identity)
    assert run(service.evaluate(ctx, key)).code == expected
    result = run(service.route_one(ctx, uuid.uuid4(), key))
    assert (result.state, result.code) == ("rejected", expected)
    assert ctx.ledger.rows[0].error_code == expected
    assert fake.writes == []


def test_nonexistent_and_out_of_scope_work_orders_are_indistinguishable():
    fake = FakeMaximo()
    ctx = make_ctx(fake)
    fake.wo["bdpocdiscipline"] = "MECH"
    moved = run(service.evaluate(ctx, ctx.key("TEST", "100")))
    missing = run(service.evaluate(ctx, ctx.key("TEST", "555")))
    assert (moved.code, moved.order, moved.assignment) == (missing.code, None, None)


def test_preview_names_the_supervisor_it_would_set_and_never_overwrites():
    fake = FakeMaximo()
    fake.wo["supname"] = None
    ctx = make_ctx(fake, planner="PlAnNeR1")
    evaluation = run(service.evaluate(ctx, ctx.key("TEST", "100")))
    assert (evaluation.code, evaluation.supname) == ("ready", "PLANNER1")
    fake.wo["supname"] = "SUP1"
    ctx = make_ctx(fake, planner="planner1")
    assert run(service.evaluate(ctx, ctx.key("TEST", "100"))).supname is None


# ---------------------------------------------------------------- successful route and audit


def test_route_confirms_and_the_audit_row_exists_before_the_first_write():
    fake = FakeMaximo()
    ledger, seen = MemoryLedger(), []

    async def before_complete():
        seen.append(
            [
                (r.state, r.node_id, r.wfassignment_id_before, r.chosen_action_id)
                for r in ledger.rows
            ]
        )

    fake.on_complete = before_complete
    ctx, result = route_once(fake, ledger=ledger)
    assert (result.state, result.code) == ("confirmed", None)
    assert (result.wfassignment_id_after, result.assigncode_after) == ("901", "TECH1")
    assert seen == [[("sending", 40, "900", 437)]]
    row = ledger.rows[0]
    assert (row.state, row.wonum, row.process, row.revision) == ("confirmed", "PM-100", "BD_WO", 27)
    assert row.actor_user_id == ctx.actor_id and row.discipline == "E&I"
    assert [fake.kind(call) for call in fake.writes] == ["complete", "choose"]


def test_credentials_headers_and_bodies_go_only_where_they_belong():
    fake = FakeMaximo()
    fake.location = "https://alias.invalid:9443/maximo/oslc/wf/mxapiwfassignment_77"
    fake.href = "https://alias.invalid:9443/maximo/oslc/os/mxapiwfassignment/_A900"
    ctx, result = route_once(fake)
    assert result.state == "confirmed"
    assert {call.host for call in fake.calls} == {HOST}
    complete, choose = fake.of("complete")[0], fake.of("choose")[0]
    assert complete.path == "/maximo/oslc/os/mxapiwfassignment/_A900"
    assert complete.query == {"action": ["wsmethod:completeAssignment"]}
    assert complete.headers["x-method-override"] == "PATCH"
    assert choose.path == "/maximo/oslc/wf/mxapiwfassignment_77"
    assert "x-method-override" not in choose.headers
    memo = "Route by Pat Planner via Work Order Scheduler"
    assert json.loads(complete.body) == {"memo": memo, "accepted": True}
    assert json.loads(choose.body) == {"actionid": 437, "memo": memo}
    for call in fake.calls:
        mutation = fake.kind(call) in {"complete", "choose"}
        assert ("maxauth" in call.headers) == mutation
        assert ("apikey" in call.headers) == (not mutation and fake.kind(call) != "whoami")
    # Reads of the position account's work use its own key; everything else the integration key.
    position = [c for c in fake.of("read") if c.path.endswith("/mxapiwfassignment")]
    assert position and all(c.headers["apikey"] == "synthetic-route-key" for c in position)
    assert_no_secrets(result, ctx.ledger.rows)


def test_each_work_order_uses_its_own_cookie_jar():
    fake, clients = FakeMaximo(), []
    original = fake.client

    def tracking():
        client = original()
        clients.append(client)
        return client

    ctx = make_ctx(fake)
    ctx.client_factory = tracking
    run(service.route_one(ctx, uuid.uuid4(), ctx.key("TEST", "100")))
    assert len({id(client) for client in clients}) == len(clients) > 3
    assert len({id(client.cookies.jar) for client in clients}) == len(clients)


def test_batch_is_sequential_and_reports_each_work_order():
    fake = FakeMaximo()
    ctx = make_ctx(fake)
    keys = [ctx.key("TEST", "100"), ctx.key("TEST", "101")]
    results = run(service.execute(ctx, uuid.uuid4(), keys))
    assert [(r.workorder_id, r.state, r.code) for r in results] == [
        ("100", "confirmed", None),
        ("101", "rejected", "out_of_scope"),
    ]


# ---------------------------------------------------------------- audit, locks, idempotency


def test_audit_failure_means_no_maximo_write():
    fake, ledger = FakeMaximo(), MemoryLedger()
    ledger.fail_insert = True
    _, result = route_once(fake, ledger=ledger)
    assert (result.state, result.code) == ("failed", "audit_unavailable")
    assert fake.writes == []


def test_rejected_attempts_are_audited_without_calling_maximo_writes():
    fake = FakeMaximo()
    fake.wo["status"] = "CLOSE"
    ledger = MemoryLedger()
    _, result = route_once(fake, ledger=ledger)
    assert (result.state, result.code) == ("rejected", "status_not_routable")
    assert [(r.state, r.error_code) for r in ledger.rows] == [("rejected", "status_not_routable")]
    assert fake.writes == []


def test_active_attempt_blocks_the_same_work_order_without_any_write():
    fake, ledger = FakeMaximo(), MemoryLedger()
    ctx = make_ctx(fake, ledger=ledger)
    run(
        ledger.reserve(
            request_id=uuid.uuid4(),
            actor_user_id=uuid.uuid4(),
            connection_id=ctx.connection_id,
            site_id="TEST",
            workorder_id="100",
            discipline="E&I",
            process="BD_WO",
            revision=27,
        )
    )
    result = run(service.route_one(ctx, uuid.uuid4(), ctx.key("TEST", "100")))
    assert (result.state, result.code) == ("rejected", "route_in_progress")
    assert fake.writes == []


def test_concurrent_routes_of_one_work_order_send_exactly_once():
    fake, ledger = FakeMaximo(), MemoryLedger()

    async def pause():
        await asyncio.sleep(0.05)

    fake.on_complete = pause

    async def scenario():
        first, second = make_ctx(fake, ledger=ledger), make_ctx(fake, ledger=ledger)
        second.connection_id = first.connection_id
        return await asyncio.gather(
            service.route_one(first, uuid.uuid4(), first.key("TEST", "100")),
            service.route_one(second, uuid.uuid4(), first.key("TEST", "100")),
        )

    results = run(scenario())
    assert sorted((r.state, r.code) for r in results) == [
        ("confirmed", None),
        ("rejected", "route_in_progress"),
    ]
    assert len(fake.of("complete")) == len(fake.of("choose")) == 1


def test_a_finished_attempt_releases_the_work_order_lock():
    fake, ledger = FakeMaximo(), MemoryLedger()
    fake.complete_status = 500
    ctx, first = route_once(fake, ledger=ledger)
    assert first.state == "failed"
    fake.complete_status = 200
    result = run(service.route_one(ctx, uuid.uuid4(), ctx.key("TEST", "100")))
    assert result.state == "confirmed"


# ---------------------------------------------------------------- failure classification


def test_complete_failure_leaves_the_work_order_untouched_and_failed():
    fake = FakeMaximo()
    fake.complete_status = 500
    ctx, result = route_once(fake)
    assert (result.state, result.code) == ("failed", "complete_rejected")
    assert fake.of("choose") == []
    assert ctx.ledger.rows[0].evidence["complete_reason"] == "BMXAA1649E"
    assert fake.active()[0]["wfassignmentid"] == "900"


@pytest.mark.parametrize(
    "options",
    [
        [{"actionid": 437, "instruction": "Modify Plan"}],
        [{"actionid": 999, "instruction": OPTION}],
        [{"actionid": 437, "instruction": OPTION.lower()}],
        [{"actionid": 437, "instruction": OPTION}, {"actionid": 438, "instruction": OPTION}],
        [],
    ],
)
def test_missing_or_mismatched_option_stops_before_choosing(options):
    fake = FakeMaximo()
    fake.options = options
    _, result = route_once(fake)
    assert (result.state, result.code) == ("stranded", "option_mismatch")
    assert fake.of("choose") == []


@pytest.mark.parametrize(
    "location",
    [
        None,
        "https://evil.invalid/maximo/oslc/wf/mxapiwfassignment_77",
        f"{ROOT}/oslc/wf/other_77",
        f"{ROOT}/oslc/wf/mxapiwfassignment_77?x=1",
    ],
)
def test_unsafe_choice_location_is_never_requested(location):
    fake = FakeMaximo()
    fake.location = location
    _, result = route_once(fake)
    assert (result.state, result.code) == ("stranded", "choice_location_invalid")
    assert fake.of("choose") == []
    assert {call.host for call in fake.calls} == {HOST}
    assert all(
        MAXAUTH not in str(call.headers.get("maxauth")) or call.host == HOST for call in fake.calls
    )


def test_foreign_assignment_href_is_refused_before_any_credential_is_sent():
    fake = FakeMaximo()
    fake.href = "https://evil.invalid/maximo/oslc/os/mxapiwfassignment/_A900"
    _, result = route_once(fake)
    assert (result.state, result.code) == ("failed", "read_failed")
    assert fake.writes == [] and {call.host for call in fake.calls} == {HOST}


def test_choose_rejection_is_stranded_when_the_assignment_is_gone():
    fake = FakeMaximo()
    fake.choose_status = 400
    _, result = route_once(fake)
    assert (result.state, result.code) == ("stranded", "choose_rejected")
    assert len(fake.of("choose")) == 1


def test_choose_rejection_is_confirmed_when_readback_proves_it_applied():
    fake = FakeMaximo()
    fake.choose_status, fake.applies_anyway = 500, True
    _, result = route_once(fake)
    assert (result.state, result.code) == ("confirmed", None)
    assert len(fake.of("choose")) == 1


def test_choose_succeeding_without_a_new_assignment_is_stranded():
    fake = FakeMaximo()
    fake.creates_assignment = False  # the &APPNAME& failure mode
    _, result = route_once(fake)
    assert (result.state, result.code) == ("stranded", "stranded_no_assignment")


@pytest.mark.parametrize("phase", ["complete", "choose"])
def test_timeout_is_unknown_and_never_resent(phase):
    fake = FakeMaximo()
    setattr(fake, f"{phase}_error", httpx.ReadTimeout("slow"))
    ctx, result = route_once(fake)
    assert (result.state, result.code) == ("unknown", f"{phase}_unconfirmed")
    assert len(fake.of(phase)) == 1
    assert len(fake.of("choose")) == (1 if phase == "choose" else 0)
    assert ctx.ledger.rows[0].state == "unknown"


def test_timeout_that_readback_proves_applied_is_confirmed():
    fake = FakeMaximo()
    fake.choose_error, fake.applies_anyway = httpx.ReadTimeout("slow"), True
    _, result = route_once(fake)
    assert result.state == "confirmed" and len(fake.of("choose")) == 1


def test_unreadable_readback_is_unknown_not_a_guess():
    fake = FakeMaximo()
    fake.read_error_after_choose = True
    _, result = route_once(fake)
    assert (result.state, result.code) == ("unknown", "readback_unavailable")


def test_maximo_rejecting_maxauth_drops_the_session_and_stops_the_batch():
    fake = FakeMaximo()
    fake.complete_status = 401
    ctx = make_ctx(fake)
    keys = [ctx.key("TEST", "100"), ctx.key("TEST", "101")]
    results = run(service.execute(ctx, uuid.uuid4(), keys))
    assert [(r.state, r.code) for r in results] == [
        ("failed", "route_session_expired"),
        ("not_attempted", "route_session_expired"),
    ]
    assert ctx.dropped == [1]


def test_stranded_work_order_stops_the_rest_of_the_batch():
    fake = FakeMaximo()
    fake.creates_assignment = False
    ctx = make_ctx(fake)
    keys = [ctx.key("TEST", "100"), ctx.key("TEST", "101")]
    results = run(service.execute(ctx, uuid.uuid4(), keys))
    assert [r.state for r in results] == ["stranded", "not_attempted"]


def test_missing_credential_blocks_routing():
    fake = FakeMaximo()
    ctx, result = route_once(fake, credential=False)
    assert (result.state, result.code) == ("failed", "route_session_required")
    assert fake.writes == []


@pytest.mark.parametrize(
    "assignments,before,expected",
    [
        ([("901", 34, "TECH1")], "900", "confirmed"),
        ([("901", 34, "OTHER")], "900", "unknown"),
        ([("901", 34, "TECH1"), ("902", 34, "TECH1")], "900", "unknown"),
        ([("900", 40, "ENISUP")], "900", "failed"),
        ([("777", 40, "ENISUP")], "900", "unknown"),
        ([("900", 40, "ENISUP"), ("901", 34, "TECH1")], "900", "unknown"),
        ([], "900", "stranded"),
    ],
)
def test_readback_classification(assignments, before, expected):
    route = WorkflowRouteSettings(revision=27)
    order = RouteOrder(
        "TEST", "100", "W", "E&I", "PM", "SCHED", None, False, True,
        "TECH1", True, "SUP1", None,
        None,
        tuple(Assignment(i, "BD_WO", 27, n, "ACTIVE", code) for i, n, code in assignments),
    )  # fmt: skip
    assert service.classify(order, route, before, "TECH1").state == expected
    assert service.classify(None, route, before, "TECH1").state == "unknown"


def test_unknown_attempts_are_reconciled_by_reading_only():
    fake = FakeMaximo()
    ledger = MemoryLedger()
    ctx = make_ctx(fake, ledger=ledger)
    fake.assignments[0]["assignstatus"] = "COMPLETE"
    fake.assignments.append(
        {
            "wfassignmentid": "901",
            "processname": "BD_WO",
            "processrev": 27,
            "nodeid": 34,
            "assignstatus": "ACTIVE",
            "assigncode": "TECH1",
        }
    )
    attempt = run(
        ledger.insert(
            state="unknown",
            request_id=uuid.uuid4(),
            actor_user_id=ctx.actor_id,
            connection_id=ctx.connection_id,
            site_id="TEST",
            workorder_id="100",
            discipline="E&I",
            process="BD_WO",
            revision=27,
            wfassignment_id_before="900",
        )
    )
    ledger.rows[0].evidence = {"assignedto": "TECH1"}
    attempt.evidence = {"assignedto": "TECH1"}
    run(service.reconcile(ctx, [attempt]))
    assert (ledger.rows[0].state, ledger.rows[0].assigncode_after) == ("confirmed", "TECH1")
    assert fake.writes == []


def test_abandoned_pending_attempt_is_released_by_reconcile():
    fake, ledger = FakeMaximo(), MemoryLedger()
    ctx = make_ctx(fake, ledger=ledger)
    attempt = run(
        ledger.reserve(
            request_id=uuid.uuid4(),
            actor_user_id=ctx.actor_id,
            connection_id=ctx.connection_id,
            site_id="TEST",
            workorder_id="100",
            discipline="E&I",
            process="BD_WO",
            revision=27,
        )
    )
    attempt.updated_at = datetime.now(UTC) - timedelta(minutes=10)
    run(service.reconcile(ctx, [attempt]))
    assert (ledger.rows[0].state, ledger.rows[0].error_code) == ("failed", "abandoned_pending")


# ---------------------------------------------------------------- SUPNAME


def test_empty_supname_is_set_to_the_planner_before_routing():
    fake = FakeMaximo()
    fake.wo["supname"] = None
    ledger, states = MemoryLedger(), []

    async def before_complete():
        states.append(ledger.rows[0].state)

    fake.on_complete = before_complete
    ctx, result = route_once(fake, ledger=ledger, planner="planner1")
    assert result.state == "confirmed" and fake.wo["supname"] == "PLANNER1"
    assert [fake.kind(call) for call in fake.writes] == ["supname", "complete", "choose"]
    assert json.loads(fake.of("supname")[0].body) == {"supname": "PLANNER1", "_rowstamp": "100"}
    assert states == ["sending"]
    assert ledger.rows[0].evidence["supname_written"] == "PLANNER1"


def test_existing_supname_is_never_overwritten():
    fake = FakeMaximo()
    _, result = route_once(fake, planner="planner1")
    assert result.state == "confirmed" and fake.wo["supname"] == "SUP1"
    assert fake.of("supname") == []


def test_empty_supname_and_unmappable_planner_blocks_without_writes():
    fake = FakeMaximo()
    fake.wo["supname"] = None
    ledger = MemoryLedger()
    _, result = route_once(fake, ledger=ledger, planner="outsider")
    assert (result.state, result.code) == ("rejected", "supervisor_missing")
    assert fake.writes == [] and ledger.rows[0].state == "rejected"
    _, result = route_once(FakeMaximo(), planner=None)  # supname present: no mapping needed
    assert result.state == "confirmed"
    unnamed = FakeMaximo()
    unnamed.wo["supname"] = None
    assert route_once(unnamed, planner=None)[1].code == "supervisor_missing"


@pytest.mark.parametrize(
    "setup,code",
    [
        (lambda fake: setattr(fake, "supname_status", 400), "supname_write_rejected"),
        (lambda fake: setattr(fake, "supname_status", 500), "supname_write_unknown"),
        (lambda fake: setattr(fake, "supname_conflict", True), "supname_conflict"),
        (lambda fake: fake.wo.update(worktype="TASK"), "supname_unwritable"),
    ],
)
def test_failed_supname_write_blocks_routing(setup, code):
    fake = FakeMaximo()
    fake.wo["supname"] = None
    setup(fake)
    _, result = route_once(fake, planner="planner1")
    assert (result.state, result.code) == ("failed", code)
    assert fake.of("complete") == [] and fake.of("choose") == []
    assert fake.active()[0]["wfassignmentid"] == "900"


def test_supname_transport_accepts_nothing_but_a_supname():
    fake = FakeMaximo()

    async def scenario():
        async with fake.client() as client:
            transport = NativeTestTransport(None, uuid.uuid4(), uuid.uuid4(), "E&I", client)

            async def authorize():
                return route_config()

            transport.authorize = authorize
            for args in (
                ("_V0Mx", "100", "lowercase"),
                ("_V0Mx", "100", "SUP;1"),
                ("_V0Mx", "0", "SUP1"),
                ("../x", "100", "SUP1"),
            ):
                transport.attempt_id = uuid.uuid4()
                with pytest.raises(WriteRejected):
                    await transport.write_supname(*args)
            transport.attempt_id = None
            with pytest.raises(WriteRejected):
                await transport.write_supname("_V0Mx", "100", "SUP1")
            transport.attempt_id = uuid.uuid4()
            with pytest.raises(WriteRejected):  # the general sender still refuses it
                await transport.write(
                    WorkOrderKey(uuid.uuid4(), "TEST", "100"), "100", {"supname": "SUP1"}
                )

    run(scenario())
    assert fake.writes == []


# ---------------------------------------------------------------- contract


def test_good_process_matches_the_contract():
    assert contract_problem([good_process()], WorkflowRouteSettings(revision=27)) is None


def edit_process(edit):
    process = good_process()
    edit(process)
    return process


@pytest.mark.parametrize(
    "edit,problem",
    [
        (lambda p: p.update(active=False), "process_revision_inactive"),
        (lambda p: p.update(processrev=28), "process_revision_not_found"),
        (
            lambda p: p["wfnode"][2]["wfassignment"][0].update(condition=":&APPNAME&='PLUSGWO'"),
            "node_34_condition_present",
        ),
        (
            lambda p: p["wfnode"][2].update(wfassignment=[{"roleid": "OTHER"}]),
            "node_34_role_changed",
        ),
        (lambda p: p["wfnode"][2].pop("wfassignment"), "node_34_role_changed"),
        (lambda p: p["wfnode"].pop(2), "node_34_missing"),
        (lambda p: p["wfnode"].pop(0), "node_20_missing"),
        (
            lambda p: p["wfnode"][3]["wfaction"][0].update(instruction="Route elsewhere"),
            "node_20_option_changed",
        ),
        (lambda p: p["wfnode"][4]["wfaction"][0].update(actionid=438), "node_40_option_changed"),
        (lambda p: p["wfnode"][3].pop("wfaction"), "node_20_option_changed"),
        (lambda p: p.pop("wfnode"), "node_20_missing"),
    ],
)
def test_contract_check_locks_on_any_drift(edit, problem):
    process = edit_process(edit)
    assert contract_problem([process], WorkflowRouteSettings(revision=27)) == problem
    assert contract_problem([], WorkflowRouteSettings(revision=27)) == "process_revision_not_found"


def test_contract_cache_is_short_and_does_not_cache_unreadable_results():
    clock, loads = [0.0], []
    cache = service.ContractCache(ttl=60, clock=lambda: clock[0])

    async def loader():
        loads.append(1)
        return None, 27

    async def broken():
        raise MaximoReadError("down")

    async def scenario():
        key = ("c", "BD_WO", 27)
        assert await cache.problem(key, loader) == (None, 27)
        assert await cache.problem(key, loader) == (None, 27)
        clock[0] = 61
        assert await cache.problem(key, loader) == (None, 27)
        assert await cache.problem(("c", "BD_WO", 28), loader) == (None, 27)
        assert await cache.problem(("d", "BD_WO", 27), broken) == ("process_unreadable", None)
        assert await cache.problem(("d", "BD_WO", 27), loader) == (None, 27)

    run(scenario())
    assert len(loads) == 4


def test_process_definition_is_read_with_the_integration_key_only():
    fake = FakeMaximo()

    async def scenario():
        async with fake.client() as client:
            return await read_process(client, route_config(), WorkflowRouteSettings(revision=27))

    records = run(scenario())
    assert contract_problem(records, WorkflowRouteSettings(revision=27)) is None
    call = fake.calls[0]
    assert call.headers["apikey"] == "synthetic-test-key" and "maxauth" not in call.headers
    assert call.query["oslc.where"] == ['processname="BD_WO" and processrev=27']


def test_option_check_requires_exactly_one_named_option_with_the_expected_id():
    route = WorkflowRouteSettings(revision=27)
    ok = {"a": [{"actionid": 437, "instruction": OPTION}, {"actionid": 1, "instruction": "x"}]}
    assert expected_option_offered(ok, route, 437)
    assert not expected_option_offered(ok, route, 427)
    assert not expected_option_offered(None, route, 437)
    assert not expected_option_offered({"actionid": "437"}, route, 437)


# ---------------------------------------------------------------- secrets


def test_secrets_never_appear_in_logs_audit_rows_or_results(caplog):
    caplog.set_level(logging.DEBUG)
    outcomes = []
    for setup in (
        lambda fake: None,
        lambda fake: setattr(fake, "complete_status", 500),
        lambda fake: setattr(fake, "choose_error", httpx.ReadTimeout("slow")),
        lambda fake: setattr(fake, "creates_assignment", False),
        lambda fake: setattr(fake, "complete_status", 401),
    ):
        fake = FakeMaximo()
        setup(fake)
        ctx, result = route_once(fake)
        outcomes.append((result, ctx.ledger.rows, ctx.credential, fake.calls[0].body))
    assert_no_secrets(outcomes[:3], outcomes[3:])
    for secret in SECRETS:
        assert secret not in caplog.text
    # Only the maxauth-bearing requests carry it, and never in a URL or body.
    for call in fake.calls:
        assert MAXAUTH not in call.path and MAXAUTH not in str(call.query)
        assert MAXAUTH not in (call.body or "") and PASSWORD not in (call.body or "")


def test_internal_errors_are_recorded_without_exception_text(caplog):
    caplog.set_level(logging.DEBUG)
    fake = FakeMaximo()
    ledger = MemoryLedger()
    original = ledger.update

    async def explode(attempt_id, allowed_from, **fields):
        if fields.get("state") == "confirmed":
            raise RuntimeError(f"boom {PASSWORD}")
        return await original(attempt_id, allowed_from, **fields)

    ledger.update = explode
    ctx = make_ctx(fake, ledger=ledger)
    results = run(service.execute(ctx, uuid.uuid4(), [ctx.key("TEST", "100")]))
    assert results[0].state == "unknown" and results[0].code == "internal_error"
    assert PASSWORD not in caplog.text
    assert len(fake.of("choose")) == 1


def test_attempt_dataclass_has_no_credential_fields():
    assert not {"maxauth", "password", "apikey"} & set(Attempt.__dataclass_fields__)


def test_workflow_route_settings_module_is_wired_for_the_default_config():
    assert config(workflow_route={"revision": 27}).workflow_route.revision == 27


def process_rev(revision, active=True):
    return {**good_process(), "processrev": revision, "active": active}


def test_unconfigured_revision_resolves_the_single_active_revision_each_time():
    fake = FakeMaximo()
    fake.process = process_rev(27)
    ctx = make_ctx(fake)
    assert run(ctx.contract()) == (None, 27)
    # A newly activated revision is picked up without any configuration change.
    fake.process = process_rev(27, active=False)
    fake.extra_processes = [process_rev(28)]
    assert run(ctx.contract()) == (None, 28)
    row = run(service.route_one(ctx, uuid.uuid4(), ctx.key("TEST", "100")))
    # Work still waiting in the older revision is not routable.
    assert (row.state, row.code) == ("rejected", "no_active_assignment")
    assert ctx.ledger.rows[0].revision == 28
    fake.assignments[0]["processrev"] = 28
    _, result = route_once(fake, ctx=ctx)
    assert result.state == "confirmed" and ctx.ledger.rows[-1].revision == 28


@pytest.mark.parametrize(
    "processes,problem",
    [
        ([process_rev(27), process_rev(28)], "process_revision_ambiguous"),
        ([process_rev(27, active=False)], "process_revision_not_found"),
        ([{"processname": "OTHER"}], "process_revision_not_found"),
    ],
)
def test_ambiguous_or_missing_active_revision_fails_closed(processes, problem):
    fake = FakeMaximo()
    fake.process, *fake.extra_processes = processes
    ctx = make_ctx(fake)
    assert run(ctx.contract()) == (problem, None)
    _, result = route_once(fake, ctx=ctx)
    assert (result.state, result.code) == ("rejected", "contract_changed")
    assert fake.writes == []
    assert ctx.ledger.rows[0].revision == 0


def test_a_pinned_revision_is_still_honoured():
    fake = FakeMaximo()
    fake.process = process_rev(27)
    fake.extra_processes = [process_rev(28)]
    pinned = make_ctx(fake, revision=27)
    assert run(pinned.contract()) == (None, 27)
    assert "processrev=27" in fake.calls[-1].query["oslc.where"][0]
    other = make_ctx(fake, revision=26)
    assert run(other.contract()) == ("process_revision_not_found", None)


def test_route_never_writes_assignedto_and_needs_it_with_its_date():
    fake = FakeMaximo()
    fake.wo.update(assignedto=None, assigneddate=None)
    _, result = route_once(fake)
    assert (result.state, result.code) == ("rejected", "missing_assignee")
    assert fake.writes == []
    fake = FakeMaximo()
    fake.wo["assigneddate"] = None  # a PIC without its date is still not routable
    assert route_once(fake)[1].code == "missing_assignee"
    fake = FakeMaximo()
    _, result = route_once(fake)
    assert result.state == "confirmed" and result.assigncode_after == "TECH1"
    assert [fake.kind(call) for call in fake.writes] == ["complete", "choose"]
    assert all('"assignedto"' not in (call.body or "") for call in fake.writes)


def test_supname_is_the_only_field_written_before_the_route():
    fake = FakeMaximo()
    fake.wo["supname"] = None
    _, result = route_once(fake)
    assert result.state == "confirmed"
    assert [fake.kind(call) for call in fake.writes] == ["supname", "complete", "choose"]
