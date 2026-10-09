"""Operator-only, audited conditional-write experiment on an explicitly typed TEST WO.

This is deliberately not an API or the production sender. One active UploadItem
reserves the WO for the entire experiment, including a deliberate pair of remote
same-token attempts. Every POST has its own committed intent under that reservation.
"""

import asyncio
import json
import re
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from uuid import uuid4

import httpx
from sqlalchemy import select

from app.audit.uploads import record_transition
from app.db.models import AuditEvent, LoginSession, MaximoConnection, UploadBatch, UploadItem, User
from app.maximo.contract_probe import (
    authorize_probe,
    etag_evidence,
    probe_contract,
    validate_probe_worktype,
)
from app.maximo.person import read_person_discipline
from app.maximo.reader import MaximoReadError
from app.scheduling.drafts import WorkOrderKey, require_scope
from app.scheduling.routes import digest


def usable_token(evidence, token_source="advertised_etag"):
    if token_source in {"rowstamp_candidate", "rowstamp_body_candidate"}:
        if not evidence.rowstamp_candidate:
            raise MaximoReadError("Exact resource has no bounded numeric rowstamp candidate")
        return evidence.rowstamp_candidate
    if evidence.resource_etag_status not in {"strong", "numeric_candidate"}:
        raise MaximoReadError("No usable advertised conditional token")
    return evidence.resource_etag


def duration_value(value):
    if value is None or isinstance(value, bool):
        raise MaximoReadError("Numeric duration required")
    try:
        duration = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise MaximoReadError("Invalid numeric duration") from None
    if not duration.is_finite() or not 0 <= duration <= 100000:
        raise MaximoReadError("Duration outside bounded probe range")
    # JSON numbers are required; whole-hour probe increments avoid DURATION scale rounding.
    wire = float(duration)
    if Decimal(str(wire)) != duration:
        raise MaximoReadError("Duration cannot be serialized exactly")
    return wire


def same_except_duration(left, right):
    return left.model_dump(exclude={"estdur"}) == right.model_dump(exclude={"estdur"})


def ibm_reason_code(payload):
    """Only the IBM error identifier; never messages, URLs, fields or response text."""
    try:
        body = json.loads(payload)
    except (ValueError, UnicodeError):
        return None
    error = body.get("Error") if isinstance(body, dict) else None
    reason = error.get("reasonCode") if isinstance(error, dict) else None
    return (
        reason if isinstance(reason, str) and re.fullmatch(r"BMX[A-Z0-9]{3,20}", reason) else None
    )


def ibm_conflict_object(payload):
    """Extract an allowlisted MBO name from 8229; never persist the upstream message."""
    try:
        body = json.loads(payload)
    except (ValueError, UnicodeError):
        return None
    error = body.get("Error") if isinstance(body, dict) else None
    if not isinstance(error, dict) or error.get("reasonCode") != "BMXAA8229W":
        return None
    message = error.get("message")
    if not isinstance(message, str) or len(message) > 8000:
        return None
    matched = re.search(r"\bRecord\s+([A-Z][A-Z0-9_]{0,40})\s*:", message)
    allowed = {
        "WORKORDER",
        "INVRESERVE",
        "WPLABOR",
        "WPMATERIAL",
        "WORKLOG",
        "WOACTIVITY",
        "MATUSETRANS",
        "ASSET",
        "LOCATIONS",
    }
    return matched[1] if matched and matched[1] in allowed else None


