# Backend — Agent Instructions

Read [../AGENTS.md](../AGENTS.md) first. This Python API is the sole boundary for Maximo
credentials, authorization, scheduling validation and audit persistence.

## Implementation defaults

- FastAPI + Uvicorn; Pydantic models and pydantic-settings for configuration.
- HTTPX for asynchronous read-only Maximo requests with explicit TLS, timeouts and bounded paging.
- SQLAlchemy + psycopg for PostgreSQL; Alembic for reviewed schema migrations.
- MSAL Python for Entra code flow/PKCE; PyJWT for signature and claim validation; DB sessions.
- uv for Python dependency management and a committed uv.lock.
- pytest for tests; Ruff for linting and formatting; standard-library logging.
- Choose a supported Python minor version and compatible package pins during scaffolding.
  Foundation baseline: Python 3.12.14; resolved packages are pinned in uv.lock.

Prefer pathlib, datetime, zoneinfo, decimal, uuid and standard collection APIs.
Do not add a task broker until demonstrated workload requires one.

## Planned layout

```text
backend/
├── AGENTS.md
├── pyproject.toml
├── uv.lock
├── alembic.ini
├── migrations/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── auth/          # Entra callback, sessions and access grants
│   ├── maximo/        # Connection registry, transport and response mapping
│   ├── scheduling/    # Read filters, drafts, validation and update orchestration
│   ├── audit/         # Upload attempts, outcomes and recovery
│   └── db/            # Models and database sessions
└── tests/
```

app/config.py, app/main.py, auth/policy.py, scheduling/changes.py, db/models.py,
migrations and tests now exist, including auth/sessions.py, scheduling/drafts.py and audit/uploads.py.
Session storage/logout, Entra flow persistence and internal draft/upload persistence have PostgreSQL tests.
Entra code flow and scoped Maximo WO list API are implemented with offline HTTP tests.
Scoped detail/PIC and draft create/list/restore/update/delete APIs exist, with baseline tokens,
version checks and durable duplicate receipts (migration 0004). Draft UI is connected.
Local Entra login and Onshore test mxperson reads are verified; PERSON-derived read grants
and authorization audit use migration 0005. Onshore test E&I WO list/detail and crew reads
and live draft create/restore/update are verified. Migration 0006 adds explicit scoped Planner
permissions with audited admin API/operator CLI, intersected with PERSON discipline.
Migration 0007 stores the account's selected configured connection; session/settings responses
intersect preferences with current grants. This preference never creates or expands WO access.
Broader live scopes and tenant policy checks,
WO revision/ETag and uploads remain pending. See ../docs/person-access.md and ../docs/entra-setup.md.

## Identity and authorization

- Use a single company tenant and stable (tenant ID, object ID) identity.
- OIDC authorization-code flow must validate state, nonce, issuer and audience through
  established libraries. Use PKCE where supported by the selected library.
- Store tokens server-side; issue opaque Secure, HttpOnly session cookies.
  Apply CSRF protection to state-changing routes and implement logout/session expiry.
- Resolve grants on the server for every operation. Each grant associates a user with
  a configured connection, a discipline and capabilities.
- Roles are proposed as Viewer, Planner and Admin. Admin manages configuration/grants;
  access to business data still requires an explicit scoped grant.
- Inject mandatory scope into every Maximo query and validate returned records before release.
  Never accept raw OSLC predicates from the browser.
- Scope drafts, history, job status, pagination, summaries and any future exports.
  Out-of-scope identifiers must not disclose record existence or contents.
- Recheck current upstream discipline before an update. A record moved outside scope must
  no longer be served from a stale cache or draft; fail closed when scope cannot be verified.

## Maximo integration

- Workbook reference endpoint: /maximo/oslc/os/oslcmxwodetail/.
  Verify object structure, record hrefs and permissions on each configured test connection.
- Reference crew endpoint: /maximo/oslc/os/mxpersongroup/.
- Reference open statuses: APPR, SCHED, WMATL, WMAT, DFAPPR.
  Reference retrieval uses discipline, target completion range, parent filtering and istask=0.
  Validate status domains and parent semantics on the actual installation.
- Use JSON serialization, encoded query parameters, complete pagination and bounded timeouts.
- HTTPS is the default. The project owner authorized test-only HTTP: require explicit registry
  allow_http_for_test=true, DB connection environment=test and a non-production application.
  Apply configured_connection checks to every Maximo-facing API before/after network I/O.
  Never disable HTTPS certificate verification or relax Entra HTTPS for this exception.
  Follow only upstream links that remain within the configured trusted connection.
- Read actual field metadata/nullability and preserve record identity across systems/sites.
- POST with x-method-override: PATCH is the existing VBA behavior; confirm support on test.
- Only allow schedstart, schedfinish, assignedtechname, estdur and explicitly requested
  targstartdate/targcompdate. Do not send status, discipline or arbitrary browser-supplied fields.
- Reject target updates for PM/CFT on the server even if the UI is bypassed.
- Validate dates, required values and nonnegative duration; verify PIC membership against the
  configured crew. Null/clear semantics and date-only behavior must be settled in test.
- Preserve offset-aware instants; business timezone is explicit connection configuration.

## Drafts, conflicts and upload recovery

- Persist original values and a revision token when available alongside proposed edits.
- Before writing, re-read the WO, verify scope and compare relevant state.
  Prefer a validated ETag/If-Match mechanism; a read-then-write check alone has a race window.
  If conditional updates are unavailable, document that limitation before production.
- Persist actor, connection, site, WO identity, intended field changes and attempt ID before
  making the upstream call. If this persistence fails, do not send the write.
- Deduplicate duplicate submissions and serialize local writes to the same WO.
- Track each item independently: pending, sending, confirmed, failed, conflict or unknown.
  A timeout after sending is unknown until reconciliation; do not resend automatically.
- Read back successful writes and compare normalized values. Persist reconciliation outcomes.
  The remote update and local database transaction cannot be treated as one atomic transaction.
- Keep business audit events append-only to application users; redact credentials and unrelated
  response content. Log authorization changes as well as WO changes.

## Configuration, migrations and tests

- All environment reads belong in app/config.py; examples use empty secret values.
- Alembic migrations are the schema source of truth. Review generated operations, constraints
  and indexes. Do not create production tables manually.
- Migration command from backend/: uv run alembic upgrade head.
- Fast checks: uv run pytest -m "not integration"; uv run ruff check .
- Mark database/live Maximo tests integration. No production endpoints in automated tests.
- Required tests: cross-system/discipline access, guessed IDs, revoked grants, moved WO,
  PM/CFT target restriction, allowlisted payloads, pagination, timezone boundaries, conditional
  conflict handling, duplicate submission, partial failure and unknown-outcome recovery.
