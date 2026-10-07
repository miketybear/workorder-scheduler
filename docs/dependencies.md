# Dependency decisions — foundation

2026-09-25. Versions resolved into backend/uv.lock and frontend/package-lock.json.
Entra login implementation added 2026-09-29; live tenant and Maximo integration remain unverified.

| Runtime dependency | Non-trivial purpose and usage | Maintenance / transitive footprint |
|---|---|---|
| FastAPI + Uvicorn | HTTP routing, schema validation and ASGI serving on every API request | Established Python projects; Starlette/AnyIO/Pydantic and server protocol libraries locked by uv |
| pydantic-settings | Validated startup configuration and protected secret representation | Uses Pydantic and dotenv; kept at one settings boundary |
| SQLAlchemy + psycopg | PostgreSQL connection lifecycle, typed relational models and parameterized SQL | SQLAlchemy/greenlet and native psycopg wheel; used for persistence and health checks |
| Alembic | Versioned transactional database migrations | SQLAlchemy and Mako dependencies; runs during deployment, not every request |
| React + React DOM | Stateful editable UI and rendering | Core rendering packages, locked with npm; used across the UI |
| React Router | Route navigation and fallback pages | Router dependencies recorded in package-lock; used for overview and explicit demo route |

Development-only: pytest for isolated API tests; Ruff for Python lint/format;
TypeScript, Vite and React plugin for frontend compilation; ESLint and TypeScript/hooks
plugins for lint; Vitest, jsdom and Testing Library for UI behavior tests.

HTTPX is now runtime for the Maximo reader (see addition below); Playwright remains planned.

2026-09-29 runtime additions:

- MSAL 1.39.0: Microsoft-supported authorization code flow, state/nonce/PKCE and confidential
  client token exchange, used twice per sign-in. These standards cannot reasonably fit in
  30 clear application lines. Transitives include requests/urllib3, PyJWT and cryptography.
- PyJWT[crypto] 2.15.1: verifies RS256 signatures using JWKS plus issuer/audience/time claims
  on each successful code exchange. MSAL 1.39 no longer validates those JWT properties.
  Explicit runtime dependency on the same PyJWT/cryptography already required by MSAL;
  no parallel JWT library. Native cryptography uses cffi/pycparser. All versions locked in uv.lock.
  Maintenance: track Microsoft MSAL, PyJWT and cryptography advisories when updating locks.

Python baseline is 3.12.14; local validation uses Node 26.0.0. Docker base images now have
verified manifest digests (2026-10-07); [build/smoke evidence](container-checks.md).
Lifecycle/security patch review and full image scans remain pending before production.
A lockfile is reproducibility evidence, not a security review.

2026-09-29 Maximo reader: promote HTTPX from test-only to runtime. Async HTTPS streaming,
TLS verification, timeouts, connection management and mock transport are used on every
Maximo page request; these cannot reasonably fit in 30 clear lines. HTTPX/httpcore/AnyIO,
certifi and h11 are already locked for tests; no second async HTTP client is introduced.

2026-10-07 development patch: source-map-js 1.2.1 → 1.2.2, a transitive build-tool
dependency, fixes [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
Only that package-lock entry changed; no new dependency or parallel library. Clean npm ci,
151 frontend tests, lint/typecheck/build and npm audit with zero advisories passed.
Playwright harness uses the existing Codex bundled package; not added to app dependencies.
