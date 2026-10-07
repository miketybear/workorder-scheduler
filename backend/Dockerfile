FROM python:3.12.14-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f
COPY --from=ghcr.io/astral-sh/uv:0.11.9@sha256:6b6fa841d71a48fbc9e2c55651c5ad570e01104d7a7d701f57b2b22c0f58e9b1 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-python-downloads --no-dev --no-install-project
COPY app ./app
COPY alembic.ini ./
COPY migrations ./migrations
RUN useradd --create-home --uid 10001 scheduler
USER scheduler
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
