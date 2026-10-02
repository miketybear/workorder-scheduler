"""Create the owner-authorized Onshore test connection in the isolated local SSO DB."""

from uuid import UUID

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import AuthorizationEvent, LoginSession, MaximoConnection, User

CONNECTION_ID = UUID("aab45085-e84f-4273-82d2-960b1f26c3da")


def main() -> None:
    settings = Settings()
    url = make_url(settings.database_url.get_secret_value())
    if (
        settings.environment != "development"
        or url.host != "127.0.0.1"
        or url.port != 55433
        or url.database != "scheduler_entra_local"
        or settings.entra is None
    ):
        raise SystemExit("This setup only supports the isolated Windows local SSO database")
    registry = settings.maximo.get(CONNECTION_ID)
    if (
        registry is None
        or registry.collection_url
        != "http://bd-maxdev.biendongpoc.vn/maximo/oslc/os/oslcmxwodetail"
        or not registry.allow_http_for_test
        or registry.person_login_domain != "biendongpoc.vn"
    ):
        raise SystemExit("Expected Onshore test registry and company PERSON domain are required")
    engine = create_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    try:
        with Session(engine) as db, db.begin():
            from sqlalchemy import func

            actors = list(
                db.scalars(
                    select(User)
                    .join(LoginSession)
                    .where(
                        User.tenant_id == settings.entra.tenant_id,
                        User.active.is_(True),
                        LoginSession.expires_at > func.now(),
                    )
                    .distinct()
                )
            )
            if len(actors) != 1:
                raise SystemExit(
                    "Exactly one authenticated local owner is required for setup audit"
                )
            existing = db.get(MaximoConnection, CONNECTION_ID)
            if existing:
                if (
                    existing.system != "onshore"
                    or existing.environment != "test"
                    or existing.base_url != "http://bd-maxdev.biendongpoc.vn/maximo"
                    or existing.timezone != "Asia/Ho_Chi_Minh"
                    or not existing.enabled
                ):
                    raise SystemExit("Existing connection differs; no configuration overwritten")
                print("Onshore test connection already configured; unchanged")
                return
            db.add(
                MaximoConnection(
                    id=CONNECTION_ID,
                    system="onshore",
                    environment="test",
                    label="Onshore test",
                    base_url="http://bd-maxdev.biendongpoc.vn/maximo",
                    timezone="Asia/Ho_Chi_Minh",
                    secret_reference=f"WOS_MAXIMO:{CONNECTION_ID}",
                    enabled=True,
                )
            )
            db.flush()
            db.add(
                AuthorizationEvent(
                    actor_id=actors[0].id,
                    connection_id=CONNECTION_ID,
                    event="connection_created",
                    details={
                        "system": "onshore",
                        "environment": "test",
                        "timezone": "Asia/Ho_Chi_Minh",
                        "access_source": "mxperson.ct_discipline",
                        "capability": "read",
                        "login_domain": "biendongpoc.vn",
                    },
                )
            )
        print("Configured Onshore test connection with audit; no admin or manual WO grant created")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
