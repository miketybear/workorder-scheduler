"""Route preview and execution. No FastAPI types: the routes layer supplies the context."""

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.config import MaximoSettings, WorkflowRouteAccount, WorkflowRouteSettings
from app.maximo.contract_probe import OPERATOR_WORKTYPES
from app.maximo.reader import MaximoReadError
from app.scheduling.drafts import WorkOrderKey
from app.scheduling.upload_service import ConditionalConflict, UncertainWrite, WriteRejected
from app.workflow_route.contract import expected_option_offered, memo_for
from app.workflow_route.credentials import RouteCredential
from app.workflow_route.ledger import Attempt, RequestIdReused, RouteBusy
from app.workflow_route.maximo import (
    RouteOrder,
    RouteTransportError,
    UnsafeLink,
    choose_option,
    complete_assignment,
    location_pattern,
    read_position_assignments,
    read_route_order,
    read_supervisors,
    rewrite_link,
)

logger = logging.getLogger(__name__)
ROUTABLE_STATUSES = frozenset({"APPR", "WSCHED", "SCHED", "WMAT", "WPCOND", "CPLAN", "WMATL"})
READY = "ready"
# Outcomes after which the rest of a batch is not attempted.
STOP_CODES = frozenset({"route_session_expired", "authorization_changed", "internal_error"})
STOP_STATES = frozenset({"stranded", "unknown"})
STALE_AFTER = timedelta(minutes=5)
SUPNAME_PATTERN = re.compile(r"[A-Z0-9_]{1,30}")


@dataclass
class RouteContext:
    actor_id: UUID
    actor_name: str
    connection_id: UUID
    discipline: str
    config: MaximoSettings
    route: WorkflowRouteSettings
    account: WorkflowRouteAccount
    planner_person: str | None
    ledger: Any
    client_factory: Callable[[], Any]
    authorize: Callable[[], Awaitable[None]]
    contract: Callable[[], Awaitable[tuple[str | None, int | None]]]
    transport_factory: Callable[[UUID], Any]
    credential: RouteCredential | None = None
    drop_credential: Callable[[], None] = lambda: None
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    readback_attempts: int = 3
    readback_delay: float = 1.0
    supervisors: frozenset[str] | None = field(default=None, init=False)

    def key(self, site_id: str, workorder_id: str) -> WorkOrderKey:
        return WorkOrderKey(self.connection_id, site_id, workorder_id)


@dataclass
class Evaluation:
    code: str
    order: RouteOrder | None = None
    assignment: Any = None
    supname: str | None = None
    revision: int | None = None


@dataclass
class ItemResult:
    site_id: str
    workorder_id: str
    state: str
    code: str | None = None
    wonum: str | None = None
    attempt_id: UUID | None = None
    wfassignment_id_after: str | None = None
    assigncode_after: str | None = None
    updated_at: datetime | None = None


def result_from(attempt: Attempt) -> ItemResult:
    return ItemResult(
        attempt.site_id,
        attempt.workorder_id,
        attempt.state,
        attempt.error_code,
        attempt.wonum,
        attempt.id,
        attempt.wfassignment_id_after,
        attempt.assigncode_after,
        attempt.updated_at,
    )


def decide_assignment(order: RouteOrder, position, route, account, revision: int) -> str:
    """Pure decision over the WO's BD_WO work (all holders) and the position account's work."""
    active = [a for a in order.assignments if a.status == "ACTIVE" and a.process == route.process]
    if any(a.node == route.assignment_node for a in active):
        return "already_routed"
    if len(active) > 1 or len(position) > 1:
        return "multiple_assignments"
    if not active and not position:
        return "no_workflow"
    if len(active) != 1 or len(position) != 1:
        return "no_active_assignment"
    mine, held = active[0], position[0]
    if (
        mine.id != held.id
        or mine.revision != revision
        or held.revision != revision
        or mine.node not in route.nodes
        or held.node != mine.node
        or (mine.assigncode or "").upper() != account.personid.upper()
    ):
        return "no_active_assignment"
    return READY


async def supervisor_for_planner(ctx: RouteContext) -> str | None:
    """The planner's own member name in the supervisor group, or None when not a member."""
    if not ctx.planner_person:
        return None
    if ctx.supervisors is None:
        async with ctx.client_factory() as client:
            ctx.supervisors = await read_supervisors(client, ctx.config, ctx.route)
    matches = [name for name in ctx.supervisors if name.lower() == ctx.planner_person.lower()]
    if len(matches) != 1 or not SUPNAME_PATTERN.fullmatch(matches[0]):
        return None
    return matches[0]


