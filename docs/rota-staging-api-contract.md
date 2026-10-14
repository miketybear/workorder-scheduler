# Rota staging API — implementation contract

Date: 2026-10-11. Scope: authenticated upload, durable PostgreSQL staging,
bounded LABOR REST snapshot, mapping preview/edit and cancel/restore. No active
Maximo mutation in the original staging milestone. Roster activation/capacity
is now implemented separately: [activation contract and guide](rota-activation.md).

Per the owner's explicit confirmation on 2026-10-11, an active tenant Admin or
a user with server-side PlannerPermission on the pool's connection may read/write
the common five-craft staging pool. This does not widen WO discipline access.
An operator may also assign an audited explicit resource-pool read/write grant.
Users with neither role eligibility nor an explicit grant have no access. A pool binds
one configured connection/environment/org for LABOR identity, and all five rota
crafts share its calendar. It is not a rig/site pool. Operator provisioning must
use stable Entra user identity and record who granted access and why.

## Endpoints

- `GET /api/resource-pools` → `{items: Pool[]}` for currently permitted pools.
- `POST /api/rota-imports?pool_id=UUID&filename=...&sheet=ROTA_2026` with file bytes
  as `application/octet-stream` → `Preview`. Supports `.xlsx`/`.ods`; bounded
  streaming upload. No multipart dependency. CSRF required.
- `GET /api/rota-imports?pool_id=UUID` → `{items: ImportSummary[]}`.
- `GET /api/rota-imports/{id}` → persisted `Preview`, scoped by pool grant.
- `PUT /api/rota-imports/{id}/mapping` body
  `{version: integer, source_row: integer, labor_key: string|null}` → `Preview`.
- `POST /api/rota-imports/{id}/refresh-labor` body `{version: integer}` → `Preview`.
- `POST /api/rota-imports/{id}/cancel` body `{version: integer}` → `Preview`.

Every mutation rechecks authority and increments optimistic `version`; stale
versions return409. Reads and mutations return no-store. Unknown/out-of-scope
revision IDs return404. Changed session/revoked role or pool grant must hide/clear UI.
LABOR credentials remain server-side, and configured connection is rechecked
before/after network I/O. Snapshot failure is stored as an explicit incomplete
state; upload remains durable and refresh is available, no fabricated candidates.
A failed refresh preserves the previous snapshot and mappings while marking
freshness incomplete. A successful refresh recomputes all automatic bindings,
requiring exactly one name candidate with exactly the rota craft. This discovers
new/corrected LABOR and removes newly ambiguous or craft-conflicting bindings.
The upload UI has no manual mapping control: Maximo admin fixes LABOR on Maximo.
The mapping endpoint is retained for historical API compatibility; successful
refresh replaces any such prior bindings with the automatic result.

## JSON DTO

`Pool`: `id,label,connection_id,connection_label,environment,orgid,timezone,
capability` (`read` or `write`).

`ImportSummary`: `id,pool_id,version,status,file_name,sheet,created_at,
coverage_from,coverage_before` (exclusive end).

`Preview`: summary fields plus `policy_version,labor_snapshot_at,labor_error,
source_errors,rows,excluded_labor_count,excluded_company_count,summary`.
`excluded_company_count` is the count of source personnel rows explicitly
belonging to another company, before mapping/capacity; historic stages return0.

`Issue`: `kind,message,source_row` (nullable), `date` (nullable), `cell` (nullable).

`Row`: `source_row,name,position,company,craft,role,days,mapping,candidates,issues`.
Company is `BDPOC` for policy v4 accepted personnel; absent in historic stages.
Craft/role may be null for invalid source. Roles: `TECH,SUP,ASST_SUP,
CONTROL_RM_ENGINEER,MATERIAL_CONTROLLER`. Name/craft/position/days are read-only.

`Day`: `date,code,capacity_hours` (number or null when unknown).

`Labor`: `labor_key,connection_id,orgid,laborcode,personid,displayname,
default_crafts` (distinct strings). `mapping` is selected Labor or null;
`candidates` are only name-matched LABOR for this row. Composite LABOR key must
be deterministic and collision-safe. Duplicate person bindings are blockers.

`summary`: `rota_people,mapped_people,blocking_count,capacity_hours`.
Only source people are candidates for pool inclusion. Outside-rota LABOR never
become roster rows; return excluded count, not outside-rota individual names.
Policy v4 additionally requires source column C Company to normalize to BDPOC.
Other companies are excluded even if they match ACTIVE LABOR. Blank/formula
Company is a source error at C[row] and the person is excluded until reupload.
Hours are the public/display unit; working10.5, blank/known-off0, unknown null.

Upload initially fetches LABOR through REST, proposes only uniquely matched
identities/craft, and persists immutable source plus snapshot and editable mapping.
No automatic name-based person identity creation. Normalize diacritics/spaces
for candidates only; retain original labels/provenance. Recognized trailing crew
annotations may be ignored for candidate search with explicit policy version.

## UI

New real route `/rota-imports`; existing `/rota-staging-demo` remains synthetic.
Signed-in user selects a server-permitted pool, uploads file, sees saved preview,
reads the LABOR error report, refreshes LABOR and can cancel or restore saved stage after
reload. Source errors show sheet/row/cell/date and tell planner to fix/reupload.
All capacity displayed as hours. Explicitly distinguish staging from active roster;
the separate activation panel previews changes, confirms full-range replacement
and calls the PostgreSQL activation API with import/pool versions.
Show connection label and environment. Abort stale reads and clear state on
identity/access/pool change. No credentials, browser persistent operational data,
client-supplied access claims, native macros or workbook personal identifiers.

LABOR errors appear in a separate table before the calendar with source row/name/
position/rota craft, each candidate's LABOR/PERSON/org/display name/default crafts,
and the error reason. Missing/ambiguous identity or craft errors do not reject
an otherwise accepted file upload; they remain blockers in the saved preview.
Planner refreshes after Maximo admin fixes the upstream data; no alias, manual
candidate choice or craft override is offered by this workflow.

DB activation and revision diff are implemented in the activation API; ledger
reservation conflict checks remain the next milestone. Activation currently
uses the saved LABOR snapshot and performs no upstream freshness lookup.
