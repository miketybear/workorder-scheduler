"""Explicit native JSON rowstamp sender, restricted to verified Onshore TEST configuration."""

import math
import re
from decimal import Decimal

import httpx
from fastapi import HTTPException
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import MaximoConnection, MaximoPersonBinding, PlannerPermission, User
from app.maximo.connections import configured_connection
from app.maximo.contract_probe import OPERATOR_WORKTYPES, probe_contract
from app.maximo.detail import read_detail, read_pics
from app.maximo.person import person_id_from_login, read_person_discipline
from app.maximo.reader import MaximoReadError
from app.maximo.write_contract_probe import ibm_conflict_object, ibm_reason_code
from app.scheduling.changes import ScheduleChanges, build_changes
from app.scheduling.drafts import CurrentWorkOrder, WorkOrderKey, require_scope
from app.scheduling.upload_service import ConditionalConflict, UncertainWrite, WriteRejected


def write_enabled(settings, connection):
    config = settings.maximo.get(connection.id)
    return bool(
        config
        and config.conditional_write_contract == "native_rowstamp_test"
        and settings.environment in {"development", "test"}
        and connection.enabled
        and connection.system == "onshore"
        and connection.environment == "test"
    )


class NativeTestTransport:
    contract = "native_rowstamp_test"

    def __init__(self, request, actor_id, connection_id, discipline, client):
        self.request, self.actor_id, self.connection_id = request, actor_id, connection_id
        self.discipline, self.client = discipline, client
        self.evidence = {}
        self.attempt_id = None
        self.outcome = None

    async def local_authority(self):
        request = self.request
        async with request.app.state.sessions() as db:
            actor = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
            verify_csrf(actor, request.headers.get("X-CSRF-Token"))
            if actor.user_id != self.actor_id:
                raise HTTPException(401, "Sign-in required")
            user = await db.get(User, self.actor_id)
            connection = await db.get(MaximoConnection, self.connection_id)
            if connection is None or not write_enabled(request.app.state.settings, connection):
                raise HTTPException(
                    409, {"code": "write_contract_unverified", "send_enabled": False}
                )
            config = configured_connection(request.app.state.settings, connection)
            key = WorkOrderKey(self.connection_id, "", "")
            await require_scope(db, self.actor_id, key, self.discipline, write=False)
            explicit = await db.scalar(
                select(PlannerPermission.user_id).where(
                    PlannerPermission.user_id == self.actor_id,
                    PlannerPermission.connection_id == self.connection_id,
                    PlannerPermission.discipline == self.discipline,
                )
            )
            binding = await db.get(MaximoPersonBinding, (self.actor_id, self.connection_id))
            entra = request.app.state.settings.entra
            person = (
                person_id_from_login(user.login_name, config.person_login_domain)
                if config.person_login_domain
                else None
            )
            if (
                not explicit
                or not entra
                or user.tenant_id != entra.tenant_id
                or not binding
                or binding.person_id != person
            ):
                raise HTTPException(404, "Work order not found")
        return config, person, user.tenant_id, user.object_id

    async def authorize(self):
        before = await self.local_authority()
        config, person, _, _ = before
        if await read_person_discipline(self.client, config, person) != self.discipline:
            raise HTTPException(404, "Work order not found")
        # PERSON is network I/O. Recheck session, binding, connection and explicit
        # Planner in a fresh DB read after it, without taking a nested user lock.
        if await self.local_authority() != before:
            raise HTTPException(404, "Work order not found")
        return config

    async def read(self, key):
        if key.connection_id != self.connection_id:
            raise HTTPException(404, "Work order not found")
        config = await self.authorize()
        order = await read_detail(self.client, config, key, self.discipline)
        if order is None or order.worktype not in OPERATOR_WORKTYPES:
            raise MaximoReadError("Work order type has no verified application write contract")
        evidence = await probe_contract(
            self.client,
            config,
            key.site_id,
            key.workorder_id,
            self.discipline,
            operator_worktype=order.worktype,
        )
        token = evidence.rowstamp_candidate
        if not token:
            raise MaximoReadError("Exact resource has no verified native rowstamp")
        pics = await read_pics(self.client, config, self.discipline)
        await self.authorize()
        self.evidence[key] = evidence
        return CurrentWorkOrder(
            key, evidence.wonum, self.discipline, token, evidence.baseline, pics
        )

    async def write(self, key, revision, changes):
        self.outcome = None
        try:
            config = await self.authorize()
        except (HTTPException, MaximoReadError):
            raise WriteRejected() from None
        evidence = self.evidence.get(key)
        if (
            evidence is None
            or evidence.worktype not in OPERATOR_WORKTYPES
            or evidence.baseline.worktype != evidence.worktype
            or evidence.rowstamp_candidate != revision
            or not re.fullmatch(r"[1-9][0-9]{0,29}", revision)
        ):
            raise WriteRejected()
        # The service already checks explicit target intent/PIC/PM/CFT against saved
        # proposal. This transport also rejects arbitrary fields and every app clear.
        if not changes or set(changes) - {
            "schedstart",
            "schedfinish",
            "assignedtechname",
            "estdur",
            "targstartdate",
            "targcompdate",
        }:
            raise WriteRejected()
        try:
            proposal = ScheduleChanges.model_validate(
                {
                    **changes,
                    "change_target": bool({"targstartdate", "targcompdate"} & changes.keys()),
                }
            )
            pics = await read_pics(self.client, config, self.discipline)
            build_changes(evidence.baseline, proposal, set(pics))
            payload = proposal.model_dump(
                mode="json", exclude_unset=True, exclude={"change_target"}
            )
            if "estdur" in payload:
                wire_duration = float(proposal.estdur)
                if (
                    not math.isfinite(wire_duration)
                    or Decimal(str(wire_duration)) != proposal.estdur
                ):
                    raise ValueError("Duration cannot be serialized exactly")
                payload["estdur"] = wire_duration
        except (ValueError, MaximoReadError):
            raise WriteRejected() from None
        if self.attempt_id is None:
            raise WriteRejected()
        try:
            await self.authorize()
        except (HTTPException, MaximoReadError):
            raise WriteRejected() from None
        try:
            async with self.client.stream(
                "POST",
                config.collection_url + "/" + evidence.resource_id,
                params={"lean": "1"},
                json={**payload, "_rowstamp": revision},
                headers={
                    "apikey": config.api_key.get_secret_value(),
                    "Accept": "application/json",
                    "x-method-override": "PATCH",
                    "transactionid": str(self.attempt_id),
                },
                follow_redirects=False,
                timeout=config.timeout_seconds,
            ) as response:
                status = response.status_code
                error = bytearray()
                if 400 <= status < 500:
                    async for chunk in response.aiter_bytes():
                        error.extend(chunk)
                        if len(error) > 32000:
                            raise UncertainWrite()
        except httpx.HTTPError:
            raise UncertainWrite() from None
        self.outcome = {
            "transaction_id": str(self.attempt_id),
            "status": status,
            "ibm_reason_code": ibm_reason_code(error),
            "ibm_conflict_object": ibm_conflict_object(error),
        }
        if status in {200, 204}:
            return
        reason, mbo = ibm_reason_code(error), ibm_conflict_object(error)
        if reason == "BMXAA8229W" and (
            (status == 412 and mbo in {None, "WORKORDER"})
            or (status in {400, 409} and mbo == "WORKORDER")
        ):
            raise ConditionalConflict()
        if status in {400, 401, 403, 404}:
            raise WriteRejected()
        raise UncertainWrite()