async def evaluate(ctx: RouteContext, key: WorkOrderKey) -> Evaluation:
    """Every preview rule, read-only. Out-of-scope work orders look like missing ones."""
    async with ctx.client_factory() as client:
        order = await read_route_order(client, ctx.config, key, ctx.discipline)
    if order is None:
        return Evaluation("out_of_scope")
    if await ctx.ledger.unsynced(ctx.actor_id, key.connection_id, key.site_id, key.workorder_id):
        return Evaluation("not_synced", order)
    if order.parent or order.istask:
        return Evaluation("is_child", order)
    if order.status not in ROUTABLE_STATUSES:
        return Evaluation("status_not_routable", order)
    if not order.has_schedule:
        return Evaluation("missing_schedule", order)
    # Maximo fills ASSIGNEDDATE itself when ASSIGNEDTO is set; both must be present.
    if not order.assignedto or not order.has_assigneddate:
        return Evaluation("missing_assignee", order)
    supname = None
    if not order.supname:
        supname = await supervisor_for_planner(ctx)
        if supname is None:
            return Evaluation("supervisor_missing", order)
    problem, revision = await ctx.contract()
    if problem is not None or revision is None:
        return Evaluation("contract_changed", order)
    async with ctx.client_factory() as client:
        position = await read_position_assignments(
            client, ctx.config, ctx.route, ctx.account, key.workorder_id
        )
    code = decide_assignment(order, position, ctx.route, ctx.account, revision)
    if code != READY:
        return Evaluation(code, order)
    return Evaluation(READY, order, position[0], supname, revision)


async def preview(
    ctx: RouteContext, keys: list[WorkOrderKey]
) -> list[tuple[WorkOrderKey, Evaluation]]:
    return [(key, await evaluate(ctx, key)) for key in keys]


@dataclass
class Verdict:
    state: str
    code: str | None = None
    wfassignment_id: str | None = None
    assigncode: str | None = None


def classify(order: RouteOrder | None, route, before_id: str | None, assignedto: str | None):
    """Readback verdict from the WO's current BD_WO work."""
    if order is None:
        return Verdict("unknown", "readback_out_of_scope")
    active = [a for a in order.assignments if a.status == "ACTIVE" and a.process == route.process]
    new = [a for a in active if a.node == route.assignment_node]
    old = [a for a in active if a.node in route.nodes]
    if new:
        match = [a for a in new if (a.assigncode or "").upper() == (assignedto or "").upper()]
        if len(new) == 1 and len(match) == 1 and not old and assignedto:
            return Verdict("confirmed", None, match[0].id, match[0].assigncode)
        return Verdict("unknown", "unexpected_assignment")
    if old:
        if before_id is not None and any(a.id == before_id for a in old):
            return Verdict("failed", "still_at_supervisor_node")
        return Verdict("unknown", "unexpected_assignment")
    return Verdict("stranded", "stranded_no_assignment")


async def read_back(ctx, key, before_id, assignedto) -> Verdict:
    verdict = Verdict("unknown", "readback_unavailable")
    for number in range(max(1, ctx.readback_attempts)):
        if number:
            await ctx.sleep(ctx.readback_delay)
        try:
            async with ctx.client_factory() as client:
                order = await read_route_order(client, ctx.config, key, ctx.discipline)
        except MaximoReadError:
            verdict = Verdict("unknown", "readback_unavailable")
            continue
        verdict = classify(order, ctx.route, before_id, assignedto)
        if verdict.state == "confirmed":
            break
    return verdict


def not_attempted(key: WorkOrderKey, code: str) -> ItemResult:
    return ItemResult(key.site_id, key.workorder_id, "not_attempted", code)


async def finish(ctx, attempt, allowed_from, state, code, evidence, verdict=None) -> ItemResult:
    fields = {"state": state, "error_code": code, "evidence": evidence}
    if verdict is not None and verdict.state == "confirmed":
        fields.update(
            wfassignment_id_after=verdict.wfassignment_id, assigncode_after=verdict.assigncode
        )
    stamp = await ctx.ledger.update(attempt.id, allowed_from, **fields)
    attempt.state, attempt.error_code = state, code
    attempt.wfassignment_id_after = fields.get("wfassignment_id_after")
    attempt.assigncode_after = fields.get("assigncode_after")
    attempt.updated_at = stamp or datetime.now(UTC)
    return result_from(attempt)


async def settle(ctx, attempt, key, evidence, assignedto, code, *, uncertain=False):
    """Classify by reading Maximo back. An uncertain write is confirmed or unknown, never failed."""
    verdict = await read_back(ctx, key, attempt.wfassignment_id_before, assignedto)
    state = verdict.state
    if state == "confirmed":
        code = None
    elif uncertain or (code is None and state == "failed"):
        state = "unknown"
    evidence = {**evidence, "readback": verdict.state, "readback_code": verdict.code}
    return await finish(ctx, attempt, ("sending",), state, code or verdict.code, evidence, verdict)


