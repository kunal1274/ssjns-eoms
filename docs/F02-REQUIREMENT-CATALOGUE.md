# F02 — Requirement Catalogue

**Status:** Owner-accepted planning/traceability baseline on 16 October 2026; implementation evidence and customer-specific requirements remain phase-gated.  
**Review date:** 16 October 2026  
**Branch:** `planning/production-roadmap-data-security`  
**Related artifacts:** [Traceability matrix](TRACEABILITY-F02.md) · [Source-to-test map](SOURCE-MAP-F02.md) · [Persona journey register](F02-PERSONA-JOURNEYS.md) · [Owner decision register](F02-OWNER-DECISIONS.md) · [Decision recommendations](F02-DECISION-RECOMMENDATIONS.md) · [Requirement-to-journey crosswalk](F02-REQ-JOURNEY-CROSSWALK.md) · [Journey-to-evidence map](F02-JOURNEY-EVIDENCE-MAP.md)  
**CI evidence:** [Run #38849671680](https://github.com/kunal1274/ssjns-eoms/actions/runs/38849671680) passed on the F02 owner-acceptance commit. CI validates repository checks, not implementation of missing requirements.

## How to use this catalogue

The project owner supplied the canonical F01–F25 phase IDs and the [production roadmap](PRODUCTION-ROADMAP.md). This catalogue assigns `REQ-*` identifiers to make individual acceptance obligations traceable. On 16 October 2026 the owner accepted the current 34 identifiers and acceptance statements as the planning baseline; see [F02 owner acceptance](F02-OWNER-ACCEPTANCE.md). These analyst-authored traceability statements are not a substitute for a signed customer requirements specification.

“Current evidence” points to the implementation map where possible. Existing code or a passing test proves only the behavior described; it does not satisfy an entire requirement by implication. The planning baseline is accepted, but each requirement's present/partial/missing status remains authoritative. Accepted product defaults and implementation/production guards are summarized in [F02-DECISION-RECOMMENDATIONS.md](F02-DECISION-RECOMMENDATIONS.md).

## Foundation and delivery requirements

| Draft requirement ID | Source / phase | Testable acceptance statement | Current evidence / status |
|---|---|---|---|
| REQ-FND-01 | [F01 audit gate](PRODUCTION-ROADMAP.md#canonical-phases-f01f25) | Inventory code, schema, configuration, tests, documentation, limitations and security findings; distinguish verified, partial, missing and decision-dependent behavior. | Audit recorded in [AUDIT-F01.md](AUDIT-F01.md); F01 closed as audit only. |
| REQ-FND-02 | [F02 traceability gate](TRACEABILITY-F02.md#f02-completion-gate) | Every accepted planning-baseline requirement and in-scope journey links to acceptance criteria, implementation/schema evidence where present, tests where present, explicit gaps and unresolved decisions. | Baseline accepted; implementation evidence remains partial/missing where indicated in the crosswalk and journey evidence map. |
| REQ-FND-03 | [F03 architecture conventions](PRODUCTION-ROADMAP.md#canonical-phases-f01f25) | Accepted conventions cover module boundaries, API contracts, validation/errors, migrations, logging, tenancy, tests, background work and integrations. | Complete as architecture acceptance; owner accepted ADR-F03-01–09. See [F03 accepted conventions](F03-ARCHITECTURE-CONVENTIONS.md). |
| REQ-FND-04 | [F04 Docker environment](PRODUCTION-ROADMAP.md#canonical-phases-f01f25) | A clean documented setup starts the agreed app/services, waits for health, applies migrations, seeds synthetic data, persists state and explains reset/recovery. | Complete for the shared Docker environment; [passing F04 evidence](F04-DOCKER-ENVIRONMENT.md#verified-execution-record). Production acceptance is separate. |
| REQ-FND-05 | [F05 automated checks](PRODUCTION-ROADMAP.md#canonical-phases-f01f25) | Required PR checks fail closed on type/build/unit/API/integration/browser/security failures and adopted lint/format checks; evidence and branch protection are documented. | Blocked on administrator enforcement: safe errors/correlation, disclosure tests, formatting, digest pins and aggregate gate passed fresh CI. [F05 evidence and remaining policy](F05-QUALITY-GATES.md). |

## Tenancy, identity and access requirements

| Draft requirement ID | Source / phase | Testable acceptance statement | Current evidence / status |
|---|---|---|---|
| REQ-TEN-01 | [F06 hierarchy](PRODUCTION-ROADMAP.md#access-control); DEC-01 | Tenant, legal/financial hierarchy and plantation operating hierarchy are modeled separately; optional levels and responsible-company attribution are configurable and auditable. | Partial; DEC-01 baseline selected; schema lacks the full customer/group/division/block hierarchy. |
| REQ-TEN-02 | [F06/F12 inheritance](PRODUCTION-ROADMAP.md#data-level-security-acceptance-checklist); DEC-01 | Scope defaults to deny; only explicitly authorized descendant inheritance applies; no implicit sibling, upward or cross-tenant access is granted. | Partial; current estate membership/RLS is narrower than required hierarchy-aware scope. |
| REQ-IAM-01 | [F07 identity/session](PRODUCTION-ROADMAP.md#access-control); DEC-02 | Authentication, secure sessions, expiry/revocation, CSRF/origin protection, recovery and approved production identity controls pass positive and negative tests. | Partial; local password/session/CSRF controls exist; the OIDC/MFA/session product default is accepted, while customer identity-provider configuration and production verification remain outstanding. |
| REQ-IAM-02 | [F08 user lifecycle](PRODUCTION-ROADMAP.md#access-control); DEC-02 | Authorized admins can invite/provision, activate, suspend, deactivate/reactivate and revoke users; protected actions cease within an approved revocation interval; changes are audited. | Missing beyond basic active/session checks. |
| REQ-PERM-01 | [F09 permission catalogue](PRODUCTION-ROADMAP.md#access-control); DEC-03 | Stable, versioned resource/action/module permission keys are documented and do not depend on display labels or role names. | Missing; current authorization uses fixed role strings and route checks. |
| REQ-ROLE-01 | [F10 role model](PRODUCTION-ROADMAP.md#access-control); DEC-03 | Standard/custom roles, scoped assignments, effective dates and multi-role resolution are deterministic, auditable and do not create implicit global access. | Partial; estate memberships use fixed manager/supervisor/clerk roles. |
| REQ-AUTHZ-01 | [F11 authorization engine](PRODUCTION-ROADMAP.md#access-control); DEC-03/05 | One server-side policy path evaluates actor, action, resource, scope, workflow state and license; direct API calls cannot bypass it. | Partial; route-level role/estate checks exist, no central permission/license evaluator. |
| REQ-DATA-01 | [F12 database and field security](PRODUCTION-ROADMAP.md#data-level-security-acceptance-checklist); DEC-01/03 | Restricted DB identity, forced RLS where appropriate, tenant-aware relationships, fail-closed actor/tenant/scope context and least-privilege grants prevent unauthorized rows and fields. | Partial/high priority; estate-level RLS exists; user/session grants, broad UPDATE grants, hierarchy scope and pooled-context tests need work. |
| REQ-DATA-02 | [F12 all data paths](PRODUCTION-ROADMAP.md#data-level-security-acceptance-checklist) | The same approved scope and field policy covers detail/list/search/reports/exports/attachments/offline sync/background jobs/integrations; negative tests include IDOR, cross-tenant, cross-estate/block and reused pooled connections. | Partial; current API/RLS/sync tests cover only a subset. |
| REQ-SOD-01 | [F13 separation of duties](PRODUCTION-ROADMAP.md#access-control); DEC-04 | Approved self-approval/conflict, delegation, expiry and emergency override rules are enforced server-side with reason, actor and immutable evidence. | Partial; the maker-checker/no-self-approval product default is accepted, but current same-manager review remains provisional and the required server-side implementation/tests are missing. |

## Role administration, licensing and journeys

| Draft requirement ID | Source / phase | Testable acceptance statement | Current evidence / status |
|---|---|---|---|
| REQ-ROLE-02 | [F14 templates](PRODUCTION-ROADMAP.md#role-administration); DEC-03 | Least-privilege platform/customer/group/company/estate/operations templates have explicit permission and scope definitions. | Missing. |
| REQ-ROLE-03 | [F15 custom roles](PRODUCTION-ROADMAP.md#role-administration); DEC-03 | Authorized customer admins can create, clone, edit and deactivate roles without code changes or escalating beyond their own grant authority. | Missing. |
| REQ-ROLE-04 | [F16 permission editor](PRODUCTION-ROADMAP.md#role-administration); DEC-03 | Admins can edit module/resource/action and data scope with validation, impact preview and server-enforced persistence. | Missing. |
| REQ-ROLE-05 | [F17 publish/audit](PRODUCTION-ROADMAP.md#role-administration); DEC-03/08 | Role changes support draft/publish/version/history and attributable, immutable change evidence with approved audit readership/retention. | Missing for role configuration; operational audit exists. |
| REQ-ROLE-06 | [F18 role preview](PRODUCTION-ROADMAP.md#role-administration); DEC-03 | Role preview uses the same policy evaluator as live requests; tests prove previewed menus/actions/data match actual server decisions. | Missing. |
| REQ-LIC-01 | [F19 license model](PRODUCTION-ROADMAP.md#licensing); DEC-05 | Contracted modules/features/limits/status/effective dates are represented independently of permissions and can be audited. | Missing; the named-seat product default is accepted, but contracted modules, limits, validity and entitlement persistence remain unimplemented. |
| REQ-LIC-02 | [F20 seats](PRODUCTION-ROADMAP.md#licensing); DEC-05 | The approved named/concurrent/mixed seat model enforces allocation, release and capacity under concurrent requests. | Missing; named-user seats are the accepted default; allocation, release and concurrency enforcement are unimplemented. |
| REQ-LIC-03 | [F21 entitlement enforcement](PRODUCTION-ROADMAP.md#licensing); DEC-05 | Every protected API/service action enforces module/feature/seat entitlements; hidden menus are not treated as security. | Missing. |
| REQ-LIC-04 | [F22 expiry/renewal](PRODUCTION-ROADMAP.md#licensing); DEC-05 | Approved expiry, grace, suspension, renewal and restoration behavior is consistent and never deletes customer data as a side effect. | Missing; expiry/data-preservation guard is accepted; contract-specific expiry, grace, suspension, renewal and restoration behavior must be configured before enforcement. |
| REQ-WF-01 | [F23 workflow engine](PRODUCTION-ROADMAP.md#user-journeys); DEC-04/06/07 | Reusable workflows support approved transitions/guards, approvers, delegation, reasons, exceptions and correction lineage with versioning and audit. | Partial; muster-specific transitions exist, not a reusable engine. |
| REQ-UX-01 | [F24 dashboards/queues](PRODUCTION-ROADMAP.md#user-journeys); DEC-03/04 | Each approved persona sees only permitted menus, scoped tasks, approvals, exceptions and next actions; direct API calls enforce the same policy. | Partial; current UI covers a limited operational slice. |
| REQ-E2E-01 | [F25 journey tests](PRODUCTION-ROADMAP.md#user-journeys) | A repeatable CI matrix covers persona × permission × scope × license × workflow, including positive, negative, bypass, concurrency and recovery scenarios. | Partial; existing browser/API tests cover a subset; proposed journeys are in [F02-PERSONA-JOURNEYS.md](F02-PERSONA-JOURNEYS.md). |

## Downstream EOMS product requirements

These requirements are included in the roadmap but are not declared implemented by foundation CI.

| Draft requirement ID | Source workstream | Testable acceptance statement | Current evidence / status |
|---|---|---|---|
| REQ-MDM-01 | [Master data and workforce](PRODUCTION-ROADMAP.md#work-after-f01f25-complete-eoms-product-scope) | Worker/HR references, effective-dated rosters, borrowing/ownership, block assignment, calendars/day types, UOM/rates and controlled imports validate and preserve history. | Partial; worker/task/period/gang basics exist; full masters absent. |
| REQ-CHECK-01 | [Field capture and checkroll](PRODUCTION-ROADMAP.md#work-after-f01f25-complete-eoms-product-scope); DEC-06 | Attendance/work quantities, approved rate/OT/incentive/allowance/deduction calculations, exceptions, close/reopen, correction lineage and payroll reconciliation match signed examples. | Partial; muster/allocation exists; payroll rules and posting absent. |
| REQ-PLAN-01 | [Planning and estate operations](PRODUCTION-ROADMAP.md#work-after-f01f25-complete-eoms-product-scope) | Plans/Gantt, planned-vs-actual, crop estimates, rainfall, inspections, corrective actions and chemical/PPE/weather controls persist and respect scope. | Not found in reviewed current slice. |
| REQ-SUP-01 | [Materials, fleet and weighbridge](PRODUCTION-ROADMAP.md#work-after-f01f25-complete-eoms-product-scope) | Stock requests/issues/returns/reconciliation, fleet utilization/maintenance and weighbridge/mill exceptions have approved workflows, quantities and audit. | Not found in reviewed current slice. |
| REQ-REP-01 | [Reporting and analytics](PRODUCTION-ROADMAP.md#work-after-f01f25-complete-eoms-product-scope) | Reports/exports/analytics are scoped, reconcile to source records, protect sensitive fields and meet agreed performance requirements. | Partial; bounded operational lists exist; full reporting absent. |
| REQ-INT-01 | [Enterprise integration](PRODUCTION-ROADMAP.md#work-after-f01f25-complete-eoms-product-scope); DEC-07 | Approved SAP Business One and HR/payroll/finance interfaces use explicit authority/mappings, scoped service identities, versioned contracts, idempotent retries, acknowledgements, reconciliation and correction rules. | Partial; transactional outbox exists; no dispatcher/live adapters found. |
| REQ-OPS-01 | [Production readiness](PRODUCTION-ROADMAP.md#work-after-f01f25-complete-eoms-product-scope); DEC-08 | Production identity/HTTPS/secrets, monitoring, encrypted backup/restore, load/SLO, cutover/rollback, security review, UAT and support handover meet approved targets. | Partial/not accepted; production startup is gated; the operations-control default is accepted, but customer-approved numeric targets and operational verification are still required. |

## Baseline acceptance and change control

The project owner accepted the current 34 `REQ-*` identifiers and testable acceptance statements as the F02 planning/traceability baseline on 16 October 2026; see [F02-OWNER-ACCEPTANCE.md](F02-OWNER-ACCEPTANCE.md). The baseline is used to plan implementation and verification; it does not claim that missing features are implemented or that customer-specific rules are signed off.

- If a later source specification or customer requirement changes scope, record the source/owner/rationale and update the affected REQ statement, JRN links, evidence map, downstream phase and tests.
- Keep partial/missing implementation statuses explicit. Do not turn an accepted default into proof of implementation.
- Customer-specific hierarchy, identity, licensing, payroll, integration and operations decisions remain gated where noted.
- F02 closed after [CI run #38849671680](https://github.com/kunal1274/ssjns-eoms/actions/runs/38849671680) passed on the accepted-baseline commit. Production release remains subject to its separate security, UAT and operations gates.
