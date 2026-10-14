import asyncio
import re
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE, resolve_session, verify_csrf
from app.db.models import LoginSession, MaximoConnection, PlannerPermission, User
from app.maximo.connections import configured_connection
from app.maximo.labor import read_labor
from app.maximo.reader import MaximoReadError
from app.rota.models import ResourcePool, ResourcePoolGrant, RotaEvent, RotaImport
from app.rota.parser import MAX_UPLOAD, RotaParseError, eligible_rows, parse_rota
from app.rota.preview import eligible_candidates, preview, proposals, summary

router = APIRouter(prefix="/api")


class Version(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1, strict=True)


class Mapping(Version):
    source_row: int = Field(ge=1, le=500, strict=True)
    labor_key: str | None = Field(max_length=500)


async def authority(db, request, pool_id, write=False):
    identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
    if write:
        await db.scalar(
            select(User)
            .where(User.id == identity.user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        await db.scalar(
            select(LoginSession)
            .where(LoginSession.token_hash == identity.token_hash)
            .with_for_update()
        )
        identity = await resolve_session(db, request.cookies.get(SESSION_COOKIE))
    user = await db.get(User, identity.user_id)
    settings = request.app.state.settings
    if not settings.entra or user.tenant_id != settings.entra.tenant_id:
        raise HTTPException(403, "Resource access unavailable")
    result = (
        await db.execute(
            select(ResourcePool, MaximoConnection)
            .join(MaximoConnection, MaximoConnection.id == ResourcePool.connection_id)
            .where(
                ResourcePool.id == pool_id,
                ResourcePool.enabled.is_(True),
                MaximoConnection.enabled.is_(True),
            )
        )
    ).one_or_none()
    if not result:
        raise HTTPException(404, "Resource pool not found")
    pool, connection = result
    planner = await db.scalar(
        select(PlannerPermission.user_id)
        .where(
            PlannerPermission.user_id == identity.user_id,
            PlannerPermission.connection_id == connection.id,
        )
        .limit(1)
    )
    explicit = await db.get(ResourcePoolGrant, (pool.id, identity.user_id))
    capability = "write" if user.is_admin or planner else explicit.capability if explicit else None
    if capability is None or (write and capability != "write"):
        raise HTTPException(404, "Resource pool not found")
    configured_connection(settings, connection)
    if write:
        verify_csrf(identity, request.headers.get("x-csrf-token"))
    return identity, pool, SimpleNamespace(capability=capability), connection


async def import_authority(db, request, pool_id, write=False):
    auth = await authority(db, request, pool_id, write)
    if not auth[0].is_admin:
        raise HTTPException(404, "Rota import not found")
    return auth


async def stage_authority(db, request, import_id, write=False, version=None):
    stage = await db.scalar(
        select(RotaImport).where(RotaImport.id == import_id).with_for_update()
        if write
        else select(RotaImport).where(RotaImport.id == import_id)
    )
    if not stage:
        await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        raise HTTPException(404, "Rota import not found")
    auth = await import_authority(db, request, stage.pool_id, write)
    if version is not None and stage.version != version:
        raise HTTPException(409, "Rota import version changed; reload preview")
    if write and stage.status != "staged":
        raise HTTPException(409, "Cancelled or activated import cannot be modified")
    return stage, auth


def audit(db, identity, stage, event, details=None):
    db.add(
        RotaEvent(
            actor_id=identity.user_id,
            pool_id=stage.pool_id,
            import_id=stage.id,
            event=event,
            details={"version": stage.version, **(details or {})},
        )
    )


async def snapshot(request, connection, orgid):
    config = configured_connection(request.app.state.settings, connection)
    try:
        async with request.app.state.maximo_client_factory() as client:
            labor = await read_labor(client, config, connection.id, orgid)
        return labor, None, datetime.now(UTC)
    except MaximoReadError as error:
        return [], str(error), None


@router.get("/resource-pools")
async def pools(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        await resolve_session(db, request.cookies.get(SESSION_COOKIE))
        ids = (
            await db.scalars(select(ResourcePool.id).where(ResourcePool.enabled.is_(True)))
        ).all()
        items = []
        for pool_id in ids:
            try:
                _, pool, grant, connection = await authority(db, request, pool_id)
            except HTTPException as error:
                if error.status_code == 404:
                    continue
                raise
            items.append(
                {
                    "id": str(pool.id),
                    "label": pool.label,
                    "connection_id": str(connection.id),
                    "connection_label": connection.label,
                    "environment": connection.environment,
                    "orgid": pool.orgid,
                    "timezone": connection.timezone,
                    "capability": grant.capability,
                }
            )
        return {"items": items}


@router.post("/rota-imports")
async def upload(
    request: Request, response: Response, pool_id: UUID, filename: str, sheet: str = "ROTA_2026"
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        await import_authority(db, request, pool_id, True)
    filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    if not re.fullmatch(r"[^\x00-\x1f/\\]{1,200}\.(?:xlsx|ods)", filename, re.I):
        raise HTTPException(422, "Choose an XLSX or ODS file")
    if not 1 <= len(sheet) <= 100:
        raise HTTPException(422, "Invalid sheet name")
    if request.headers.get("content-type", "").split(";")[0] != "application/octet-stream":
        raise HTTPException(415, "Upload spreadsheet bytes as application/octet-stream")
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_UPLOAD:
            raise HTTPException(413, "Upload must be at most 8 MB")
    try:
        source = await asyncio.to_thread(parse_rota, bytes(content), filename, sheet)
    except RotaParseError as error:
        raise HTTPException(422, str(error)) from None
    # Persist source first: interruption or LABOR failure never loses an accepted upload.
    async with request.app.state.sessions() as db:
        identity, pool, _, connection = await import_authority(db, request, pool_id, True)
        stage = RotaImport(
            pool_id=pool.id,
            actor_id=identity.user_id,
            file_name=filename,
            sheet=sheet,
            source=source,
            labor_error="LABOR snapshot pending",
        )
        db.add(stage)
        await db.flush()
        audit(db, identity, stage, "upload")
        await db.commit()
        import_id = stage.id
    fingerprint = (
        connection.id,
        connection.base_url,
        pool.orgid,
        configured_connection(request.app.state.settings, connection).model_copy(deep=True),
    )
    labor, error, at = await snapshot(request, connection, pool.orgid)
    async with request.app.state.sessions() as db:
        stage, auth = await stage_authority(db, request, import_id, True, 1)
        if (
            auth[3].id,
            auth[3].base_url,
            auth[1].orgid,
            configured_connection(request.app.state.settings, auth[3]),
        ) != fingerprint:
            raise HTTPException(409, "Resource pool changed; refresh LABOR")
        stage.labor, stage.labor_error, stage.labor_snapshot_at = labor, error, at
        stage.mapping = proposals(source, labor)
        stage.version += 1
        audit(db, auth[0], stage, "labor_snapshot")
        await db.commit()
        return preview(stage)


@router.get("/rota-imports")
async def imports(request: Request, response: Response, pool_id: UUID):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        await import_authority(db, request, pool_id)
        stages = (
            await db.scalars(
                select(RotaImport)
                .where(RotaImport.pool_id == pool_id)
                .order_by(RotaImport.created_at.desc())
                .limit(100)
            )
        ).all()
        return {"items": [summary(stage) for stage in stages]}


@router.get("/rota-imports/{import_id}")
async def restore(request: Request, response: Response, import_id: UUID):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        stage, _ = await stage_authority(db, request, import_id)
        return preview(stage)


@router.put("/rota-imports/{import_id}/mapping")
async def mapping(request: Request, response: Response, import_id: UUID, body: Mapping):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        stage, auth = await stage_authority(db, request, import_id, True, body.version)
        rows = [r for r in eligible_rows(stage.source) if r["source_row"] == body.source_row]
        if not rows:
            raise HTTPException(422, "Unknown source row")
        if body.labor_key is not None and not any(
            item["labor_key"] == body.labor_key
            for item in eligible_candidates(rows[0], stage.labor)
        ):
            raise HTTPException(422, "Choose a name-matched LABOR candidate")
        before = stage.mapping.get(str(body.source_row))
        updated = dict(stage.mapping)
        if body.labor_key is None:
            updated.pop(str(body.source_row), None)
        else:
            updated[str(body.source_row)] = body.labor_key
        stage.mapping = updated
        stage.version += 1
        audit(
            db,
            auth[0],
            stage,
            "mapping",
            {"source_row": body.source_row, "before": before, "after": body.labor_key},
        )
        await db.commit()
        return preview(stage)


@router.post("/rota-imports/{import_id}/refresh-labor")
async def refresh(request: Request, response: Response, import_id: UUID, body: Version):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        stage, auth = await stage_authority(db, request, import_id, True, body.version)
        connection, orgid = auth[3], auth[1].orgid
    fingerprint = (
        connection.id,
        connection.base_url,
        orgid,
        configured_connection(request.app.state.settings, connection).model_copy(deep=True),
    )
    labor, error, at = await snapshot(request, connection, orgid)
    async with request.app.state.sessions() as db:
        stage, auth = await stage_authority(db, request, import_id, True, body.version)
        if (
            auth[3].id,
            auth[3].base_url,
            auth[1].orgid,
            configured_connection(request.app.state.settings, auth[3]),
        ) != fingerprint:
            raise HTTPException(409, "Resource pool changed; refresh LABOR")
        stage.labor_error = error
        if error is None:
            stage.labor, stage.labor_snapshot_at = labor, at
            # Maximo admin fixes source LABOR; the uploader has no mapping work.
            # Re-evaluate every row so new/corrected identities become eligible
            # and identities made ambiguous or inconsistent lose their binding.
            stage.mapping = proposals(stage.source, labor)
        stage.version += 1
        audit(db, auth[0], stage, "labor_refresh")
        await db.commit()
        return preview(stage)


@router.post("/rota-imports/{import_id}/cancel")
async def cancel(request: Request, response: Response, import_id: UUID, body: Version):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.sessions() as db:
        stage, auth = await stage_authority(db, request, import_id, True, body.version)
        stage.status = "cancelled"
        stage.version += 1
        audit(db, auth[0], stage, "cancel")
        await db.commit()
        return preview(stage)
