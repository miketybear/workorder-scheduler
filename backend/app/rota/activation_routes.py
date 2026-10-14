from collections import defaultdict
from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, text

from app.assignments.capacity import replacement_blockers
from app.auth.person_access import sync_person_access
from app.auth.sessions import SESSION_COOKIE, resolve_session
from app.db.models import AccessGrant
from app.rota.activation import (
    capacity,
    capacity_dict,
    difference,
    materialize,
    proposed_days,
    receipt,
)
from app.rota.models import ResourcePoolState, RotaActivation, RotaImport
from app.rota.parser import CRAFT
from app.rota.routes import audit, authority, import_authority

router = APIRouter(prefix="/api")


class Activate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1, strict=True)
    pool_version: int = Field(ge=0, strict=True)
    confirm_full_replacement: Literal[True]

    @field_validator("confirm_full_replacement", mode="before")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("Explicit full replacement confirmation is required")
        return value


async def pool_lock(db, pool_id, write):
    key = (pool_id.int >> 64) ^ (pool_id.int & ((1 << 64) - 1))
    if key >= 1 << 63:
        key -= 1 << 64
    function = "pg_advisory_xact_lock" if write else "pg_advisory_xact_lock_shared"
    await db.execute(text(f"SELECT {function}(:key)"), {"key": key})


async def locked_stage(db, request, import_id, write=False):
    stage = await db.scalar(
        select(RotaImport)
        .where(RotaImport.id == import_id)
        .with_for_update(read=not write)
        .execution_options(populate_existing=True)
    )
    if not stage:
        await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        raise HTTPException(404, "Rota import not found")
    auth = await import_authority(db, request, stage.pool_id, write)
    # Advisory locks require no UPDATE privilege on protected pool configuration.
    await pool_lock(db, stage.pool_id, write)
    auth = await import_authority(db, request, stage.pool_id, write)
    state = await db.get(ResourcePoolState, stage.pool_id, populate_existing=True)
    return stage, auth, state


@router.get("/rota-imports/{import_id}/activation-preview")
async def activation_preview(request: Request, response: Response, import_id: UUID):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        stage, auth, state = await locked_stage(db, request, import_id)
        proposed, blockers = proposed_days(stage, auth[1])
        before = {}
        if stage.source["coverage_from"] and stage.source["coverage_before"]:
            before = capacity_dict(
                await capacity(
                    db,
                    stage.pool_id,
                    date.fromisoformat(stage.source["coverage_from"]),
                    date.fromisoformat(stage.source["coverage_before"]),
                )
            )
        diff, changes = difference(before, proposed)
        if stage.source["coverage_from"] and stage.source["coverage_before"]:
            blockers.extend(
                await replacement_blockers(
                    db,
                    stage.pool_id,
                    date.fromisoformat(stage.source["coverage_from"]),
                    date.fromisoformat(stage.source["coverage_before"]),
                    proposed,
                )
            )
        revision = await db.scalar(
            select(RotaActivation).where(RotaActivation.import_id == stage.id)
        )
        return {
            "import_id": str(stage.id),
            "pool_id": str(stage.pool_id),
            "import_version": stage.version,
            "pool_version": state.version if state else 0,
            "policy_version": stage.source["policy_version"],
            "coverage_from": stage.source["coverage_from"],
            "coverage_before": stage.source["coverage_before"],
            "can_activate": not blockers,
            "blocking_reasons": blockers,
            "diff": diff,
            "changes": changes,
            "activation_receipt": receipt(revision),
        }


@router.post("/rota-imports/{import_id}/activate")
async def activate(request: Request, response: Response, import_id: UUID, body: Activate):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        stage, auth, state = await locked_stage(db, request, import_id, True)
        revision = await db.scalar(
            select(RotaActivation).where(RotaActivation.import_id == stage.id)
        )
        if revision:
            if (revision.import_version, revision.expected_pool_version) != (
                body.version,
                body.pool_version,
            ):
                raise HTTPException(409, "Activation request does not match the saved receipt")
            return receipt(revision)
        if stage.version != body.version or (state.version if state else 0) != body.pool_version:
            raise HTTPException(
                409, "Import or active pool version changed; reload activation preview"
            )
        proposed, blockers = proposed_days(stage, auth[1])
        if not blockers:
            blockers.extend(
                await replacement_blockers(
                    db,
                    stage.pool_id,
                    date.fromisoformat(stage.source["coverage_from"]),
                    date.fromisoformat(stage.source["coverage_before"]),
                    proposed,
                )
            )
        if blockers:
            raise HTTPException(
                409, {"message": "Rota cannot be activated", "blocking_reasons": blockers}
            )
        if state is None:
            state = ResourcePoolState(pool_id=stage.pool_id, version=0)
            db.add(state)
        revision = await materialize(db, stage, auth[1], state, auth[0], proposed)
        audit(
            db,
            auth[0],
            stage,
            "activate",
            {"activation_id": str(revision.id), "pool_version": state.version},
        )
        await db.commit()
        return receipt(revision)


@router.get("/resource-pools/{pool_id}/active-rota")
async def active_rota(
    request: Request, response: Response, pool_id: UUID, date_from: date, date_before: date
):
    response.headers["Cache-Control"] = "no-store"
    if not 1 <= (date_before - date_from).days <= 366:
        raise HTTPException(422, "Choose a range of 1 to 366 calendar days")
    await sync_person_access(request, request.cookies.get(SESSION_COOKIE))
    async with request.app.state.sessions() as db:
        await authority(db, request, pool_id)
        await pool_lock(db, pool_id, False)
        actor, pool, _, _ = await authority(db, request, pool_id)
        disciplines = set(
            (
                await db.scalars(
                    select(AccessGrant.discipline).where(
                        AccessGrant.user_id == actor.user_id,
                        AccessGrant.connection_id == pool.connection_id,
                        AccessGrant.capability.in_(["read", "write"]),
                    )
                )
            ).all()
        )
        disciplines.intersection_update(CRAFT.values())
        state = await db.get(ResourcePoolState, pool_id)
        rows = await capacity(db, pool_id, date_from, date_before)
        groups = defaultdict(list)
        for row in rows:
            # Keep persisted legacy capacity for replacement diffs, but omit excluded
            # positions from the current roster projection.
            if row.role == "MATERIAL_CONTROLLER" or row.craft not in disciplines:
                continue
            groups[
                row.person_id, row.person_key, row.name, row.craft, row.role, row.laborcode
            ].append(row)
        result = [
            {
                "person_id": str(key[0]),
                "person_key": key[1],
                "name": key[2],
                "craft": key[3],
                "role": key[4],
                "laborcode": key[5],
                "days": [
                    {
                        "date": row.date.isoformat(),
                        "code": row.code,
                        "capacity_hours": float(row.capacity_hours),
                    }
                    for row in sorted(values, key=lambda r: r.date)
                ],
            }
            for key, values in sorted(
                groups.items(), key=lambda item: (item[0][2], str(item[0][0]), item[0][3:])
            )
        ]
        return {
            "pool_id": str(pool_id),
            "pool_version": state.version if state else 0,
            "date_from": date_from.isoformat(),
            "date_before": date_before.isoformat(),
            "rows": result,
            "latest_activation": None,  # A pool receipt contains unscoped workforce totals.
        }