async def write_supname(ctx, attempt, key, evaluation, evidence):
    """Set an empty SUPNAME before routing. Returns an ItemResult to stop with, else None."""
    order = evaluation.order
    if (
        order.worktype not in OPERATOR_WORKTYPES
        or not order.resource_id
        or not order.rowstamp
        or not evaluation.supname
    ):
        return await finish(ctx, attempt, ("sending",), "failed", "supname_unwritable", evidence)
    transport = ctx.transport_factory(attempt.id)
    try:
        await transport.write_supname(order.resource_id, order.rowstamp, evaluation.supname)
    except ConditionalConflict:
        code = "supname_conflict"
    except UncertainWrite:
        code = "supname_write_unknown"
    except (WriteRejected, HTTPException, MaximoReadError):
        code = "supname_write_rejected"
    else:
        evidence["supname_written"] = evaluation.supname
        return None
    # Routing has not started, so the work order's workflow is untouched.
    return await finish(ctx, attempt, ("sending",), "failed", code, evidence)


async def route_one(ctx: RouteContext, request_id: UUID, key: WorkOrderKey) -> ItemResult:
    identity = {
        "request_id": request_id,
        "actor_user_id": ctx.actor_id,
        "connection_id": ctx.connection_id,
        "site_id": key.site_id,
        "workorder_id": key.workorder_id,
        "discipline": ctx.discipline,
        "process": ctx.route.process,
        "revision": None,
    }
    # The audit row records the revision in force; 0 when the contract check could not resolve one.
    identity["revision"] = (await ctx.contract())[1] or ctx.route.revision or 0
    try:
        first = await evaluate(ctx, key)
    except (MaximoReadError, RouteTransportError):
        return ItemResult(key.site_id, key.workorder_id, "failed", "read_failed")
    if first.code == "out_of_scope":
        return ItemResult(key.site_id, key.workorder_id, "rejected", "out_of_scope")
    wonum = first.order.wonum if first.order else None
    try:
        if first.code != READY:
            rejected = await ctx.ledger.reject(first.code, wonum=wonum, **identity)
            return result_from(rejected)
        attempt = await ctx.ledger.reserve(wonum=wonum, **identity)
    except RouteBusy:
        return ItemResult(key.site_id, key.workorder_id, "rejected", "route_in_progress", wonum)
    except RequestIdReused:
        return ItemResult(key.site_id, key.workorder_id, "rejected", "request_id_conflict", wonum)
    except Exception as error:
        # Without the durable intent nothing may be sent.
        logger.error("workflow route audit unavailable: %s", type(error).__name__)
        return ItemResult(key.site_id, key.workorder_id, "failed", "audit_unavailable", wonum)
    evidence: dict = {}
    try:
        # Hold the per-WO lock while every rule and the actor's authority are checked again.
        second = await evaluate(ctx, key)
        if second.code != READY:
            return await finish(ctx, attempt, ("pending",), "rejected", second.code, evidence)
        await ctx.authorize()
    except HTTPException:
        return await finish(
            ctx, attempt, ("pending",), "rejected", "authorization_changed", evidence
        )
    except (MaximoReadError, RouteTransportError):
        return await finish(ctx, attempt, ("pending",), "failed", "read_failed", evidence)
    except Exception as error:
        logger.error("workflow route failed before sending: %s", type(error).__name__)
        return await finish(ctx, attempt, ("pending",), "failed", "internal_error", evidence)
    order, held = second.order, second.assignment
    action_id = ctx.route.nodes[held.node]
    evidence.update(
        assignedto=order.assignedto,
        supname_planned=second.supname,
        planner_person=ctx.planner_person,
    )
    # The durable intent exists before the first call that can change Maximo.
    await ctx.ledger.update(
        attempt.id,
        ("pending",),
        state="sending",
        node_id=held.node,
        wfassignment_id_before=held.id,
        chosen_action_id=action_id,
        evidence=evidence,
    )
    attempt.state, attempt.wfassignment_id_before = "sending", held.id
    try:
        return await mutate(ctx, attempt, key, second, held, action_id, evidence)
    except Exception as error:
        # A mutation may have been applied; record that honestly and never resend.
        logger.error("workflow route failed while sending: %s", type(error).__name__)
        return await finish(ctx, attempt, ("sending",), "unknown", "internal_error", evidence)


