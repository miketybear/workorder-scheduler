from alembic import context
from sqlalchemy import create_engine, pool

from app.assignments import models as assignment_models  # noqa: F401
from app.config import Settings
from app.db.models import Base
from app.rota import models as rota_models  # noqa: F401 -- register resource/staging metadata

url = Settings().database_url.get_secret_value()

if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
