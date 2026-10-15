# F02 — Requirements Traceability Matrix (initial baseline)

**Status:** In progress  
**Review date:** 15 October 2026  
**Repository:** `kunal1274/ssjns-eoms`  
**Working branch:** `planning/production-roadmap-data-security`  
**Canonical tracker:** [PROGRESS.md](PROGRESS.md)  
**F01 evidence:** [AUDIT-F01.md](AUDIT-F01.md), [fresh GitHub Actions run #9](https://github.com/kunal1274/ssjns-eoms/actions/runs/38784677797)

## Purpose and rules

This document starts the trace from each owner-defined F01–F25 phase and the downstream EOMS workstreams to the current code, schema, tests, evidence, gaps and acceptance work.

This is an **initial traceability baseline**, not a claim that all business requirements have been approved. Where a rule depends on client/commercial/operations sign-off, it is marked **Decision required** instead of guessed. A screen, screenshot, source comment or passing test proves only the behavior it actually covers.

### Status vocabulary

- **Present / verified:** code and a relevant test/evidence exist for the stated limited behavior.
- **Partial:** some behavior exists, but not the full requirement.
- **Missing:** no implementation/evidence found in the reviewed source.
- **Decision required:** the requirement depends on a product owner or client choice.
- **Verification pending:** source exists but the specific acceptance evidence is not yet adequate.

## Source register

| ID | Source | How it is used |
|---|---|---|
| SRC-01 | Owner-defined F01–F25 canonical phase list and project direction | Governs phase names, order and intended acceptance gates. |
| SRC-02 | `docs/PRODUCTION-ROADMAP.md` | Foundation/access-control requirements, data-level security, later module scope and production Definition of Done. |
| SRC-03 | `docs/STATUS.md` | Delivered checkpoint, known boundaries, future work and client-dependent decisions. |
| SRC-04 | `docs/MILESTONE-CLOSEOUT.md` | Delivered slices, use instructions and known limits. |
| SRC-05 | `README.md` | Setup, supported workflows, technical boundaries and current verification commands. |
| SRC-06 | `apps/api/src/app.ts`, `maintenance.ts`, `workflow.ts`, `security.ts`, `server.ts` | Current routes, validation, authentication, role checks, transactions and workflow behavior. |
| SRC-07 | `db/migrations/001_foundation.sql`–`004_gangs_review.sql` | Current schema, grants, row-level security, constraints and state fields. |
| SRC-08 | `tests/allocation.test.ts`, `sync.test.ts`, `api.test.ts`, `workflow.test.ts` | Current unit, synchronization, API, database and workflow test coverage. |
| SRC-09 | `.github/workflows/verify.yml` and [run #9](https://github.com/kunal1274/ssjns-eoms/actions/runs/38784677797) | Fresh evidence for migrations, restricted runtime DB tests, unit/integration tests, build, browser/PWA checks and dependency audit. |
| SRC-10 | Browser evidence under `docs/*desktop.png`, `docs/*mobile.png` and `docs/pwa-installability.json` | Evidence for the repository build's tested screens and browser behavior, not proof of unobserved behavior in another rendered artifact. |

The project owner has clarified that the hosted demo was created within ChatGPT and has not been run externally. Direct URL retrieval returned 401 in this review path, so exact rendered-page parity cannot be independently asserted from the URL alone. This is **not** treated as an external deployment prerequisite. If a particular demo-only screen or interaction is required but not represented by the source archive/screenshots, record it as an owner clarification item rather than inventing a requirement.

## F01–F25 traceability

| Requirement ID / phase | Requirement intent | Current implementation and evidence | Status | Acceptance / gap to close |
|---|---|---|---|---|
| F01 | Audit the source, schema, configuration, tests and documented boundaries. | Source inventory and security findings in [AUDIT-F01.md](AUDIT-F01.md); CI run #9 passed 5 unit/sync tests, 18 integration tests, build, browser/PWA checks and audit. | **Complete — audit only** | Findings remain follow-up work; this status does not certify production readiness. |
| F02 | Map approved requirements and journeys to code, acceptance rules, tests and evidence. | This document provides the first pass; the matrix is not yet reviewed against every requirement and journey. | **In progress** | Complete route/data/test cross-references, capture all missing requirements, resolve ambiguities and obtain owner acceptance of the baseline. |
| F03 | Define architecture conventions and decisions. | PERN/TypeScript boundaries are visible in source and README. No complete accepted ADR/convention set was found. | Missing | Record module boundaries, API contracts, validation/errors, migrations, logging, tenancy, jobs, integrations and test conventions. |
| F04 | Reproducible full Docker environment with health checks, migrations and persistence. | `compose.yaml` provides PostgreSQL only; API/web run as host processes per README. CI separately proves a PostgreSQL-backed test environment. | Partial | Containerize the agreed app stack, define health/readiness and migration sequencing, document secrets, persistence, reset and recovery. |
| F05 | Required automated checks run on pull requests and failures block acceptance. | CI runs dependency install, migrations/seed/DB tests, unit/integration tests, build, browser/PWA checks and `npm audit`; run #3 passed. | Partial | Decide/enforce formatting/lint rules if required, verify branch protection/status requirements, handle deprecation warnings and document required check policy. |
| F06 | Customer/group/company/estate/division/block hierarchy and inheritance. | Current schema has companies, estates and estate memberships. No complete customer/group/division/block hierarchy is present. | Partial | Agree hierarchy, ownership, cross-company boundaries and inheritance before designing migrations and policies. |
| F07 | Secure authentication and sessions, including required production identity controls. | Local password login, opaque hashed session tokens, HttpOnly/SameSite cookie, 8-hour expiry, Origin/CSRF checks and login rate limiting exist; CI covers login, invalid credentials, CSRF and logout invalidation. | Partial | Decide SSO/MFA/identity provider, recovery, session administration, expiry/revocation and production cookie/HTTPS policy. Review broad runtime access to user/session tables. |
| F08 | User invitation, activation, suspension, deactivation/reactivation and revocation. | A user active flag and session check exist; a complete administrative lifecycle is not present. | Missing | Define authorized actors, invitations/recovery, revocation timing, audit and negative tests. |
| F09 | Stable, versioned resource/action/module permission catalogue. | Authorization uses role strings and route-level checks. | Missing | Define immutable permission keys, descriptions, protected resource/action pairs, scope dimensions and versioning. |
| F10 | Extensible role model with standard/custom roles and scoped assignments. | Membership roles are fixed to manager/supervisor/clerk per estate. | Partial | Define multi-role resolution, role inheritance, scope, effective dates and safe migration from current roles. |
| F11 | Central server-side authorization over actor, action, resource, scope, state and license. | Route helper functions check estate membership and fixed roles; no general permission/entitlement engine exists. | Partial | Centralize policy evaluation and test direct API bypass, invalid state, wrong scope and unlicensed access. |
| F12 | Record-level and data-level security at API and DB layers across all data paths. | Forced PostgreSQL RLS and estate membership checks exist for current operational tables; tenant-aware estate foreign keys exist. Runtime grants on users/sessions and broad UPDATE grants need tightening; full hierarchy/field scope and pooled-context isolation tests are missing. | Partial — high priority | Design hierarchy-aware scope; least-privilege grants; fail-closed transaction context; field classification; search/export/attachment/offline/job/integration scope; negative cross-scope tests as `eoms_app`; independent review. |
| F13 | Enforce approved separation-of-duties, self-approval, conflict and delegation rules. | Manager review/reversal exists, but same-manager confirmation/review is explicitly provisional. | Decision required / partial | Obtain the approval matrix and delegation/expiry rules, then enforce and test them server-side. |
| F14 | Least-privilege role templates for platform/customer/group/estate/operations. | No role template catalogue found. | Missing | Define templates against F09–F13 and approved scope inheritance. |
| F15 | Customer admins create/clone/edit/deactivate custom roles without code changes. | No custom-role lifecycle found. | Missing | Define admin boundaries, safe clone behavior, forbidden privilege escalation and versioning. |
| F16 | Permission editor for module/resource/action and data scopes. | No permission editor found. | Missing | Define matrix UX, validation, impact display, draft state and server-enforced persistence. |
| F17 | Publish/version/audit role changes. | Operational audit exists; no role publication/version-history model exists. | Missing | Define draft/publish, activation time, rollback, audit readership and immutable history. |
| F18 | Preview/test effective role menus, actions and data scope. | No role simulation/preview found. | Missing | Preview must use the same policy evaluator as real API requests; add consistency and negative tests. |
| F19 | Contractual license model for modules/features/limits/validity/status. | No license/entitlement model found. | Missing / decision required | Agree plan structure, module entitlements, limits, grace and suspension behavior. |
| F20 | Seat model and allocation/release/capacity rules. | No seat enforcement found. | Missing / decision required | Decide named, concurrent or mixed seats and test concurrent allocation/release. |
| F21 | Server-enforced feature/module/seat entitlement. | No entitlement enforcement found. | Missing | Enforce at API/service boundaries; UI visibility alone is insufficient. Test self-enablement and direct-call bypass. |
| F22 | Expiry warnings, grace, renewal, suspension and restoration. | No entitlement lifecycle found. | Missing / decision required | Agree contract rules and preserve customer data across expiry/suspension/renewal. |
| F23 | Reusable configurable workflows, approvers, delegation, reasons, exceptions and correction lineage. | Muster-specific create/confirm/review/reverse transitions exist; no reusable workflow engine. | Partial | Define generic state/transition/guard model and correction lineage; get approval decisions before implementing policy. |
| F24 | Role- and scope-secured dashboards, queues, approvals and exceptions. | Current UI exposes a limited muster register and maintenance/gang/period/audit screens. No complete role-specific task queue/dashboard exists. | Partial | Map each persona's menus, allowed actions, queues, next actions and data scope. |
| F25 | End-to-end persona × permission × scope × license × workflow coverage. | Current browser/API tests cover limited capture, maintenance, gang/review, offline sync and estate denial. | Partial | Build the full approved scenario matrix, including forbidden journeys and CI assertions. |

## Downstream EOMS module traceability

These are later product workstreams; they are not declared complete by passing the foundation tests.

| Workstream | Existing source evidence | Missing / decision-dependent requirements | Future acceptance evidence |
|---|---|---|---|
| Master data and workforce | Worker maintenance, task occurrences/capacity, operational periods, gangs and supervisor assignments. | Effective-dated worker/gang rosters, borrowing/ownership, block assignment, calendars/day types, UOM/precision, rates/OT masters, controlled imports. | Migrations, validation, authorization/scope tests, history/effective-date tests and manager/supervisor browser journeys. |
| Field capture and checkroll | Muster draft/capture/confirmation, worker shares, review/reversal, audit/outbox and device draft sync. | Full attendance/checkroll, approved wage/rate/OT/incentive/allowance/deduction rules, exception handling, close/reopen/correction lineage, payroll reconciliation. | Signed examples and calculations, immutable audit trail, negative tests, concurrency/retry tests and end-to-end review/close journeys. |
| Planning and estate operations | No full planning/inspection/rainfall/chemical/PPE/weather workstream found. | Gantt/work plans, planned vs actual, crop estimates, rainfall, inspections/actions and safety controls. | Approved operational rules, persisted modules, role/scope tests, reporting and browser journeys. |
| Materials, fleet and weighbridge | No full implementation found. | Requests/approvals/issues/returns/stock, fleet utilization/maintenance, weighbridge/mill matching and exceptions. | Inventory/quantity reconciliation tests, workflow/segregation tests and integration contracts. |
| Reporting and analytics | Limited operational lists and bounded keyset pagination. | Scoped dashboards/reports/exports, trends, analytics/AI use cases and field-level data protection. | Reconciliation against source records, scope/permission tests, export controls and performance evidence. |
| Enterprise integration | Confirmation outbox rows are persisted transactionally. | Dispatcher, acknowledgement/retry, reconciliation, SAP Business One and HR/payroll/finance adapters, service identities and partner contract rules. | Contract tests, idempotency/retry/reconciliation evidence and explicit no-live-posting gate until acceptance. |
| Production readiness | Production startup gate; CI and synthetic-data browser tests. | HTTPS/identity/secrets, monitoring/alerts, encrypted backups/restore rehearsal, SLO/load validation, recovery targets, cutover/rollback, UAT/support. | Security review, load and recovery reports, release rehearsal, signed UAT and operational runbook. |

## Cross-cutting acceptance requirements

These apply to every feature and must be explicit in the requirement-to-test links:

1. **Authorization:** test allowed and denied actors, actions, states and scopes at the API boundary; do not rely on hidden UI controls.
2. **Data-level security:** test cross-customer/estate/block access, IDOR, invalid/missing actor context, pooled connection reuse, field disclosure, exports, offline sync, background jobs and integrations.
3. **Persistence/integrity:** migrations, constraints, tenant-aware foreign keys, concurrency, idempotency, stale versions and rollback behavior.
4. **Audit/workflow:** actor, before/after or decision evidence, reasons, immutable operational history, and approved separation of duties.
5. **Failure behavior:** validation, conflict, timeout, retry, partial outage, lost response, duplicate submission and recovery.
6. **Delivery:** build, automated tests, browser journeys, dependency/security checks, migration/rollback notes and acceptance evidence.
7. **Production gate:** passing CI is necessary but not sufficient for production; identity, monitoring, backup/restore, load, security review and UAT remain separate gates.

## Open decisions to carry into the trace

| Decision ID | Question | Why it matters | Required owner |
|---|---|---|---|
| DEC-01 | What is the authoritative customer → group/company → estate → division → block hierarchy, and which parent-child access inheritance is allowed? | F06/F12 schema, API authorization and RLS policy design. | Product owner/client |
| DEC-02 | Which identity provider and controls (SSO, MFA, recovery, session duration/revocation) are required for production? | F07/F08 and security threat model. | Product owner/security/client |
| DEC-03 | What is the approved role/permission catalogue and which roles may see audit details? | F09–F18 and audit confidentiality. | Product owner/client |
| DEC-04 | Must the same manager be prohibited from confirming and reviewing/reversing their own work? What delegation/conflict rules apply? | F13/F23 and current provisional behavior. | Operations/client |
| DEC-05 | Are seats named, concurrent or mixed? What are module entitlements, expiry, grace and suspension rules? | F19–F22. | Commercial/product owner |
| DEC-06 | What are the approved payroll/rate/UOM/rounding/OT/incentive/deduction and correction rules? | Checkroll/payroll and financial reconciliation. | Payroll/finance owner |
| DEC-07 | Which SAP Business One and HR/payroll products/contracts/interfaces are authoritative, and what are retry/acknowledgement/correction rules? | Integration architecture and no-double-posting controls. | Client integration owners |
| DEC-08 | What are the scale/SLO, retention, backup/restore RPO/RTO and production hosting requirements? | F03–F05 and production readiness. | Product owner/operations/client |
| DEC-09 | Does the ChatGPT-hosted rendered demo contain any required screen/interaction not represented by the uploaded source archive or screenshots? If yes, identify the specific journey. | Prevents inventing UI requirements while ensuring demo-only behavior is not lost. | Product owner |

## F02 completion gate

F02 can close only when:

- [x] The initial owner-defined F01–F25 and downstream module inventory is represented in this matrix.
- [x] Current source/test evidence and known gaps are linked at a first-pass level.
- [x] Ambiguous business/commercial decisions are explicitly recorded rather than guessed.
- [ ] Each row is refined to exact source requirement IDs and specific code/test locations.
- [ ] Every in-scope journey has positive and negative acceptance criteria and evidence links.
- [ ] Owner/client decisions are resolved or explicitly accepted as deferred blockers.
- [ ] The traceability baseline is reviewed and accepted before F03 architecture conventions begin.

**Current disposition: F02 In progress.** This is the first pass; it is not yet a fully approved requirement baseline.
