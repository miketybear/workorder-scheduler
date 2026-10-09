"""Explicit TEST-only six-field contract experiment with exact conditional restores."""

import json
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from app.db.models import AuditEvent, UploadBatch, UploadItem
from app.maximo.contract_probe import ContractEvidence
from app.maximo.detail import read_pics
from app.maximo.reader import MaximoReadError
from app.maximo.write_contract_probe import WriteContractProbe, duration_value
from app.scheduling.changes import ScheduleChanges, WorkOrderBaseline, build_changes


class RestorePreflightRejected(MaximoReadError):
    """Certain 4xx rejection with exact original readback before any positive change."""


def recovery_payload(original, current, pics):
    """Derive exact originals only; PM/CFT target drift is never restored by a write."""
    if current.worktype != original.worktype:
        raise MaximoReadError("Recovery WO type differs from original")
    fields = (
        "schedstart",
        "schedfinish",
        "assignedtechname",
        "estdur",
        "targstartdate",
        "targcompdate",
    )
    changed = {field for field in fields if getattr(current, field) != getattr(original, field)}
    if original.worktype in {"PM", "CFT"} and changed & {"targstartdate", "targcompdate"}:
        raise MaximoReadError("PM/CFT target drift cannot be restored by probe")
    # Maximo may recalculate duration when schedule fields change. Pin the original
    # duration in the same recovery request, and verify the whole baseline afterward.
    if changed & {"schedstart", "schedfinish"}:
        changed.update({"schedstart", "schedfinish", "estdur"})
    if changed & {"targstartdate", "targcompdate"}:
        changed.update({"targstartdate", "targcompdate"})
    result = {}
    for group, intent in (
        ({"schedstart", "schedfinish"}, False),
        ({"assignedtechname"}, False),
        ({"estdur"}, False),
        ({"targstartdate", "targcompdate"}, True),
    ):
        selected = changed & group
        if selected:
            result.update(
                field_payload(
                    current,
                    {field: getattr(original, field) for field in selected},
                    pics,
                    target_intent=intent,
                    original=original,
                )
            )
    return result


def recovery_state(evidence):
    return evidence.model_dump(
        include={
            "resource_path",
            "resource_id",
            "site_id",
            "workorder_id",
            "wonum",
            "orgid",
            "discipline",
            "worktype",
            "status",
            "rowstamp_candidate",
            "baseline",
        }
    )


def field_payload(baseline, values, pics, *, target_intent=False, original=None):
    """Normal validation plus exact TEST original PIC/schedule restoration exceptions."""
    null_fields = {field for field, value in values.items() if value is None}
    if null_fields:
        permitted = set(values) in ({"assignedtechname"}, {"schedstart", "schedfinish"})
        if (
            not permitted
            or original is None
            or any(getattr(original, field) is not None for field in values)
            or any(value is not None for value in values.values())
            or original.worktype != baseline.worktype
        ):
            raise MaximoReadError("Only exact original null PIC or schedule pair may be restored")
        return dict(values)
    if (
        set(values) == {"assignedtechname"}
        and original is not None
        and original.worktype == baseline.worktype
        and values["assignedtechname"] == original.assignedtechname
        and original.assignedtechname is not None
    ):
        # Exact original only, never a new outside-crew assignment. The immutable
        # plan and original-PIC no-op protect this operator restoration exception.
        return dict(values)
    changes = ScheduleChanges.model_validate({**values, "change_target": target_intent})
    build_changes(baseline, changes, set(pics))
    # Include no-op values too: current/null support checks require an outbound request.
    result = changes.model_dump(mode="json", exclude_unset=True, exclude={"change_target"})
    if "estdur" in result:
        result["estdur"] = duration_value(result["estdur"])
        if Decimal(str(result["estdur"])) != changes.estdur:
            raise MaximoReadError("Field duration cannot be serialized exactly")
    return result