async def mutate(ctx, attempt, key, evaluation, held, action_id, evidence) -> ItemResult:
    credential = ctx.credential
    if credential is None:
        return await finish(
            ctx, attempt, ("sending",), "failed", "route_session_required", evidence
        )
    maxauth, memo = credential.maxauth.reveal(), memo_for(ctx.actor_name)
    order = evaluation.order
    if evaluation.supname:
        stopped = await write_supname(ctx, attempt, key, evaluation, evidence)
        if stopped:
            return stopped
        confirmed = await evaluate(ctx, key)
        if confirmed.code != READY or not confirmed.order.supname:
            evidence["supname_recheck"] = confirmed.code
            return await finish(
                ctx, attempt, ("sending",), "failed", "supname_not_confirmed", evidence
            )
        held, order = confirmed.assignment, confirmed.order
        if held.id != attempt.wfassignment_id_before:
            return await finish(
                ctx, attempt, ("sending",), "failed", "assignment_changed", evidence
            )
    assignedto = order.assignedto

    async def stop(code, *, uncertain=False):
        return await settle(ctx, attempt, key, evidence, assignedto, code, uncertain=uncertain)

    # One client per work order: Maximo keeps the input-node state in this cookie jar.
    async with ctx.client_factory() as client:
        try:
            first = await complete_assignment(client, ctx.config, held.href, maxauth, memo)
        except RouteTransportError:
            evidence["complete"] = "transport_error"
            return await stop("complete_unconfirmed", uncertain=True)
        evidence.update(complete_status=first.status, complete_reason=first.reason)
        if first.status == 401:
            ctx.drop_credential()
            return await stop("route_session_expired")
        if first.status != 200:
            return await stop("complete_rejected")
        try:
            location = rewrite_link(first.location, ctx.config, location_pattern(ctx.route))
        except UnsafeLink:
            return await stop("choice_location_invalid")
        if not expected_option_offered(first.body, ctx.route, action_id):
            return await stop("option_mismatch")
        try:
            second = await choose_option(client, ctx.config, location, maxauth, action_id, memo)
        except RouteTransportError:
            evidence["choose"] = "transport_error"
            return await stop("choose_unconfirmed", uncertain=True)
    evidence.update(choose_status=second.status, choose_reason=second.reason)
    if second.status == 401:
        ctx.drop_credential()
        return await stop("route_session_expired")
    if second.status not in {200, 201, 204}:
        return await stop("choose_rejected")
    return await stop(None)


async def execute(
    ctx: RouteContext, request_id: UUID, keys: list[WorkOrderKey]
) -> list[ItemResult]:
    results: list[ItemResult] = []
    halted: str | None = None
    for key in keys:
        if halted:
            results.append(not_attempted(key, halted))
            continue
        try:
            result = await route_one(ctx, request_id, key)
        except Exception as error:
            logger.error("workflow route bookkeeping failed: %s", type(error).__name__)
            result = ItemResult(key.site_id, key.workorder_id, "unknown", "internal_error")
        results.append(result)
        if result.code in STOP_CODES or result.state in STOP_STATES:
            halted = result.code or "previous_work_order_" + result.state
    return results


async def reconcile(ctx: RouteContext, attempts: list[Attempt]) -> None:
    """Read-only recovery: resolve unknown or abandoned attempts from Maximo's current state."""
    cutoff = datetime.now(UTC) - STALE_AFTER
    for attempt in attempts:
        stale = attempt.updated_at is not None and attempt.updated_at < cutoff
        if attempt.state == "pending" and stale:
            await finish(
                ctx, attempt, ("pending",), "failed", "abandoned_pending", attempt.evidence
            )
        elif attempt.state == "unknown" or (attempt.state == "sending" and stale):
            source = attempt.state
            assignedto = attempt.evidence.get("assignedto")
            verdict = await read_back(
                ctx,
                ctx.key(attempt.site_id, attempt.workorder_id),
                attempt.wfassignment_id_before,
                assignedto,
            )
            state = verdict.state
            # A sending row never completed its own bookkeeping, so only a proven result is final.
            if source == "sending" and state == "failed":
                state = "unknown"
            evidence = {**attempt.evidence, "reconciled": True, "readback": verdict.state}
            code = None if state == "confirmed" else verdict.code
            await finish(ctx, attempt, (source,), state, code, evidence, verdict)


class ContractCache:
    """Short-lived verdict of the BD_WO contract check, per connection and process."""

    def __init__(self, ttl: float = 60.0, clock=time.monotonic):
        self.ttl, self.clock = ttl, clock
        self._items: dict[tuple, tuple[float, tuple[str | None, int | None]]] = {}

    async def problem(self, key: tuple, loader: Callable[[], Awaitable[tuple]]):
        """(problem, revision); re-read after the ttl so a newly activated revision is picked up."""
        now = self.clock()
        cached = self._items.get(key)
        if cached and cached[0] > now:
            return cached[1]
        try:
            problem = await loader()
        except (MaximoReadError, RouteTransportError):
            # Unreadable means unverified; do not cache so the next request retries.
            return "process_unreadable", None
        self._items[key] = (now + self.ttl, problem)
        return problem
