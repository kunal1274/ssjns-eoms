# F01 — Foundation Source Code Audit

**Review date:** 15 October 2026  
**Repository:** `kunal1274/ssjns-eoms`  
**Working branch:** `planning/production-roadmap-data-security`  
**Review basis:** uploaded repository ZIP plus static review of application, database migrations, tests, Docker configuration and project documentation.  
**Audit type:** source/configuration review. This is not a completed clean build, full test run, penetration test, or production certification.

## Executive summary

The uploaded source is a real PERN development codebase: React + TypeScript + Vite web/PWA, Express + TypeScript API, PostgreSQL schema/migrations, domain helpers, operational workflows, and automated test scripts. It includes a limited muster workflow with master-data maintenance, gang assignment, manager review/reversal, audit/outbox records, idempotency/version checks, and a device-draft sync path.

**F01 remains In progress.** The foundation is useful, but the source does not establish production readiness. Major scope still outstanding includes a customer/group/estate/division/block hierarchy, configurable permissions, complete user lifecycle, licensing/seat enforcement, reusable workflow configuration, broader operational modules, live integrations, production operations/recovery, and load evidence.

The project owner clarified that the demo was created within ChatGPT and has not been run externally. The provided URL returned 401 to the retrieval method available in this review, so I could not independently inspect its rendered UI or verify screen-to-source parity. This does not establish that the project is external or separate. The uploaded ZIP is the source basis for this F01 code audit; no additional external export is being requested at this stage.

## Source inventory

- `apps/web`: React + TypeScript + Vite web/PWA frontend.
- `apps/api`: Express + TypeScript API.
- `packages/domain`: allocation and offline synchronization logic.
- `db/migrations`: four SQL migrations (foundation, transaction locks, maintenance, gangs/review).
- `scripts`: migration/seed setup, database tests and browser verification.
- `tests`: domain, sync, API and workflow tests.
- `compose.yaml`: PostgreSQL service, persistent volume and health check; it does not containerize the API and web app.
- `.github/workflows/verify.yml`: CI workflow for migrations, tests, build, browser verification and dependency audit.

## Positive findings from source inspection

1. **Basic authentication controls:** passwords are hashed with scrypt; session tokens are random opaque values and only their SHA-256 hashes are stored; the cookie is HttpOnly and SameSite=Strict; sessions expire after eight hours; writes check Origin and a CSRF token; login requests are rate-limited.
2. **Fail-closed production gate:** `apps/api/src/server.ts` refuses to start when `NODE_ENV=production` until the documented production requirements are addressed.
3. **Transaction-local actor context:** scoped database operations set `app.user_id` with transaction-local `set_config(..., true)`; transactions set a statement timeout and release pooled connections in `finally`.
4. **Current estate row security:** migrations enable and force RLS on current estate-owned operational tables. Membership checks and estate-aware foreign keys reduce cross-estate reference mistakes.
5. **Operational integrity:** muster creation/confirmation and audit/outbox writes share transactions. Idempotency keys, optimistic versions, task-row locking and period locking cover important retry and concurrency cases.
6. **Authorization tests exist:** API tests cover unauthenticated access, logout/session invalidation, wrong passwords, Origin/CSRF rejection, cross-estate access, basic RLS filtering, role-restricted actions and runtime audit-table immutability.
7. **Offline boundaries are documented:** the service worker caches the static shell rather than `/api/` responses; drafts are stored in browser IndexedDB and explicit sync rechecks server authorization. Browser storage is not encrypted by the app, and full cold-start offline operation is not implemented.

## Findings requiring action

