# Estate Opera EOMS — Production Roadmap

**Purpose:** deliver the complete EOMS as one production-ready application, one shared repository, one governed data model and a repeatable Docker-based deployment. This roadmap is a delivery tracker, not a claim that the listed work has already been completed.

## Working rules

1. Work on one phase at a time. Do not begin the next phase until the current phase's acceptance gate is evidenced or an explicit dependency is recorded.
2. Every phase produces code or a reviewed specification, automated tests where applicable, updated documentation and a status/evidence entry.
3. A screen or mock journey is not a completed feature. Business rules, API enforcement, database behavior, failure handling, audit and tests are part of the feature.
4. Use a feature branch and pull request for each implementation change. Do not force-push or replace existing work.
5. Do not enable production startup or live ERP/payroll posting until the relevant security, business-rule, operational and client-acceptance gates pass.
6. No payroll multiplier, UOM precision, approval rule, retention period, license model or integration behavior is to be guessed. Confirm it from the approved source documents and client examples.

## Initial repository baseline (reviewed 15 October 2026)

Repository: [kunal1274/ssjns-eoms](https://github.com/kunal1274/ssjns-eoms)

- The repository already contains a React/TypeScript + Express/Node + PostgreSQL foundation, Docker Compose for PostgreSQL, migrations, tests, a PWA shell and device-draft synchronization.
- Existing documentation records a limited muster workflow and local automated/browser verification. This is not proof of a production release or of a full EOMS implementation.
- The database foundation already uses a restricted PostgreSQL runtime role, forced row-level security (RLS), estate-membership checks and estate-aware foreign keys for the current slice.
- The current initial role model is limited to manager/supervisor/clerk. Custom roles, full permission catalogue, division/block-level data scope, licensing and the complete business module set remain future work.
- Production startup is deliberately gated in `apps/api/src/server.ts` pending identity, HTTPS, tenancy and operations review.
- The hosted demo is reported to be at v8, but the hosted site's source could not be retrieved through the current tool session. The hosted demo and this repository must therefore be reconciled before we can claim that v8 has been imported. Do not overwrite the existing repository with an assumed export.

**Current state:** remote source review is underway; full local execution, security verification and hosted-demo/source reconciliation are not yet complete.

## Status vocabulary

- **Not started** — work has not begun.
- **In progress** — implementation or review has begun, but acceptance evidence is incomplete.
- **Blocked** — a dependency, access item or business decision prevents progress.
- **Ready for testing** — implementation is ready for its acceptance checks.
- **Complete** — acceptance criteria passed and evidence is recorded.

## Phase plan

### A. Source reconciliation and engineering foundation

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P01 | Obtain hosted-demo source/export | Source export or project-access path for the reported v8 site | Source files are available and provenance/version are recorded; otherwise keep this phase blocked and do not claim source parity |
| P02 | Audit the current repository | File map, architecture, migrations, routes, UI, tests and known gaps | Findings are written down with reusable, incomplete and missing areas separated |
| P03 | Build requirement traceability | Source requirement → module → implementation → test mapping | Every in-scope requirement has a unique reference and an acceptance method |
| P04 | Record architecture decisions | ADRs for tenancy, data ownership, identity, deployment, integration and offline behavior | Decisions and unresolved client choices are explicit; no silent assumptions |
| P05 | Reproducible Docker development | App, API, PostgreSQL and required services in a documented local setup | Clean setup, health checks, migrations and synthetic seed work from instructions |
| P06 | Automated quality baseline | Type-check, lint/format, unit/API/integration tests, build and CI | CI runs on pull requests; failures block acceptance |

### B. Organization, identity and user lifecycle

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P07 | Tenant and organization hierarchy | Customer/group, company, estate, division, block and other approved units | Parent-child relationships and ownership rules are documented and constrained |
| P08 | Authentication and sessions | Secure sign-in/out, session expiry, password reset and CSRF protection | Invalid, expired and revoked sessions cannot access protected APIs |
| P09 | User lifecycle | Invite/create, activate, suspend, deactivate and reactivate users | Status changes revoke access according to documented session rules |
| P10 | User-to-organization assignment | Users assigned to permitted customers, estates and organizational scopes | An assignment cannot grant access outside the administrator's own authority |

### C. Data-level security — mandatory cross-cutting workstream

Data-level security is not the same as hiding a menu or checking a role in React. It must be enforced at API and database layers, including background jobs, search, exports and integrations.

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P11 | Data classification and access matrix | Classify public, operational, confidential and highly sensitive fields; map roles and scopes | Each data category has an owner, permitted readers/writers and retention decision or an explicit open question |
| P12 | Database runtime identities and grants | Least-privilege migration/admin/runtime roles; no app superuser or RLS bypass | Runtime identity cannot own protected tables, bypass RLS or perform ungranted actions |
| P13 | Tenant/company row-level security | RLS policies and forced RLS for tenant-owned tables | Cross-customer read/write attempts fail at the database layer, including direct SQL under the app runtime role |
| P14 | Estate/division/block row-level scope | RLS and query scope for assigned estates and approved lower-level units | Users can access only the rows allowed by their current assignments; changing URL/IDs cannot widen scope |
| P15 | Worker, gang and assignment data scope | Rules for worker visibility, gang assignment, borrowed workers and historical access | Current and historical access follows approved ownership and effective-date rules |
| P16 | Connection-pool context isolation | Set actor/tenant/scope context transaction-locally and reset it safely for pooled connections | Context never leaks between requests or users; missing context fails closed |
| P17 | Cross-scope referential integrity | Composite foreign keys/constraints for tenant and organizational ownership | Records cannot link a worker, task, block or transaction from a different unauthorized scope |
| P18 | Sensitive-field protection | Field/property-level access for wage, payroll, bank, personal and other classified data | Unauthorized API responses, searches, logs and exports do not disclose protected fields |
| P19 | Secure list, search, export and attachment access | Scope-aware pagination, filters, reports, file URLs and download authorization | Data scope remains enforced on all read surfaces, not only detail pages |
| P20 | Background jobs and integration identities | Explicit service identities and narrow scopes for jobs, sync and ERP connectors | A background process cannot silently run with unrestricted user or database privileges |
| P21 | Audit integrity, access and retention | Auditable access/permission changes and sensitive actions; retention and purge rules | Audit access is restricted, changes are attributable, and retention behavior is approved and tested |
| P22 | Data-security regression suite | Cross-tenant, cross-estate, lower-scope, field-redaction, pooled-context and privilege-escalation tests | Negative tests prove forbidden access is denied; CI executes them on every relevant change |
| P23 | Security review and threat model | Review tenant escape, IDOR, privilege escalation, injection, export leaks, backups and secrets | Findings are fixed or explicitly accepted with owner and risk; no critical/high blocker remains for the release |

**Data-security design constraints:** default deny; authorization on the server; database-enforced row scope; least-privilege identities; tenant-aware foreign keys; fail-closed behavior when context is missing; no trust in client-supplied tenant IDs; sensitive-field minimization; and automated negative tests. PostgreSQL RLS is an additional enforcement layer, not a substitute for API authorization or independent security review.

### D. Configurable roles and permissions

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P24 | Permission catalogue | Stable permission keys by module, resource and action | Permissions are documented and are not based only on display labels |
| P25 | Role/permission data model | Standard roles, custom roles, assignments, scope and effective dates | A user can have multiple governed assignments without implicit global access |
| P26 | API authorization middleware | Central permission checks for actions and resources | Direct API calls cannot bypass missing permissions |
| P27 | Standard role templates | Initial platform, group, estate, field, checkroll, store, fleet, auditor and viewer templates | Templates are documented and least-privilege by default |
| P28 | Custom role editor | Create/clone roles; grant/revoke module and action permissions | Authorized admins can change roles without source-code changes |
| P29 | Role publishing and version history | Draft/review/publish, change comparison and audit | Sensitive role changes are attributable and effective according to defined rules |
| P30 | Role preview and access simulation | Preview navigation, actions and data scope for a selected user/role | Preview agrees with server authorization tests; it is not a security bypass |
| P31 | Separation of duties and delegation | Prevent conflicting create/approve combinations where policy requires; time-bound delegation | Prohibited self-approval and expired delegation are rejected server-side |

### E. Customer licensing and feature entitlements

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P32 | License/plan model | Customer plans, modules, feature entitlements, limits and validity | Commercial plan structure is configurable and not hard-coded into business modules |
| P33 | User-seat model | Named/concurrent/mixed licensing as confirmed; seat assignment and release | Capacity is calculated consistently; commercial model is signed off before enforcement |
| P34 | Runtime entitlement enforcement | API and UI checks for modules/features and limits | Direct URLs/API calls cannot access an unlicensed feature |
| P35 | Expiry, renewal and suspension | Expiry warnings, grace policy, renewal and controlled restoration | Expiry behavior follows approved contract rules and does not corrupt existing records |
| P36 | License administration audit | Authorized vendor/customer actions and history | Customer admins cannot grant themselves unpurchased modules or exceed contractual limits |

### F. User journeys, workflow and notifications

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P37 | Workflow state model | Reusable states and allowed transitions | Invalid transitions are rejected server-side and recorded |
| P38 | Approval rules | Configurable approvers, delegation, thresholds and separation-of-duties checks | Each transition is authorized by role, scope, license and business state |
| P39 | Role-based task inbox | Assigned work, pending approvals, blocked items and exceptions | Each user sees only tasks they may act on and relevant next steps |
| P40 | Notifications and escalation | In-app/email or approved channels, retries and delivery records | Failed notification delivery is visible and cannot change transaction state |
| P41 | End-to-end journey harness | Persona × permission × scope × journey × test matrix | Authorized completion and unauthorized bypass paths are both tested |

### G. Master data and workforce

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P42 | Calendar, periods and day types | Estate calendar, holidays, rest days, overrides, lock/reopen rules | Effective dates, versioning and period locks are consistent across modules |
| P43 | UOM, OT, rates and activity masters | UOM conversions/precision, OT codes, day types, job/activity/rate masters | Rules match approved examples and effective-date requirements |
| P44 | Worker roster and HR references | Worker status, grades and external HR identifiers | HR ownership and sync/reconciliation rules are explicit |
| P45 | Gangs, teams and worker membership | Supervisor assignment, effective-dated membership and borrowed-worker ownership | Ownership, attendance, payment responsibility and historical records are unambiguous |
| P46 | Block/task/resource assignment | Work allocation and approved assignment percentages | Assignments respect hierarchy, capacity and data scope |
| P47 | Import and master-data validation | Controlled CSV/XLSX import, row-level errors and deduplication | Invalid rows are rejected with reasons and do not partially corrupt data |

### H. Field capture and checkroll

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P48 | Daily muster/attendance capture | Attendance, day type, activity, block, gang, worker and work quantity | Validations and assignments are enforced for online and synced records |
| P49 | Offline capture and sync hardening | Durable device drafts, safe retry, conflict handling and recovery | Lost responses do not duplicate records; conflicts remain visible; security limits are tested |
| P50 | Wage calculation engine | Daily/piece wages, OT, incentives, allowances and deductions per approved rules | Golden payroll examples reconcile within signed-off tolerances |
| P51 | Checkroll validation and exception queue | Missing attendance, rate/UOM errors, unusual values and duplicates | Blocking errors cannot be bypassed without authorized resolution |
| P52 | Month close, approval and reversal | Review, approval, lock, correction lineage and controlled reopening | Closed periods are immutable except through an approved auditable correction path |
| P53 | Payroll handoff and reconciliation | Versioned export/API, receipt, retry, idempotency and variance queue | Approved totals reconcile; failures and duplicates are recoverable and traceable |

### I. Estate operations modules

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P54 | Planning and Gantt | Work plans, schedule, capacity/man-days and planned-versus-actual | Plans and execution reference the same master records |
| P55 | Crop estimate and rainfall | Estimates, observations, actual yield and trend data | Units, dates, source and correction history are traceable |
| P56 | Inspection and corrective action | Checklists, severity, evidence, owner, due date and closure | High-severity findings escalate and cannot be silently closed |
| P57 | Chemical, PPE and weather controls | Application records, PPE checks, warnings and authorization | Required safety controls are validated and auditable |
| P58 | Materials lifecycle | Request, approval, issue, return, consumption and stock reconciliation | EOMS/SAP ownership is explicit and quantities reconcile end-to-end |
| P59 | Fleet and maintenance | Equipment, utilization, breakdown, work order, inspection and closure | A fault can be traced through repair, cost and closure evidence |
| P60 | Weighbridge and mill reconciliation | Ticket ingestion, matching, duplicate detection and exceptions | Matched/unmatched/disputed tickets reconcile without duplicate posting |

### J. Reporting, integrations and production rollout

| ID | Small phase | Deliverable | Acceptance gate |
|---|---|---|---|
| P61 | Operational reports and exports | Role-scoped dashboards, filters, XLSX/PDF and report definitions | Totals reconcile to source records and exports preserve data security |
| P62 | SAP Business One adapter | Approved material, procurement, asset or finance interfaces as scoped | Contract/schema, retries, idempotency, acknowledgement and reconciliation tests pass |
| P63 | HR/payroll adapter | Employee reference sync and approved checkroll handoff | Ownership, conflict resolution and payroll reconciliation are signed off |
| P64 | Finance migration and reconciliation | Mapping, control totals, exception handling and cutover evidence | Finance owner approves mapping and reconciliation results; no silent posting |
| P65 | Nursery/workshop/works-contract scope decision | Explicit inclusion/exclusion and requirements for legacy extensions | Client signs off scope before implementation estimates are committed |
| P66 | Production identity and access operations | Approved identity provider, MFA/SSO where required, provisioning and revocation | Production identity and emergency-access paths are tested |
| P67 | Observability and support runbooks | Structured logs, metrics, alerts, health checks and incident procedures | Failures are diagnosable without logging secrets or sensitive data |
| P68 | Backup and recovery | Encrypted backups, restore rehearsal, retention and recovery targets | Restore is demonstrated against approved RPO/RTO targets |
| P69 | Performance and capacity | Representative load tests, query plans, indexing and concurrency checks | Agreed workload and SLO targets pass; no untested million-record claim |
| P70 | Security and release gate | Dependency scan, code review, authorization/RLS tests, configuration and secret checks | No open critical/high release blocker; accepted residual risks have owners |
| P71 | Migration and cutover rehearsal | Data profiling, mapping, dry run, reconciliation and rollback | Rehearsal results are approved before production migration |
| P72 | UAT, training and pilot | Role-based test scripts, training, issue log and pilot-estate sign-off | Business owners sign off journeys and known limitations |
| P73 | Production deployment and rollback | Versioned release, controlled migrations, smoke tests and rollback plan | Deployment and rollback are rehearsed; production startup gate is removed only after approval |
| P74 | Post-launch support and handover | Support ownership, monitoring, incident escalation and enhancement backlog | Operational owner accepts the handover and outstanding work is tracked |

## How to close a phase

A phase is complete only when:
- its agreed deliverable exists in the shared repository;
- acceptance criteria and negative/security cases pass;
- automated test and CI evidence is recorded;
- docs and this tracker are updated;
- code is reviewed and merged through the agreed pull-request process; and
- no unresolved dependency is being represented as completed.

## Immediate next actions

1. **P01 — Obtain/reconcile the hosted v8 source.** The current tool session could not retrieve the hosted site source. Provide a source export/project ZIP or enable the project-edit/export session so the actual hosted source can be reconciled without guessing.
2. **P02 — Finish the repository audit.** Run the documented Docker, migration, API, browser, build and security checks in a controlled local environment; record what passes now.
3. **P03 — Trace requirements.** Map the EOMS source documents to the existing code and the remaining phases above.
4. **P04/P05/P06 — Resolve decisions and lock the repeatable engineering baseline.**
5. Begin identity and data-security implementation only after the current database context, role model and tenancy assumptions have been verified.

No phase is marked complete by this plan alone.