class WriteContractProbe:
    def __init__(
        self,
        sessions,
        settings,
        client,
        user_id,
        connection_id,
        discipline,
        site,
        wo,
        token_source="advertised_etag",
        diagnostic_only=False,
        operator_worktype="CM",
        field_mode=False,
    ):
        self.operator_worktype = validate_probe_worktype(operator_worktype)
        self.field_mode = field_mode
        self.field_plan = ()
        if field_mode and token_source != "rowstamp_body_candidate":
            raise MaximoReadError("Field probe requires explicit native body precondition")
        if operator_worktype != "CM" and token_source != "rowstamp_body_candidate":
            raise MaximoReadError("Typed non-CM probe requires explicit native body precondition")
        if token_source not in {"advertised_etag", "rowstamp_candidate", "rowstamp_body_candidate"}:
            raise MaximoReadError("Unsupported explicit probe token source")
        self.token_source = token_source
        self.diagnostic_only = diagnostic_only
        self.sessions, self.settings, self.client = sessions, settings, client
        self.user_id, self.connection_id, self.discipline = user_id, connection_id, discipline
        self.site, self.wo = site, wo
        self.item_id = None
        self.config = None
        self.original = None
        self.trace = []

    def token(self, evidence):
        return usable_token(evidence, self.token_source)

    def conflict(self, status, label):
        if self.token_source != "rowstamp_body_candidate":
            return status == 412
        result = next((entry for entry in reversed(self.trace) if entry["label"] == label), {})
        # HTTP 412 is itself a precondition rejection. Some native JSON errors
        # omit the MBO parameter; known child conflicts still fail closed. A missing
        # MBO is only provisional: current/stale/concurrent proof remains mandatory.
        if result.get("ibm_reason_code") != "BMXAA8229W":
            return False
        mbo = result.get("ibm_conflict_object")
        return (status == 412 and mbo in {None, "WORKORDER"}) or (
            status in {400, 409} and mbo == "WORKORDER"
        )

    async def authorize(self):
        async with self.sessions() as db:
            user = await db.get(User, self.user_id)
            connection = await db.get(MaximoConnection, self.connection_id)
            if not connection or connection.system != "onshore" or connection.environment != "test":
                raise MaximoReadError("Write probe requires designated Onshore test connection")
            if user is None:
                raise MaximoReadError("Authenticated actor unavailable")
            active = await db.scalar(
                select(LoginSession.user_id).where(
                    LoginSession.user_id == self.user_id,
                    LoginSession.expires_at > datetime.now(UTC),
                )
            )
            if active is None:
                raise MaximoReadError("Live verified Entra session required")
            config, authority = await authorize_probe(
                db,
                self.settings,
                self.user_id,
                self.connection_id,
                self.discipline,
                user.tenant_id,
                user.object_id,
            )
            if not authority.explicit_planner:
                raise MaximoReadError("Explicit scoped Planner required")
        if (
            await read_person_discipline(self.client, config, authority.person_id)
            != self.discipline
        ):
            raise MaximoReadError("Current PERSON discipline changed")
        # Recheck DB authority after remote PERSON I/O.
        async with self.sessions() as db:
            current_config, current = await authorize_probe(
                db,
                self.settings,
                self.user_id,
                self.connection_id,
                self.discipline,
                authority.tenant_id,
                authority.object_id,
            )
            if not current.explicit_planner or current_config != config or current != authority:
                raise MaximoReadError("Planner authority changed")
        self.config = config
        return authority

    async def read(self):
        await self.authorize()
        evidence = await probe_contract(
            self.client,
            self.config,
            self.site,
            self.wo,
            self.discipline,
            operator_worktype=self.operator_worktype,
        )
        if self.item_id:
            await self.event("contract_observation", {"evidence": evidence.model_dump(mode="json")})
        return evidence

    async def reserve(self, evidence):
        authority = await self.authorize()
        async with self.sessions.begin() as db:
            await require_scope(
                db,
                self.user_id,
                WorkOrderKey(self.connection_id, self.site, self.wo),
                self.discipline,
                write=True,
            )
            batch = UploadBatch(
                actor_id=self.user_id,
                idempotency_key=uuid4(),
                request_hash=digest({"contract_probe": evidence.model_dump(mode="json")}),
            )
            db.add(batch)
            await db.flush()
            item = UploadItem(
                batch_id=batch.id,
                connection_id=self.connection_id,
                site_id=self.site,
                workorder_id=self.wo,
                wonum=evidence.wonum,
                discipline=self.discipline,
                upstream_revision=self.token(evidence),
                before=evidence.baseline.model_dump(mode="json"),
                changes={"estdur": duration_value(evidence.baseline.estdur + Decimal("1"))},
                state="pending",
            )
            db.add(item)
            await db.flush()  # The unique active-WO index protects this entire experiment.
            self.item_id = item.id
            db.add(
                AuditEvent(
                    upload_item_id=item.id,
                    actor_id=self.user_id,
                    event="contract_probe",
                    details={
                        "authority": authority.model_dump(mode="json"),
                        "source": "active_verified_entra_session",
                        "evidence": evidence.model_dump(mode="json"),
                        "purpose": "test_only_conditional_estdur_and_restore",
                        "token_source": self.token_source,
                        "operator_worktype": self.operator_worktype,
                        "field_mode": self.field_mode,
                        "field_plan": self.field_plan,
                    },
                )
            )
            await record_transition(db, item, self.user_id, "sending")

    async def event(self, name, details):
        async with self.sessions.begin() as db:
            if name == "contract_intent":
                await require_scope(
                    db,
                    self.user_id,
                    WorkOrderKey(self.connection_id, self.site, self.wo),
                    self.discipline,
                    write=True,
                )
                user = await db.get(User, self.user_id)
                _, authority = await authorize_probe(
                    db,
                    self.settings,
                    self.user_id,
                    self.connection_id,
                    self.discipline,
                    user.tenant_id,
                    user.object_id,
                )
                active = await db.scalar(
                    select(LoginSession.user_id).where(
                        LoginSession.user_id == self.user_id,
                        LoginSession.expires_at > datetime.now(UTC),
                    )
                )
                if not authority.explicit_planner or active is None:
                    raise MaximoReadError("Live session or Planner authority changed before intent")
            db.add(
                AuditEvent(
                    upload_item_id=self.item_id, actor_id=self.user_id, event=name, details=details
                )
            )

    async def post(self, evidence, token, value, label):
        return await self.post_fields(evidence, token, {"estdur": duration_value(value)}, label)

    async def post_fields(self, evidence, token, payload, label):
        if (
            evidence.worktype != self.operator_worktype
            or evidence.baseline.worktype != self.operator_worktype
        ):
            raise MaximoReadError("Probe evidence WO type changed")
        if (
            evidence.worktype in {"PM", "CFT"}
            and {"targstartdate", "targcompdate"} & payload.keys()
        ):
            raise MaximoReadError("Target dates cannot be changed for PM or CFT")
        if not payload or set(payload) - {
            "schedstart",
            "schedfinish",
            "assignedtechname",
            "estdur",
            "targstartdate",
            "targcompdate",
        }:
            raise MaximoReadError("Probe mutation outside six-field allowlist")
        if "estdur" in payload:
            if isinstance(payload["estdur"], bool) or not isinstance(
                payload["estdur"], (int, float)
            ):
                raise MaximoReadError("Probe duration must be a JSON number")
            payload = {**payload, "estdur": duration_value(payload["estdur"])}
        if self.field_mode and (label, json.dumps(payload, sort_keys=True)) not in self.field_plan:
            raise MaximoReadError("Field request does not match immutable operator plan")
        if not self.field_mode and set(payload) != {"estdur"}:
            raise MaximoReadError("Duration-mode probe permits duration evidence only")
        await self.authorize()
        status, safe = etag_evidence(httpx.Headers({"ETag": token}))
        if status not in {"strong", "numeric_candidate"} or safe != token:
            raise MaximoReadError("Unsafe conditional token")
        attempt = str(uuid4())
        body_precondition = self.token_source == "rowstamp_body_candidate"
        wire_payload = {**payload, "_rowstamp": token} if body_precondition else payload
        headers = {
            "apikey": self.config.api_key.get_secret_value(),
            "Accept": "application/json",
            "x-method-override": "PATCH",
            "transactionid": attempt,
        }
        if not body_precondition:
            headers["If-Match"] = token
        await self.event(
            "contract_intent",
            {
                "attempt": attempt,
                "label": label,
                "method": "POST",
                "override": "PATCH",
                "if_match": None if body_precondition else token,
                "precondition": {
                    "channel": "json_body" if body_precondition else "http_header",
                    "field": "_rowstamp" if body_precondition else "If-Match",
                    "value": token,
                },
                "token_source": self.token_source,
                "operator_worktype": self.operator_worktype,
                "path": evidence.resource_path,
                "before": evidence.baseline.model_dump(mode="json"),
                "changes": payload,
            },
        )  # Commit before network; an audit failure never sends a mutation.
        try:
            async with self.client.stream(
                "POST",
                self.config.collection_url + "/" + evidence.resource_id,
                params={"lean": "1"},
                json=wire_payload,
                follow_redirects=False,
                timeout=self.config.timeout_seconds,
                headers=headers,
            ) as response:
                code = response.status_code
                # Do not log raw errors, cookies or credentials from upstream.
                returned_etag = etag_evidence(response.headers)
                reason = None
                conflict_object = None
                if 400 <= code < 500:
                    payload_bytes = bytearray()
                    async for chunk in response.aiter_bytes():
                        payload_bytes.extend(chunk)
                        if len(payload_bytes) > 32_000:
                            break
                    if len(payload_bytes) <= 32_000:
                        reason = ibm_reason_code(payload_bytes)
                        conflict_object = ibm_conflict_object(payload_bytes)
        except (httpx.HTTPError, TimeoutError):
            code, returned_etag = None, ("missing", None)
            reason = None
            conflict_object = None
        result = {
            "attempt": attempt,
            "label": label,
            "status": code,
            "response_etag_status": returned_etag[0],
            "response_etag": returned_etag[1],
            "ibm_reason_code": reason,
            "ibm_conflict_object": conflict_object,
        }
        await self.event("contract_result", result)
        self.trace.append(result)
        if code is None or code >= 500 or code not in {200, 204, 400, 401, 403, 404, 409, 412}:
            raise MaximoReadError("Unknown conditional write outcome; no retry or restore")
        return code

    async def attempt(self, evidence, token, value, label):
        current = await self.read()
        if current != evidence:
            raise MaximoReadError("WO changed before conditional attempt")
        await self.authorize()
        return await self.post(evidence, token, value, label)

    async def finish(self, state):
        async with self.sessions.begin() as db:
            item = await db.get(UploadItem, self.item_id, with_for_update=True)
            await record_transition(db, item, self.user_id, state)

    async def restore(self, current, original):
        if not same_except_duration(current.baseline, original.baseline):
            raise MaximoReadError("Unrelated state changed; restore requires reconciliation")
        if await self.attempt(
            current, self.token(current), original.baseline.estdur, "restore"
        ) not in {200, 204}:
            raise MaximoReadError("Conditional restore rejected; no unconditional fallback")
        restored = await self.read()
        if restored.baseline != original.baseline:
            raise MaximoReadError("Original state not restored exactly")
        return restored

    async def run(self):
        original = await self.read()
        if original.baseline.estdur is None:
            raise MaximoReadError(
                "Numeric original duration required; null clear remains unverified"
            )
        initial_token = self.token(original)
        self.original = original
        base = original.baseline.estdur
        await self.reserve(original)
        try:
            # Negative no-op first. A parser400 is unsupported evidence, never
            # proof of conditional protection. Avoid a plausible next rowstamp.
            wrong = (
                (
                    "9223372036854775807"
                    if initial_token != "9223372036854775807"
                    else "9223372036854775806"
                )
                if self.token_source in {"rowstamp_candidate", "rowstamp_body_candidate"}
                or original.resource_etag_status == "numeric_candidate"
                else '"wos-deliberately-stale"'
            )
            wrong_status = await self.attempt(original, wrong, base, "wrong_token")
            after_wrong = await self.read()
            if after_wrong.baseline != original.baseline:
                raise MaximoReadError(
                    "Wrong-token mutation changed WO; conditional enforcement failed"
                )
            if self.diagnostic_only:
                await self.finish("failed")
                return {
                    "verified": False,
                    "reason": "diagnostic_only",
                    "unchanged": True,
                    "trace": self.trace,
                }
            if not self.conflict(wrong_status, "wrong_token"):
                await self.finish("failed")
                return {
                    "verified": False,
                    "reason": "wrong_token_not_conflict",
                    "trace": self.trace,
                }
            if self.token_source in {"rowstamp_candidate", "rowstamp_body_candidate"}:
                support = await self.attempt(
                    after_wrong, self.token(after_wrong), base, "candidate_support_noop"
                )
                supported = await self.read()
                if supported.baseline != original.baseline:
                    raise MaximoReadError("Candidate support no-op changed baseline; reconcile")
                if support not in {200, 204}:
                    await self.finish("failed")
                    return {
                        "verified": False,
                        "reason": "rowstamp_support_rejected",
                        "trace": self.trace,
                    }
                after_wrong = supported
                initial_token = self.token(supported)
            if await self.attempt(
                after_wrong, self.token(after_wrong), base + Decimal("1"), "fresh_token"
            ) not in {200, 204}:
                rejected = await self.read()
                if rejected.baseline != after_wrong.baseline:
                    raise MaximoReadError("Rejected fresh-token request changed WO; reconcile")
                await self.finish("failed")
                return {"verified": False, "reason": "fresh_token_rejected", "trace": self.trace}
            first = await self.read()
            if not same_except_duration(
                first.baseline, original.baseline
            ) or first.baseline.estdur != base + Decimal("1"):
                raise MaximoReadError("Successful response did not read back exact intended state")
            stale_status = await self.attempt(
                first, initial_token, first.baseline.estdur, "stale_token"
            )
            current = await self.read()
            if current.baseline != first.baseline:
                raise MaximoReadError(
                    "Stale token did not reject unchanged; conditional contract failed"
                )
            if not self.conflict(stale_status, "stale_token"):
                restored = await self.restore(current, original)
                await self.event(
                    "contract_readback",
                    {
                        "restored": True,
                        "verified": False,
                        "baseline": restored.baseline.model_dump(mode="json"),
                    },
                )
                await self.finish("failed")
                return {
                    "verified": False,
                    "restored": True,
                    "reason": "stale_token_not_conflict",
                    "trace": self.trace,
                }
            # The one local reservation remains held. These two deliberately concurrent
            # server attempts are a single TEST experiment, not two production jobs.
            token = self.token(current)
            await self.authorize()
            outcomes = await asyncio.gather(
                self.post(current, token, base + Decimal("2"), "same_token_a"),
                self.post(current, token, base + Decimal("3"), "same_token_b"),
                return_exceptions=True,
            )
            if any(isinstance(value, BaseException) for value in outcomes):
                raise MaximoReadError("Concurrent experiment has unknown outcome")
            paired = await self.read()
            expected = (base + Decimal("2"), base + Decimal("3"))
            verified = (
                sum(status in {200, 204} for status in outcomes) == 1
                and sum(
                    self.conflict(status, label)
                    for status, label in zip(
                        outcomes, ("same_token_a", "same_token_b"), strict=True
                    )
                )
                == 1
            )
            if verified:
                successful = next(
                    index for index, status in enumerate(outcomes) if status in {200, 204}
                )
                if paired.baseline.estdur != expected[successful]:
                    raise MaximoReadError("Paired readback does not match successful request")
            if (
                not same_except_duration(paired.baseline, original.baseline)
                or paired.baseline.estdur not in expected
            ):
                raise MaximoReadError("Concurrent readback requires manual reconciliation")
            restored = await self.restore(paired, original)
            await self.event(
                "contract_readback",
                {
                    "restored": True,
                    "verified": verified,
                    "baseline": restored.baseline.model_dump(mode="json"),
                },
            )
            await self.finish("confirmed" if verified else "failed")
            return {"verified": verified, "restored": True, "trace": self.trace}
        except Exception as error:
            # Crash/DB failure leaves a reservation for scoped probe reconciliation.
            await self.event(
                "contract_failure",
                {
                    "reason": str(error)
                    if isinstance(error, MaximoReadError)
                    else type(error).__name__
                },
            )
            await self.finish("unknown")
            raise

    async def reconcile(self, item_id):
        """Remote reads only: release a probe reservation ONLY if original state is exact.

        This separate operator action requires a stopped probe already marked unknown;
        sending is rejected until worker ownership is settled and stale recovery run.
        It never resends/restores. An unrestored WO remains
        reserved unknown with new immutable evidence for deliberate reconciliation.
        """
        await self.authorize()
        async with self.sessions() as db:
            item = await db.scalar(
                select(UploadItem)
                .join(UploadBatch)
                .where(
                    UploadItem.id == item_id,
                    UploadBatch.actor_id == self.user_id,
                    UploadItem.connection_id == self.connection_id,
                    UploadItem.site_id == self.site,
                    UploadItem.workorder_id == self.wo,
                    UploadItem.discipline == self.discipline,
                    UploadItem.state == "unknown",
                )
            )
            probe = await db.scalar(
                select(AuditEvent.id).where(
                    AuditEvent.upload_item_id == item_id,
                    AuditEvent.event == "contract_probe",
                )
            )
            if item is None or probe is None:
                raise MaximoReadError("Active actor-owned contract reservation unavailable")
            before = item.before
        self.item_id = item_id
        current = await self.read()
        restored = current.baseline.model_dump(mode="json") == before
        await self.event(
            "contract_reconcile", {"original_state_exact": restored, "remote_mutations": False}
        )
        if restored:
            async with self.sessions.begin() as db:
                item = await db.get(UploadItem, item_id, with_for_update=True)
                if item.state == "unknown":
                    await record_transition(db, item, self.user_id, "failed", reconciled=True)
        return {
            "original_state_exact": restored,
            "remote_mutations": False,
            "reservation_released": restored,
        }