| Priority | Finding | Evidence / impact | Required action |
|---|---|---|---|
| High | Runtime authentication-table privileges are broad | Migration 001 grants `eoms_app` SELECT on all columns/rows in `eoms.users` (including password hashes) and SELECT/INSERT/DELETE on `eoms.sessions`; neither table has RLS there. No current public route directly returns all rows, so this is a least-privilege concern, not proof of a remotely exploitable vulnerability. | In F07/F12, design narrow authentication/session access (for example, carefully scoped database functions or a dedicated auth access pattern). Verify login, expiry, logout/revocation and inactive-user behavior before narrowing grants. |
| High | Operational table write grants exceed the API's apparent field needs | Migration 001 grants table-level UPDATE on `eoms.musters`; migration 004 grants table-level UPDATE on `eoms.gangs`. These privileges permit updating columns beyond the subset used by current API handlers, including security-sensitive identifiers/state. | Review every SQL mutation and replace broad UPDATE grants with column-level grants where feasible. Add tests proving prohibited column changes fail for `eoms_app`. Keep RLS and API authorization as separate layers. |
| High | RLS scope is estate-level, not the target hierarchy | Current schema has companies, estates and estate memberships, but no complete customer/group/division/block authorization model. | Define hierarchy and inheritance before expanding data. F12 must cover API and DB policy, tenant-aware relationships, fail-closed context and all data paths. |
| Medium–High | Audit visibility is broad within an estate | `GET /api/estates/:estateId/audit` checks estate membership but does not require a distinct audit/manager permission. | Confirm the intended audit readership. Then enforce the policy server-side and test allowed/denied roles; do not assume all estate users should see audit detail. |
| Medium | Authorization is role-string based | Current roles are constrained to `manager`, `supervisor`, `clerk`; authorization checks are distributed across route helpers. There is no stable resource/action permission catalogue or custom-role model. | F09–F18: define permissions, scope-aware assignments, templates, custom roles, editor, publication/versioning and role preview/testing. |
| Medium | Explicit pooled-context isolation test is missing | Existing tests demonstrate RLS with an actor context and no-context filtering, but do not clearly exercise alternating users/concurrent requests over reused pooled connections as a dedicated regression test. | Add tests for absent context, invalid context, alternating actors, transaction rollback and pooled connection reuse. Run them as the restricted runtime role. |
| Medium | Production user lifecycle is incomplete | Local login/logout/session expiry exist; invitation, recovery, provisioning, MFA/SSO policy, session administration and lifecycle audit are not implemented as a complete workflow. | F07–F08: define and implement lifecycle requirements before production identity is enabled. |
| Medium | Docker stack is partial | Compose provisions PostgreSQL only; README runs API and web as host processes. | F04: define a complete repeatable app stack, health/readiness checks, migration sequencing, secrets handling and persistent-data behavior. |
| Medium | Workflow is specific to muster | Current approval/reversal is not a reusable configurable workflow engine. Same-manager confirmation/review is documented as provisional; reversal is not a payroll/SAP correction. | F13 and F23–F25: obtain approval-matrix decisions and implement configurable workflow/journeys only against accepted requirements. |
| Medium | Licensing and entitlement enforcement are absent | No server-enforced modules/features/seats/expiry model is present in this foundation. | F19–F22: agree commercial decisions, then enforce entitlements server-side and test bypass attempts. |
| Medium | Operational integrations are incomplete | Outbox events are persisted transactionally, but no dispatcher or live SAP/HR adapter is documented as implemented. | Add idempotent dispatch, retry/acknowledgement, reconciliation and scoped service identities before partner posting. |
| Medium | Production operations evidence is absent | No production startup is allowed; load capacity, backup/restore, monitoring, recovery objectives, security review and UAT are not established by this source audit. | Keep production gate. Define and evidence these gates before deployment. |

## Verification attempt in this review environment

- The archive was extracted and source/configuration/migrations/tests were inspected.
- Runtime available: Node v22.16.0 and npm 10.9.2. The README requests Node 24+; CI is configured for Node 24.
- `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` did not finish within the available tool execution window. The dependency tree remained incomplete.
- Docker and `psql` are not installed in this review environment.
- Therefore, **no fresh TypeScript check, build, unit test, integration test, migration test, browser test or database RLS test is claimed** from this run.
- The repository's CI workflow is configured to run migrations, domain/API tests, build, browser verification and `npm audit`. Any previously recorded green run is historical evidence only; it is not a fresh result for this uploaded snapshot.

## F01 acceptance checklist

- [x] Uploaded repository source inventory inspected.
- [x] API authentication, request guards, transaction context and authorization helpers reviewed.
- [x] Database migrations, RLS policies, foreign keys and runtime grants reviewed at source level.
- [x] Existing tests and CI workflow inspected.
- [x] Initial high-priority hardening findings recorded.
- [ ] Clean dependency installation and TypeScript/build verification completed.
- [ ] PostgreSQL migrations and integration/security tests executed against the restricted runtime role.
- [ ] Browser regression suite executed and evidence recorded.
- [ ] UI-to-source parity independently verified where the actual ChatGPT project artifact is available for inspection.

**Disposition: F01 remains In progress.** No application code or `main` branch changes were made during this review.