class FieldContractProbe(WriteContractProbe):
    def __init__(self, *args, **kwargs):
        if kwargs.get("diagnostic_only", False):
            raise MaximoReadError("Field contract cannot run in diagnostic-only mode")
        super().__init__(*args, token_source="rowstamp_body_candidate", field_mode=True, **kwargs)

    async def crew(self):
        await self.authorize()
        return await read_pics(self.client, self.config, self.discipline)

    async def restore_field_item(self, item_id, *, duration_phase=False):
        """One explicit recovery of an owned stopped field experiment, never a retry."""
        await self.authorize()
        plan_event = "field_duration_recovery_plan" if duration_phase else "field_recovery_plan"
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
            events = list(
                await db.scalars(
                    select(AuditEvent)
                    .where(AuditEvent.upload_item_id == item_id)
                    .order_by(AuditEvent.created_at, AuditEvent.id)
                )
            )
            markers = [event for event in events if event.event == "contract_probe"]
            observations = [event for event in events if event.event == "contract_observation"]
            intents = [event for event in events if event.event == "contract_intent"]
            if item is None or len(markers) != 1 or not observations:
                raise MaximoReadError("Actor-owned stopped field reservation unavailable")
            last_results = [
                event
                for event in events
                if event.event == "contract_result"
                and intents
                and event.details.get("attempt") == intents[-1].details.get("attempt")
            ]
            if (
                len(last_results) != 1
                or last_results[0].details.get("status")
                not in {200, 204, 400, 401, 403, 404, 409, 412}
                or observations[-1].created_at < last_results[0].created_at
                or observations[-1].actor_id != self.user_id
            ):
                raise MaximoReadError(
                    "Recovery requires observed state after a settled remote response"
                )
            marker = markers[0]
            if (
                marker.actor_id != self.user_id
                or marker.details.get("field_mode") is not True
                or marker.details.get("token_source") != "rowstamp_body_candidate"
                or not isinstance(marker.details.get("field_plan"), list)
                or not marker.details["field_plan"]
                or marker.details.get("operator_worktype") != self.operator_worktype
                or any(event.event == plan_event for event in events)
            ):
                raise MaximoReadError("Field recovery provenance invalid or already attempted")
            try:
                original = ContractEvidence.model_validate(marker.details["evidence"])
                observed = ContractEvidence.model_validate(observations[-1].details["evidence"])
                before = WorkOrderBaseline.model_validate(item.before)
            except (KeyError, ValueError):
                raise MaximoReadError("Field recovery audit evidence invalid") from None
            if original.baseline != before:
                raise MaximoReadError("Field recovery original audit does not match reservation")
            if duration_phase:
                first_plans = [event for event in events if event.event == "field_recovery_plan"]
                first_reads = [
                    event for event in events if event.event == "field_recovery_readback"
                ]
                try:
                    eligible = (
                        len(first_plans) == 1
                        and len(first_reads) == 1
                        and intents[-1].details.get("label") == "field_exact_original_restore"
                        and last_results[0].details.get("status") == 204
                        and first_reads[0].details.get("status") == 204
                        and first_plans[0].details.get("source_probe_id") == str(marker.id)
                        and first_plans[0].details.get("original")
                        == original.model_dump(mode="json")
                        and recovery_state(
                            ContractEvidence.model_validate(first_reads[0].details["current"])
                        )
                        == recovery_state(observed)
                        and observed.baseline.model_dump(exclude={"estdur"})
                        == original.baseline.model_dump(exclude={"estdur"})
                        and observed.baseline.estdur != original.baseline.estdur
                    )
                except (KeyError, ValueError):
                    eligible = False
                if not eligible:
                    raise MaximoReadError(
                        "Duration phase requires known 204 recovery with only duration drift"
                    )
        # The loaded last observation is pinned before reads can append fresh evidence.
        self.original = original
        current = await self.read()
        if recovery_state(current) != recovery_state(observed):
            raise MaximoReadError("Current WO differs from last observed recovery state")
        protected_original = recovery_state(original)
        protected_current = recovery_state(current)
        for field in ("baseline", "rowstamp_candidate"):
            protected_original.pop(field)
            protected_current.pop(field)
        if protected_original != protected_current:
            raise MaximoReadError("Field recovery protected WO identity or status changed")
        if (
            original.worktype != self.operator_worktype
            or original.baseline.worktype != self.operator_worktype
        ):
            raise MaximoReadError("Field recovery WO type changed")
        pics = await self.crew()
        payload = (
            {"estdur": duration_value(original.baseline.estdur)}
            if duration_phase
            else recovery_payload(original.baseline, current.baseline, pics)
        )
        if not payload:
            return await self.reconcile(item_id)
        label = (
            "field_original_duration_restore" if duration_phase else "field_exact_original_restore"
        )
        plan = ((label, json.dumps(payload, sort_keys=True)),)
        # Serialize competing recovery invocations; an immutable one-shot plan also
        # blocks an automatic repeat after crash or uncertain network outcome.
        async with self.sessions.begin() as db:
            locked = await db.get(UploadItem, item_id, with_for_update=True)
            prior = await db.scalar(
                select(AuditEvent.id).where(
                    AuditEvent.upload_item_id == item_id, AuditEvent.event == plan_event
                )
            )
            if locked is None or locked.state != "unknown" or prior is not None:
                raise MaximoReadError("Stopped field recovery already claimed")
            db.add(
                AuditEvent(
                    upload_item_id=item_id,
                    actor_id=self.user_id,
                    event=plan_event,
                    details={
                        "source_probe_id": str(marker.id),
                        "last_observation_id": str(observations[-1].id),
                        "operator_worktype": self.operator_worktype,
                        "original": original.model_dump(mode="json"),
                        "current": current.model_dump(mode="json"),
                        "changes": payload,
                        "field_plan": plan,
                        "phase": "duration_only" if duration_phase else "exact_original_fields",
                    },
                )
            )
        self.item_id = item_id
        self.field_plan = plan
        fresh = await self.read()
        if recovery_state(fresh) != recovery_state(current):
            raise MaximoReadError("WO changed before exact original recovery; no send")
        status = await self.post_fields(current, self.token(current), payload, label)
        after = await self.read()
        exact = after.baseline == original.baseline
        await self.event(
            "field_duration_recovery_read" if duration_phase else "field_recovery_readback",
            {
                "status": status,
                "original_state_exact": exact,
                "current": after.model_dump(mode="json"),
            },
        )
        if status not in {200, 204} or not exact:
            raise MaximoReadError(
                "Exact original recovery unconfirmed; reservation remains unknown"
            )
        # Existing scoped read-only reconciliation owns the release decision.
        return {"recovery_status": status, **await self.reconcile(item_id)}

    async def change(self, current, values, label, *, target_intent=False):
        fresh = await self.read()
        if fresh != current:
            raise MaximoReadError("WO changed before field contract attempt")
        pics = await self.crew()
        payload = field_payload(
            current.baseline,
            values,
            pics,
            target_intent=target_intent,
            original=self.original.baseline,
        )
        status = await self.post_fields(current, self.token(current), payload, label)
        after = await self.read()
        expected = WorkOrderBaseline.model_validate({**current.baseline.model_dump(), **values})
        schedule_case = label in {"schedule_dates", "schedule_dates_restore"}
        schedule_exact = schedule_case and after.baseline.model_dump(
            exclude={"estdur"}
        ) == expected.model_dump(exclude={"estdur"})
        if status not in {200, 204}:
            if after.baseline != current.baseline:
                raise MaximoReadError("Rejected field request changed state; reconcile")
            if (
                label
                in {"original_null_pic_noop", "original_pic_noop", "original_null_schedule_noop"}
                and after.baseline == self.original.baseline
            ):
                raise RestorePreflightRejected("Original restoration preflight rejected unchanged")
            raise MaximoReadError("Field request rejected; no blind retry")
        if after.baseline != expected:
            # Fraction precision is measured separately; all other fields require exactness.
            if not schedule_exact and (
                set(values) != {"estdur"}
                or after.baseline.model_dump(exclude={"estdur"})
                != current.baseline.model_dump(exclude={"estdur"})
            ):
                raise MaximoReadError("Field readback mismatched intended state; reconcile")
        await self.event(
            "field_contract_readback",
            {
                "label": label,
                "requested": payload,
                "actual": after.baseline.model_dump(mode="json"),
                "exact": after.baseline == expected,
                "schedule_dates_exact": schedule_exact if schedule_case else None,
                "duration_changed_by_schedule": schedule_case
                and after.baseline.estdur != current.baseline.estdur,
            },
        )
        return after, schedule_exact if schedule_case else after.baseline == expected

    async def plan(self):
        original = await self.read()
        base = original.baseline
        if base.estdur is None:
            raise MaximoReadError("Field probe requires numeric original duration")
        duration_value(base.estdur)
        targets = ("targstartdate", "targcompdate")
        if any(getattr(base, field) is None for field in targets):
            raise MaximoReadError("Field probe requires exact original target dates")
        pics = await self.crew()
        selected = next((pic for pic in sorted(pics) if pic != base.assignedtechname), None)
        if selected is None:
            raise MaximoReadError("No distinct permitted crew PIC")
        offset = timedelta(hours=1, minutes=7, seconds=13)
        schedule = ("schedstart", "schedfinish")
        if all(getattr(base, field) is None for field in schedule):
            start = base.targstartdate + offset
            seconds = base.estdur * Decimal("3600")
            if seconds != seconds.to_integral_value() or seconds <= 0:
                raise MaximoReadError("Null schedule requires positive whole-second duration")
            finish = start + timedelta(seconds=int(seconds))
            dates = {"schedstart": start, "schedfinish": finish}
        elif all(getattr(base, field) is not None for field in schedule):
            dates = {field: getattr(base, field) + offset for field in schedule}
        else:
            raise MaximoReadError("Partially null original schedule cannot be safely restored")
        cases = [
            ("fractional_duration", {"estdur": base.estdur + Decimal("0.25")}, False),
            ("schedule_dates", dates, False),
            ("crew_pic", {"assignedtechname": selected}, False),
        ]
        if self.operator_worktype not in {"PM", "CFT"}:
            cases.append(
                (
                    "cm_target_dates" if self.operator_worktype == "CM" else "allowed_target_dates",
                    {field: getattr(base, field) + offset for field in targets},
                    True,
                )
            )
        # Validate every positive and exact restore before reservation or any POST.
        plan = [
            ("field_wrong_token", {"estdur": duration_value(base.estdur)}),
            ("field_current_noop", {"estdur": duration_value(base.estdur)}),
        ]
        if base.assignedtechname is None:
            plan.append(("original_null_pic_noop", {"assignedtechname": None}))
        elif base.assignedtechname not in pics:
            plan.append(("original_pic_noop", {"assignedtechname": base.assignedtechname}))
        if base.schedstart is None:
            plan.append(("original_null_schedule_noop", {field: None for field in schedule}))
        for label, values, intent in cases:
            payload = field_payload(base, values, pics, target_intent=intent, original=base)
            changed = WorkOrderBaseline.model_validate({**base.model_dump(), **values})
            restores = {field: getattr(base, field) for field in values}
            restore = field_payload(changed, restores, pics, target_intent=intent, original=base)
            plan.extend(((label, payload), (label + "_restore", restore)))
            if label == "schedule_dates":
                plan.append(("schedule_duration_restore", {"estdur": duration_value(base.estdur)}))
        self.field_plan = tuple(
            (label, json.dumps(payload, sort_keys=True)) for label, payload in plan
        )
        return original, cases

    async def run(self):
        if self.diagnostic_only:
            raise MaximoReadError("Field contract cannot run in diagnostic-only mode")
        original, cases = await self.plan()
        self.original = original
        await self.reserve(original)
        try:
            await self.event(
                "field_contract_plan",
                {
                    "operator_worktype": self.operator_worktype,
                    "schedule_duration_restore": {
                        "estdur": duration_value(original.baseline.estdur)
                    },
                    "schedule_duration_semantics": (
                        "Record duration; restore it separately after exact original dates"
                    ),
                    "prohibited_fields": ["targstartdate", "targcompdate"]
                    if self.operator_worktype in {"PM", "CFT"}
                    else [],
                    "cases": [
                        {
                            "label": label,
                            "changes": field_payload(
                                original.baseline,
                                values,
                                await self.crew(),
                                target_intent=intent,
                                original=original.baseline,
                            ),
                            "target_intent": intent,
                        }
                        for label, values, intent in cases
                    ],
                },
            )
            wrong = (
                "9223372036854775807"
                if self.token(original) != "9223372036854775807"
                else "9223372036854775806"
            )
            status = await self.attempt(
                original, wrong, original.baseline.estdur, "field_wrong_token"
            )
            current = await self.read()
            if current.baseline != original.baseline or not self.conflict(
                status, "field_wrong_token"
            ):
                raise MaximoReadError("Field negative no-op did not prove unchanged rejection")
            current, _ = await self.change(
                current, {"estdur": original.baseline.estdur}, "field_current_noop"
            )
            # Establish null acceptance while still null, before setting a PIC that needs clearing.
            if original.baseline.assignedtechname is None:
                current, _ = await self.change(
                    current, {"assignedtechname": None}, "original_null_pic_noop"
                )
            elif any(label == "original_pic_noop" for label, _ in self.field_plan):
                current, _ = await self.change(
                    current,
                    {"assignedtechname": original.baseline.assignedtechname},
                    "original_pic_noop",
                )
            if original.baseline.schedstart is None:
                current, _ = await self.change(
                    current,
                    {"schedstart": None, "schedfinish": None},
                    "original_null_schedule_noop",
                )
            proof = {}
            for label, values, intent in cases:
                current, exact = await self.change(current, values, label, target_intent=intent)
                proof[label] = exact
                restores = {field: getattr(original.baseline, field) for field in values}
                current, restored = await self.change(
                    current, restores, label + "_restore", target_intent=intent
                )
                if label == "schedule_dates":
                    if current.baseline.model_dump(
                        exclude={"estdur"}
                    ) != original.baseline.model_dump(exclude={"estdur"}):
                        raise MaximoReadError("Schedule restore changed unrelated original fields")
                    current, duration_restored = await self.change(
                        current, {"estdur": original.baseline.estdur}, "schedule_duration_restore"
                    )
                    restored = restored and duration_restored
                if not restored or current.baseline != original.baseline:
                    raise MaximoReadError("Field original state not restored exactly")
            await self.event("field_contract_complete", {"proof": proof, "exact_original": True})
            await self.finish("confirmed" if all(proof.values()) else "failed")
            return {
                "verified": all(proof.values()),
                "restored": True,
                "proof": proof,
                "trace": self.trace,
            }
        except Exception as error:
            await self.event(
                "contract_failure",
                {
                    "reason": str(error)
                    if isinstance(error, MaximoReadError)
                    else type(error).__name__
                },
            )
            if isinstance(error, RestorePreflightRejected):
                await self.finish("failed")
                return {
                    "verified": False,
                    "restored": True,
                    "reason": str(error),
                    "trace": self.trace,
                }
            await self.finish("unknown")
            raise
