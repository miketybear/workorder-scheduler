import ssl
from contextlib import asynccontextmanager
from functools import partial

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.assignments.routes import router as assignments_router
from app.auth.entra import router as entra_router
from app.auth.photos import PhotoStore, session_photo
from app.auth.planner import router as planner_router
from app.auth.sessions import logout, session_info
from app.auth.settings import router as settings_router
from app.config import Settings
from app.maximo.page_routes import router as maximo_page_router
from app.maximo.reader import MaximoReadError
from app.maximo.routes import router as maximo_router
from app.maximo.snapshots import SnapshotCache
from app.rota.activation_routes import router as rota_activation_router
from app.rota.routes import router as rota_router
from app.scheduling.batches import router as batches_router
from app.scheduling.routes import router as scheduling_router
from app.scheduling.upload_routes import router as uploads_router
from app.workflow_route.credentials import CredentialStore, LoginLimiter
from app.workflow_route.routes import router as workflow_route_router
from app.workflow_route.service import ContractCache

SCHEMA_REVISION = "0017_workflow_route_attempt"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = create_async_engine(
            settings.database_url.get_secret_value(),
            pool_pre_ping=True,
            hide_parameters=True,
            connect_args={"connect_timeout": 3},
        )
        app.state.engine = engine
        app.state.sessions = async_sessionmaker(engine, expire_on_commit=False)
        tls = (
            ssl.create_default_context(cafile=str(settings.maximo_ca_bundle))
            if settings.maximo_ca_bundle
            else True
        )
        # Isolate cookie jars per retrieval/connection; never reuse an upstream login cookie
        # across independently configured Maximo integrations.
        app.state.maximo_client_factory = partial(
            httpx.AsyncClient, verify=tls, trust_env=False, follow_redirects=False
        )
        try:
            yield
        finally:
            await app.state.work_order_snapshots.close()
            await engine.dispose()

    app = FastAPI(title="Work Order Scheduler", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.profile_photos = PhotoStore()
    app.state.work_order_snapshots = SnapshotCache(
        settings.work_order_snapshot_ttl_seconds,
        settings.work_order_snapshot_max_entries,
        settings.work_order_snapshot_max_rows,
        settings.work_order_snapshot_max_bytes,
    )
    # Position-account sessions live only in this process's memory.
    app.state.workflow_route_credentials = CredentialStore()
    app.state.workflow_route_limiter = LoginLimiter()
    app.state.workflow_route_contract = ContractCache()
    app.state.workflow_route_locks = {}
    app.include_router(entra_router)
    app.include_router(planner_router)
    app.include_router(settings_router)
    app.include_router(maximo_router)
    app.include_router(maximo_page_router)
    app.include_router(scheduling_router)
    app.include_router(batches_router)
    app.include_router(uploads_router)
    app.include_router(rota_router)
    app.include_router(rota_activation_router)
    app.include_router(assignments_router)
    app.include_router(workflow_route_router)

    @app.middleware("http")
    async def prevent_resource_caching(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(
            (
                "/api/rota-imports",
                "/api/resource-pools",
                "/api/assignments",
                "/api/assignment-submissions",
                "/api/assignment-plans",
                "/api/assignment-plan-upload",
                "/api/plan-upload-batch",
            )
        ):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(MaximoReadError)
    async def upstream_unavailable(request: Request, error: MaximoReadError):
        return JSONResponse(
            {"detail": str(error)}, status_code=502, headers={"Cache-Control": "no-store"}
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_unavailable(request: Request, error: SQLAlchemyError):
        # SQL parameters can contain auth-flow secrets. Do not echo/log raw exceptions.
        return JSONResponse(
            {"detail": "Database unavailable"},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/health/live")
    async def live():
        return {"status": "ok"}

    @app.get("/api/health/ready")
    async def ready(request: Request):
        try:
            async with request.app.state.engine.connect() as connection:
                revision = await connection.scalar(text("SELECT version_num FROM alembic_version"))
        except SQLAlchemyError:
            raise HTTPException(503, "Database or schema unavailable") from None
        if revision != SCHEMA_REVISION:
            raise HTTPException(503, "Schema upgrade required")
        return {"status": "ok", "scope": "database-schema-only"}

    app.add_api_route("/api/auth/session", session_info, methods=["GET"])
    app.add_api_route("/api/auth/photo", session_photo, methods=["GET"])
    app.add_api_route("/api/auth/logout", logout, methods=["POST"])

    return app
