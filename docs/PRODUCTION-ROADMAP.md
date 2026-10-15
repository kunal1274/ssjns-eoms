# Estate Opera EOMS — Production Roadmap

**Canonical progress tracker:** [docs/PROGRESS.md](PROGRESS.md)  
**F01 audit findings:** [docs/AUDIT-F01.md](AUDIT-F01.md)  
**Repository:** https://github.com/kunal1274/ssjns-eoms  
**Planning branch:** `planning/production-roadmap-data-security`

This roadmap follows the project owner's exact F01–F25 tracker. Those 25 phases are the canonical foundation/access/roles/licensing/journeys workboard. Later EOMS modules are organized as downstream workstreams; they do not replace or renumber F01–F25.

## Working rules

1. Work on one phase at a time. Do not begin the next phase until the current acceptance gate is evidenced or a blocker is explicitly recorded.
2. Existing code is a starting point, not automatic proof of phase completion.
3. Every phase needs a deliverable, acceptance criteria, tests where applicable, evidence and a tracker update.
4. Use feature branches and reviewed pull requests. Do not force-push or overwrite existing work.
5. A screen or mock journey is not a completed feature. Business rules, API enforcement, database behavior, failure handling, audit and tests are part of the feature.
6. Do not enable production startup or live ERP/payroll posting until security, business-rule, operational and client-acceptance gates pass.
7. Do not guess payroll multipliers, UOM precision, approval rules, data retention, license model or integration behavior. Use approved requirements and signed-off examples.

## Initial repository baseline (source review and fresh CI evidence, 15 October 2026)

- The codebase uses React + TypeScript + Vite, Express/Node + TypeScript and PostgreSQL.
- It contains migrations, a limited muster workflow, worker/task/period maintenance, gang assignments, manager review/reversal, audit/outbox records, PWA/device-draft synchronization and automated test scripts.
- `compose.yaml` provisions PostgreSQL. The README currently starts the API and web development servers in host processes, so a full containerized app environment remains to be verified/implemented.
- Current memberships use the fixed role names `manager`, `supervisor`, and `clerk`. A permission catalogue, custom role editor, licensing/seat enforcement, generic workflow engine and complete role-based task queues are not yet implemented.
- PostgreSQL forced RLS, estate membership checks, a restricted runtime role and estate-aware foreign keys exist for the current slice. This is a foundation—not complete customer/group/estate/division/block/record/field security.
- The API deliberately blocks production startup pending identity, HTTPS, tenancy and operations review.
- Existing docs describe a limited development checkpoint, not the complete EOMS scope or a production release.
- The project owner confirms the hosted demo was created within ChatGPT and has not been run externally. Direct URL retrieval returned 401 through the available inspection path; this does not establish an external deployment. The uploaded ZIP and included browser evidence are the source basis for F01. Exact hosted-render-to-repository parity is not claimed; any demo-only journey must be captured as an explicit F02 clarification rather than assumed.
- Fresh GitHub Actions run #3 passed on the working branch on 15 October 2026: [run #3](https://github.com/kunal1274/ssjns-eoms/actions/runs/38783373801). It installed dependencies, applied PostgreSQL migrations, seeded synthetic data, ran DB/domain/API/workflow tests, built the app, passed browser/PWA workflows and reported zero npm audit vulnerabilities. See [F01 audit](AUDIT-F01.md) for findings and scope limits.

## Canonical phases F01–F25

Status is maintained only in [docs/PROGRESS.md](PROGRESS.md). The table below defines the phase boundaries and acceptance gates.

### Foundation

| ID | Phase | Acceptance gate |
|---|---|---|
| F01 | Source code audit | Repository, hosted source, code, schema, configuration and test evidence are reviewed; existing, partial and missing behavior are documented. |
| F02 | Requirements traceability | Each in-scope requirement from approved source documents and demo journeys maps to a module, acceptance rule, implementation status and test/evidence. |
| F03 | Architecture conventions | Architecture decisions and conventions are documented for module boundaries, API contracts, validation, errors, migrations, logging, tests, tenancy and integrations. |
| F04 | Docker environment | A clean, documented setup starts the agreed application/services, waits for health checks, applies migrations and seeds synthetic data; persistence and reset behavior are clear. |
| F05 | Automated quality checks | Pull-request CI runs type checks, formatting/linting as adopted, unit/API/integration/browser tests, build and dependency/security checks; failures block acceptance. |

### Access control

| ID | Phase | Acceptance gate |
|---|---|---|
| F06 | Customer hierarchy | Customer/group/company/estate/division/block hierarchy, ownership and inheritance are defined and enforced in the data model. |
| F07 | Authentication and sessions | Sign-in/out, session expiry/revocation, CSRF, secure cookies, recovery and required production identity controls pass negative tests. |
| F08 | User lifecycle | Authorized user creation/invitation, activation, suspension, deactivation/reactivation and revocation behave consistently and are audited. |
| F09 | Permission catalogue | Stable resource/action/module permission keys are defined, documented and versioned; display labels are not used as security identifiers. |
| F10 | Role data model | Standard/custom roles, scoped assignments, effective dates and multi-role resolution are supported without implicit global access. |
| F11 | Authorization engine | A centralized server-side authorization service checks actor, action, resource, scope, workflow state and license; direct API calls cannot bypass it. |
| F12 | Record-level access — including data-level security | API and database policies enforce customer/company/estate/division/block/record scope and applicable field-level restrictions; tenant-aware constraints, least-privilege DB identities, fail-closed pooled context, scoped searches/exports/attachments, and cross-scope negative tests pass. |
| F13 | Separation of duties | Prohibited self-approval/conflicting assignments, delegation and expiry rules are configurable as approved and enforced server-side. |

