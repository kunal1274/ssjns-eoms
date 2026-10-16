# F02 — Requirements Traceability Matrix (initial baseline)

**Status:** In progress  
**Review date:** 16 October 2026  
**Repository:** `kunal1274/ssjns-eoms`  
**Working branch:** `planning/production-roadmap-data-security`  
**Canonical tracker:** [PROGRESS.md](PROGRESS.md)  
**F01 evidence:** [AUDIT-F01.md](AUDIT-F01.md), [source-code verification run #9](https://github.com/kunal1274/ssjns-eoms/actions/runs/38784677797). [Run #38841851439](https://github.com/kunal1274/ssjns-eoms/actions/runs/38841851439) passed on the previous accepted-defaults documentation state, including dependency/DB checks, tests, build, browser verification and dependency audit. The subsequent journey evidence map and consistency-review edits require a fresh CI run.

## Purpose and rules

This document starts the trace from each owner-defined F01–F25 phase and the downstream EOMS workstreams to the current code, schema, tests, evidence, gaps and acceptance work. The draft [requirement catalogue](F02-REQUIREMENT-CATALOGUE.md) assigns proposed REQ-* keys and testable acceptance statements from the roadmap, the [persona journey register](F02-PERSONA-JOURNEYS.md) proposes testable journeys and positive/negative boundaries, the [requirement-to-journey crosswalk](F02-REQ-JOURNEY-CROSSWALK.md) connects them to current evidence and gaps, the [journey-to-evidence map](F02-JOURNEY-EVIDENCE-MAP.md) records current evidence/gaps for all 16 candidate journeys, and [accepted decision defaults](F02-DECISION-RECOMMENDATIONS.md) records the project owner's accepted product defaults and implementation guards for DEC-02–DEC-09. The draft REQ-* and JRN-* catalogue still requires baseline review; customer-specific contract, payroll, integration and operations values remain subject to their applicable approvals.

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
| SRC-09 | `.github/workflows/verify.yml`, [source-code verification run #9](https://github.com/kunal1274/ssjns-eoms/actions/runs/38784677797) and [full F02-documentation run #47](https://github.com/kunal1274/ssjns-eoms/actions/runs/38839251289) | Run #9 verifies the source-code baseline; run #47 passed with the draft requirement catalogue, persona journey register, decision recommendations and requirement-to-journey crosswalk. Subsequent commits refresh documentation evidence links only. |
| SRC-10 | Browser evidence under `docs/*desktop.png`, `docs/*mobile.png` and `docs/pwa-installability.json` | Evidence for the repository build's tested screens and browser behavior, not proof of unobserved behavior in another rendered artifact. |
| SRC-11 | [`docs/SOURCE-MAP-F02.md`](SOURCE-MAP-F02.md) | Source, schema, API-test and browser-journey links with line anchors for the current implementation slice; analyst-assigned `CAP-*` keys are not owner-approved business requirement IDs. |
| SRC-12 | `scripts/browser-check.mjs`, `scripts/maintenance-browser.mjs`, `scripts/workflow-browser.mjs`, `scripts/offline-browser.mjs`, `scripts/verify-browser.mjs` | End-to-end browser journey evidence for the repository build, linked with line anchors in `SOURCE-MAP-F02.md`; it does not prove hosted-demo parity or future access-control/license journeys. |
| SRC-13 | [`docs/F02-OWNER-DECISIONS.md`](F02-OWNER-DECISIONS.md) | DEC-01–DEC-09 product defaults are accepted by explicit project-owner instruction; customer-specific hierarchy mapping and the configuration/evidence prerequisites in the decision register remain open. |
| SRC-14 | [`docs/F02-PERSONA-JOURNEYS.md`](F02-PERSONA-JOURNEYS.md) | Draft candidate personas and JRN-* journeys, each with proposed positive/negative boundaries, current evidence/gaps and phase/decision links. This is an owner-review artifact, not a signed requirements source. |
| SRC-15 | [`docs/F02-REQUIREMENT-CATALOGUE.md`](F02-REQUIREMENT-CATALOGUE.md) | Draft REQ-* catalogue with testable acceptance statements derived from the owner-defined phase tracker and production roadmap; IDs and criteria remain pending owner review. |
| SRC-16 | [`docs/F02-DECISION-RECOMMENDATIONS.md`](F02-DECISION-RECOMMENDATIONS.md) | Accepted product defaults and implementation/production guards for DEC-02–DEC-09; customer-specific configuration and sign-off prerequisites remain explicit. |
| SRC-17 | [`docs/F02-REQ-JOURNEY-CROSSWALK.md`](F02-REQ-JOURNEY-CROSSWALK.md) | Draft mapping of all 34 REQ-* rows to candidate JRN-* journeys and current CAP-* source/test evidence, with gaps and acceptance workflow; pending owner review. |
| SRC-18 | [`docs/F02-JOURNEY-EVIDENCE-MAP.md`](F02-JOURNEY-EVIDENCE-MAP.md) | Per-journey positive/negative evidence and explicit gaps for all 16 candidate JRN-* journeys; current evidence is partial/missing for several journeys and owner confirmation remains required. |

The project owner has clarified that the hosted demo was created within ChatGPT and has not been run externally. Direct URL retrieval returned 401 in this review path, so exact rendered-page parity cannot be independently asserted from the URL alone. This is **not** treated as an external deployment prerequisite. If a particular demo-only screen or interaction is required but not represented by the source archive/screenshots, record it as an owner clarification item rather than inventing a requirement.

## F01–F25 traceability

| Requirement ID / phase | Requirement intent | Current implementation and evidence | Status | Acceptance / gap to close |
|---|---|---|---|---|
| F01 | Audit the source, schema, configuration, tests and documented boundaries. | Source inventory and security findings in [AUDIT-F01.md](AUDIT-F01.md); CI run #9 passed 5 unit/sync tests, 18 integration tests, build, browser/PWA checks and audit. | **Complete — audit only** | Findings remain follow-up work; this status does not certify production readiness. |
| F02 | Map approved requirements and journeys to code, acceptance rules, tests and evidence. | This matrix, [SOURCE-MAP-F02.md](SOURCE-MAP-F02.md), draft [F02-REQUIREMENT-CATALOGUE.md](F02-REQUIREMENT-CATALOGUE.md) and [F02-PERSONA-JOURNEYS.md](F02-PERSONA-JOURNEYS.md) link current evidence and propose requirement IDs, acceptance statements and journeys; the complete owner-approved baseline remains outstanding. | **In progress** | Owner-review the candidate persona/journey inventory; map approved requirement IDs to exact code/test evidence; add missing UI/browser and security-regression evidence; resolve or formally defer ambiguities; obtain owner acceptance. |
| F03 | Define architecture conventions and decisions. | PERN/TypeScript boundaries are visible in source and README. No complete accepted ADR/convention set was found. | Missing | Record module boundaries, API contracts, validation/errors, migrations, logging, tenancy, jobs, integrations and test conventions. |
| F04 | Reproducible full Docker environment with health checks, migrations and persistence. | `compose.yaml` provides PostgreSQL only; API/web run as host processes per README. CI separately proves a PostgreSQL-backed test environment. | Partial | Containerize the agreed app stack, define health/readiness and migration sequencing, document secrets, persistence, reset and recovery. |
| F05 | Required automated checks run on pull requests and failures block acceptance. | CI runs dependency install, migrations/seed/DB tests, unit/integration tests, build, browser/PWA checks and `npm audit`; [run #47](https://github.com/kunal1274/ssjns-eoms/actions/runs/38839251289) passed on the F02 documentation state including the draft requirement catalogue, journey register, decision recommendations and crosswalk. | Partial | Decide/enforce formatting/lint rules if required, verify branch protection/status requirements, handle deprecation warnings and document required check policy. |
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

## Accepted defaults and customer-specific configuration to carry into the trace

The accepted DEC-01–DEC-09 product defaults and their implementation/production guards are recorded in [F02-OWNER-DECISIONS.md](F02-OWNER-DECISIONS.md) and [F02-DECISION-RECOMMENDATIONS.md](F02-DECISION-RECOMMENDATIONS.md). Acceptance establishes product defaults, not customer-specific company charts, role assignments, contract terms, payroll values, integration mappings or operational targets. This matrix remains the canonical status tracker.

| Decision ID | Question | Why it matters | Required owner |
|---|---|---|---|
| DEC-01 | **Accepted product-design baseline:** separate customer tenant boundary, legal/financial entity structure and configurable plantation operating hierarchy (Region/Business Unit optional → Estate → Division/Afdeling → Field optional → Block); explicitly scoped downward inheritance only. Confirm each customer's actual legal entities, optional levels and responsible-company mapping during configuration. | F06/F12 schema, API authorization and RLS policy design. | Product-design default accepted by project owner; client-specific mapping remains required |
| DEC-02 | **Accepted default:** approved OIDC provider where available; MFA for privileged administrators/approvers; secure revocable sessions and centralized user lifecycle; local-password production login disabled unless an approved exception exists. Customer-specific provider, recovery and session settings still require configuration. | F07/F08 and security threat model. | Product default accepted; customer IT/security configuration and production verification required |
| DEC-03 | **Accepted default:** versioned resource/action permissions; roles separate from explicit scope; API/DB enforcement; sensitive audit details limited to designated audit/compliance and authorized management permissions. | F09–F18 and audit confidentiality. | Product default accepted; catalogue, role templates and customer-specific audit/field access configuration remain to be verified |
| DEC-04 | **Accepted default:** maker-checker for approvals/reversals and designated high-risk transitions; no self-approval; reasoned linked corrections/reversals; explicit time-limited auditable emergency overrides. | F13/F23 and current provisional behavior. | Product default accepted; customer transaction matrix/delegation exceptions and tests required before affected flows go live |
| DEC-05 | **Accepted default:** named-user seats; licensing separate from roles/scope; server-side entitlement enforcement; never delete data on expiry; no invented grace period. Contract terms govern any explicitly agreed alternative and expiry behavior. | F19–F22. | Product default accepted; signed modules, limits, expiry, grace, suspension and renewal terms still required |
| DEC-06 | **Accepted default:** deterministic decimal arithmetic, explicit UOM/precision, effective-dated rule versions, signed worked examples and immutable original history with linked adjustments/reversals. | Checkroll/payroll and financial reconciliation. | Product default accepted; signed customer payroll examples and reconciliation rules required before calculations/posting are enabled |
| DEC-07 | **Accepted default:** transactional outbox, idempotency keys, bounded retries, explicit acknowledgements, failed-message handling and reconciliation; scoped service identities and versioned contracts. | Integration architecture and no-double-posting controls. | Product default accepted; customer system authority, signed interface mappings and correction semantics required before live posting |
| DEC-08 | **Accepted default:** encrypted monitored backups, secrets management, documented incident/recovery procedures, restore rehearsals and measurable load/SLO tests; do not invent numeric targets. | F03–F05 and production readiness. | Product default accepted; customer-approved retention, SLO, backup frequency and RPO/RTO values plus verification evidence required |
| DEC-09 | **Accepted default:** repository plus available screenshots/browser evidence are the current baseline; no uninspected demo-only behavior is assumed. Add a demo-only journey only when a specific persona, screen, action and expected result are identified. | Prevents inventing UI requirements while ensuring demo-only behavior is not lost. | Product default accepted; any specific missing journey must be identified to enter traceability |

## F02 completion gate

F02 can close only when:

- [x] The initial owner-defined F01–F25 and downstream module inventory is represented in this matrix.
- [x] Current source/test evidence and known gaps are linked at a first-pass level.
- [x] A source-to-test map with specific file/line anchors is linked for the current implementation slice.
- [x] Existing browser journeys have specific script/line anchors and their evidence boundaries are recorded.
- [x] Ambiguous business/commercial decisions are explicitly recorded rather than guessed.
- [x] A draft requirement catalogue assigns traceable REQ-* keys and testable acceptance statements for owner review.
- [x] A candidate persona/journey register with proposed positive and negative boundaries is recorded for owner review.
- [x] A journey-to-evidence map covers all 16 candidate JRN-* journeys and records current positive/negative evidence boundaries and gaps; owner confirmation and adequate evidence for every in-scope journey remain open.
- [x] Product defaults for DEC-01–DEC-09 are accepted and recorded with explicit implementation/production guards.
- [x] A draft REQ-* to JRN-* crosswalk identifies current evidence and known gaps.
- [x] Crosswalk identifier consistency checked: all 34 draft REQ-* IDs have rows and all 16 candidate JRN-* IDs are referenced; this is coverage consistency, not owner acceptance or proof of implementation.
- [ ] The owner accepts/changes the draft REQ-* IDs and confirms coverage against any signed requirements source.
- [ ] Each approved requirement is mapped to exact source and specific code/test locations; any missing implementation is explicitly assigned to a downstream phase with acceptance tests.
- [ ] Every owner-confirmed in-scope journey has positive and negative acceptance criteria and adequate evidence links.
- [x] DEC-02–DEC-09 product defaults are accepted; their customer-specific configuration and release prerequisites remain recorded separately.
- [ ] Any required hosted-demo-only journey is identified and traced, or the owner confirms none remain.
- [ ] The traceability baseline is reviewed and accepted before F03 architecture conventions begin.
- [ ] CI passes on the latest F02 documentation commit.

**Current disposition: F02 In progress.** DEC-01–DEC-09 product defaults are accepted. The candidate REQ-* catalogue and journey inventory remain review drafts; owner acceptance, exact requirement-to-test mapping and current CI verification are still required before F02 can close.
