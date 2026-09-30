# Frontend — Agent Instructions

Read [../AGENTS.md](../AGENTS.md) first. Build a desktop-oriented scheduling interface
that keeps the familiar editable-table workflow of the workbook.

## Implementation defaults

- React + TypeScript strict mode, built with Vite.
- npm with a committed package-lock.json; do not introduce a second package manager.
- React Router for page navigation; CSS Modules for styling.
- Native fetch through one API client; React state/reducers before adding a state library.
- Native accessible controls first. Select a grid library only after evaluating keyboard editing,
  paste, row count and licensing needs; no grid package is selected yet.
- Vitest + React Testing Library for behavioral tests; Playwright is planned for critical E2E flows.
- Choose supported compatible Node.js and package versions during scaffolding and pin them.
  Foundation baseline: Node.js 26.0.0; exact dependencies and lockfile are installed.

## Planned layout

```text
frontend/
├── AGENTS.md
├── package.json
├── package-lock.json
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── config.ts
    ├── api/             # Shared HTTP client and API types
    ├── auth/            # Current session and scoped capabilities
    ├── scheduling/      # Filters, WO table, edits and change preview
    ├── history/         # Scoped audit and upload results
    └── components/      # Shared controls and layout
```

Overview, session/login/logout controls and an explicitly synthetic /demo route exist.
A read-only /work-orders route consumes the scoped backend list API with session checks.
Live SSO/Maximo verification, persisted draft UI and uploads remain pending.

## API and authentication

- Same-origin JSON API under /api; backend owns Entra redirects and session cookies.
- Route login through the backend. Do not keep access tokens or integration keys in browser
  storage or component props. Use CSRF protection required by the backend.
- Centralize serialization, cancellation, errors and authentication expiry in src/api/.
- Read public configuration only in src/config.ts. Browser-visible configuration is never secret;
  an environment-variable prefix is not a security boundary.
- Frontend visibility/disabled controls improve UX but never replace backend authorization.
- Clear stale WO state when system, identity or grants change. Never show rows from the
  previous connection under a new system label.

## Scheduling behavior

- Show the selected system and environment prominently, including in the upload preview.
- List only permitted systems/disciplines supplied by the backend.
- Display WO identity, description, type, location/system, status, priority, PIC, duration,
  percentage complete and schedule/target/actual dates as available.
- Edit schedule start/finish, PIC and duration. Target editing requires explicit user intent;
  disable it for PM/CFT with a clear explanation.
- Support selected-row date assignment, clear modified-cell indicators, undo/reset to the
  retrieved baseline and a field-level before/after preview.
- Distinguish retrieval, saved drafts, pending uploads and confirmed Maximo values.
- Show validation and upload results per WO, with aggregate counts for partial success.
  Never label a whole batch successful when some items failed or remain unknown.
- Preserve user edits after recoverable errors. Reconcile unknown outcomes before offering retry.
- Display dates in the configured business timezone; do not silently use the browser timezone
  or convert a date-only input to midnight UTC.
- Keep drafts server-side; avoid persistent browser storage of operational WO data.

## Code style and tests

- Strict types; narrow unknown data instead of using any to silence errors.
- Small components and domain-focused modules; built-in array/object APIs instead of utility libs.
- Use Intl for display formatting. Centralize date serialization with a tested timezone contract.
- Use accessible labels, keyboard navigation and visible focus states.
- Required behavioral tests: draft preservation, PM/CFT controls, changed-field preview,
  connection switching, session expiry and mixed upload results.
- End-to-end tests exercise the real backend policy in a test environment; hiding rows in a
  frontend mock is not proof of authorization.
- Add and document working npm scripts for typecheck, lint, test and build during scaffolding.