**F12 is a cross-cutting security gate, not just a UI feature.** Data must be protected on direct API requests, database queries, search, reports, exports, file downloads, offline sync, background jobs and integration paths. PostgreSQL RLS supplements—rather than replaces—API authorization and independent security review.

### Role administration

| ID | Phase | Acceptance gate |
|---|---|---|
| F14 | Role templates | Least-privilege standard templates are documented for platform/customer/group/estate and operational roles; assignments respect hierarchy and scope. |
| F15 | Custom role creation | Authorized customer admins can create, clone, edit and deactivate custom roles without code changes or granting permissions they do not own. |
| F16 | Permission editor | Module/resource/action permissions and data scopes can be reviewed and changed with validation and clear impact display. |
| F17 | Publishing and audit | Role changes have draft/publish/version/history behavior; sensitive changes are attributable and effective as designed. |
| F18 | Role preview and testing | Admins can preview a role's menus/actions/data scope; automated tests prove preview agrees with server-side authorization. |

### Licensing

| ID | Phase | Acceptance gate |
|---|---|---|
| F19 | License model | Customer plans define purchased modules/features, limits, validity and status; commercial rules are configurable and approved. |
| F20 | User seats | Named/concurrent/mixed seat model is explicitly decided; allocation, release and capacity calculations are tested. |
| F21 | Entitlement enforcement | API and UI enforce module/feature entitlements and limits; a user cannot self-enable an unpurchased feature or exceed contracted capacity. |
| F22 | Expiry and renewal | Expiry warnings, grace periods, renewal, suspension and restoration follow approved contract rules and preserve existing records. |

### User journeys

| ID | Phase | Acceptance gate |
|---|---|---|
| F23 | Workflow engine | Reusable workflow states/transitions, approvers, delegation, reasons, exceptions and correction lineage are enforced server-side and audited. |
| F24 | Dashboards and task queues | Each role sees permitted menus, dashboards, pending tasks, approvals, exceptions and next actions within its assigned data scope and license. |
| F25 | End-to-end journey test | Persona × permission × scope × license × workflow scenarios cover successful journeys and unauthorized/bypass attempts; results are repeatable in CI. |

## Data-level security acceptance checklist

These controls are included in F12 and must also inform F02–F05 and all module implementations:

- Default deny; do not trust tenant or scope identifiers supplied by the browser.
- Enforce authorization in the API and database, using least-privilege runtime identities and forced RLS where appropriate.
- Model customer → group/company → estate → division → block ownership and explicit access inheritance.
- Apply transaction-local actor/tenant/scope context to pooled database connections; missing context must fail closed and context must never leak across requests.
- Protect relationships with tenant/scope-aware foreign keys and constraints.
- Separate access to sensitive fields such as personal, wage, bank and payroll information.
- Apply scope to detail, list, search, reports, exports, attachments, offline synchronization, background jobs and integration adapters.
- Restrict audit-log visibility and retention according to an approved policy; log sensitive access without logging secrets.
- Test cross-customer, cross-estate, cross-block, IDOR, privilege escalation, pooled-context leakage and unauthorized field disclosure using the restricted runtime role.
- Complete a threat model and security review before production acceptance. RLS alone is not a security certification.

## Work after F01–F25: complete EOMS product scope

These workstreams start after the foundation gates and are delivered incrementally in the same repository and shared data model.

1. **Master data and workforce:** calendars, periods/day types, UOM and precision, OT/rates/activity masters, worker and HR references, effective-dated gang/team membership, borrowed-worker ownership, block/task/resource assignment, controlled imports.
2. **Field capture and checkroll:** daily muster/attendance, work quantities, secure offline capture and sync, wage/rate/OT/incentive/allowance/deduction rules, exception queues, review, close, correction/reversal lineage and payroll reconciliation.
3. **Planning and estate operations:** Gantt/work plans, planned-vs-actual, crop estimates, rainfall, inspections/corrective actions, chemicals/PPE/weather controls.
4. **Materials, fleet and weighbridge:** request/approval/issue/return/consumption/stock reconciliation; fleet utilization, breakdowns and maintenance; weighbridge/mill matching and exception handling.
5. **Reporting and analytics:** role- and scope-secured dashboards, operational reports, exports, trends and agreed analytics/AI use cases.
6. **Enterprise integration:** approved SAP Business One, HR/payroll and finance migration adapters, with ownership rules, versioned contracts, idempotency, retries, acknowledgements, outbox dispatch and reconciliation. No live posting before acceptance.
7. **Production readiness:** production identity/HTTPS/secrets, monitoring/alerting, encrypted backups and restore rehearsal, performance/load testing, migration/cutover rehearsal, security gate, UAT/training/pilot, release/rollback and support handover.

### Production Definition of Done

A feature is not complete merely because a screen renders. Its evidence must include:

- source requirement and acceptance criteria;
- persisted data model/migrations and server-side validation;
- permission, license and record-scope enforcement;
- workflow and approval behavior where applicable;
- audit and error/retry/conflict behavior;
- automated positive and negative tests;
- successful build/CI and documented verification evidence;
- operational notes, migration/rollback considerations and user acceptance where relevant.

## Current next action

**F01 is Complete as a source-audit phase** with fresh CI evidence; this does not close its recorded security findings or establish production readiness. **F02 — Requirements Traceability is In progress** in [docs/TRACEABILITY-F02.md](TRACEABILITY-F02.md). Complete the requirement-to-code/test/evidence links and explicitly record owner/client decisions before starting F03. Do not claim exact hosted-demo/repository parity where the rendered artifact has not been independently inspected.

No phase is marked complete by this plan alone.
