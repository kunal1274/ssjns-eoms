# F02 — Requirement-to-Journey Crosswalk (Draft)

**Status:** Draft traceability aid; REQ-* and JRN-* identifiers are proposed and require owner review.  
**Review date:** 16 October 2026  
**Branch:** `planning/production-roadmap-data-security`  
**Related documents:** [Requirement catalogue](F02-REQUIREMENT-CATALOGUE.md) · [Persona journey register](F02-PERSONA-JOURNEYS.md) · [Source-to-test map](SOURCE-MAP-F02.md) · [Traceability matrix](TRACEABILITY-F02.md) · [Decision recommendations](F02-DECISION-RECOMMENDATIONS.md)  
**CI evidence:** [Run #47](https://github.com/kunal1274/ssjns-eoms/actions/runs/38839251289) passed on commit `cddd761b9c7aba0b93563c96a42de2c1f28a4682`; this run includes the crosswalk and linked F02 documentation. It does not imply owner acceptance.

## Purpose

This crosswalk makes the draft catalogue auditable across requirements, persona journeys and current implementation evidence. It intentionally distinguishes:

- **Current evidence** — code/test evidence for behavior that exists in the reviewed repository.
- **Gap** — missing behavior, insufficient evidence, or a decision-dependent requirement.
- **Owner review** — confirmation that the requirement and journey actually belong in the approved scope.

A journey link does not imply that every related requirement is implemented. The `CAP-*` keys and linked line anchors in [SOURCE-MAP-F02.md](SOURCE-MAP-F02.md) are current-slice evidence, not owner-approved business requirements. Passing CI validates the existing code/test scope only.

## Crosswalk

| Draft requirement | Related candidate journeys | Current source/test evidence | Gap / required next action |
|---|---|---|---|
| REQ-FND-01 | JRN-06–JRN-16 (where implemented) | [F01 audit](AUDIT-F01.md); [source-to-test map](SOURCE-MAP-F02.md) | Audit phase is complete, not production certification; findings remain assigned to later phases. |
| REQ-FND-02 | JRN-01–JRN-16 | [Traceability matrix](TRACEABILITY-F02.md); this crosswalk | Owner must approve the requirement IDs, journey inventory and coverage; signed external requirement source not yet mapped. |
| REQ-FND-03 | JRN-01–JRN-16 | Repository structure and README, summarized in [source map](SOURCE-MAP-F02.md) | Accepted architecture conventions/ADRs are missing; F03 must wait for F02 acceptance. |
| REQ-FND-04 | JRN-10, JRN-13, JRN-16 | [Deployment trace CAP-DEPLOY-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Compose provisions PostgreSQL only; full application Docker setup, health/readiness, migration sequencing and recovery docs are missing. |
| REQ-FND-05 | JRN-01–JRN-16 | [CI/source map](SOURCE-MAP-F02.md); [latest verified run #38](https://github.com/kunal1274/ssjns-eoms/actions/runs/38794452660) for the previous docs baseline | Latest decision-recommendation docs need CI verification; formal required-check/branch-protection policy remains open. |
| REQ-TEN-01 | JRN-02, JRN-12, JRN-16 | DEC-01 in [owner decisions](F02-OWNER-DECISIONS.md); [CAP-SCOPE-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Full customer/group/legal-company/division/field/block model and effective-dated attribution are not implemented. |
| REQ-TEN-02 | JRN-01, JRN-02, JRN-06, JRN-07, JRN-10, JRN-12, JRN-13, JRN-14, JRN-16 | [CAP-SCOPE-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace); RLS integration tests | Current isolation is mainly estate membership; hierarchy inheritance, pooled-connection actor switching and every data path need coverage. |
| REQ-IAM-01 | JRN-03, JRN-10 | [CAP-AUTH-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Basic local login/session controls exist; SSO/MFA/recovery/admin revocation and production policy remain undecided. |
| REQ-IAM-02 | JRN-01, JRN-03 | [CAP-AUTH-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Full invitation, provisioning, suspension/reactivation and administrative lifecycle are missing. |
| REQ-PERM-01 | JRN-04, JRN-11, JRN-14 | Current route-level role checks in [source map](SOURCE-MAP-F02.md#route-and-capability-mapping) | Stable permission catalogue and dedicated audit-read permission are missing; DEC-03 needs owner disposition. |
| REQ-ROLE-01 | JRN-02, JRN-03, JRN-04, JRN-06 | Fixed manager/supervisor/clerk roles; [CAP-SCOPE-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Custom roles, multiple scoped assignments and effective dates are missing. |
| REQ-AUTHZ-01 | JRN-04, JRN-06–JRN-16 | Current role/estate checks, workflow guards and RLS described in [source map](SOURCE-MAP-F02.md) | No unified actor/action/resource/scope/state/license evaluator; direct API and all-data-path matrix remains incomplete. |
| REQ-DATA-01 | JRN-01, JRN-02, JRN-06, JRN-07, JRN-10–JRN-13 | [CAP-SCOPE-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace), [CAP-DEPLOY-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | User/session grants, broad UPDATE grants, hierarchy-aware scope and pooled-context tests need security hardening. |
| REQ-DATA-02 | JRN-07, JRN-10–JRN-13 | [CAP-SYNC-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace), [CAP-AUDIT-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Search, exports, attachments, background jobs, integrations and field-level restrictions are not comprehensively covered. |
| REQ-SOD-01 | JRN-08, JRN-09, JRN-15 | [CAP-WORKFLOW-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Same-person review is provisional; full maker-checker, delegation and emergency override policy requires DEC-04. |
| REQ-ROLE-02 | JRN-04 | No role-template implementation found | Role templates need to be designed from the approved permission catalogue and scope model. |
| REQ-ROLE-03 | JRN-04 | No custom-role lifecycle found | Create/clone/edit/deactivate, escalation checks and versioning are missing. |
| REQ-ROLE-04 | JRN-04 | No permission editor found | Matrix UX, validation, impact preview and server-enforced persistence are missing. |
| REQ-ROLE-05 | JRN-04, JRN-11 | Operational audit exists; no role publication/version model found | Draft/publish/history/rollback and approved audit readership are missing. |
| REQ-ROLE-06 | JRN-04, JRN-14 | No role simulation/preview found | Preview must call the same policy evaluator as live requests and prove parity in tests. |
| REQ-LIC-01 | JRN-05, JRN-12, JRN-14, JRN-15 | No license/entitlement model found | Contracted modules/features/limits/effective dates require DEC-05. |
| REQ-LIC-02 | JRN-05 | No seat allocation/enforcement found | Named/concurrent/mixed seat model and concurrency rules require commercial decision. |
| REQ-LIC-03 | JRN-04, JRN-05, JRN-14, JRN-15 | No entitlement enforcement found | Server-side checks must cover direct API/service calls, not only menus. |
| REQ-LIC-04 | JRN-05 | No expiry/renewal lifecycle found | Grace, suspension, read/export, renewal and restoration behavior must be contractually approved; no grace duration is assumed. |
| REQ-WF-01 | JRN-07, JRN-08, JRN-09, JRN-13, JRN-15 | [CAP-WORKFLOW-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Muster-specific state transitions exist; generic workflow, correction lineage and integration compensation are missing. |
| REQ-UX-01 | JRN-06–JRN-08, JRN-11, JRN-12, JRN-14 | Existing muster, maintenance, gang, period and audit screens summarized in [source map](SOURCE-MAP-F02.md#route-and-capability-mapping) | Full role-specific dashboards, task queues and exception ownership are missing. |
| REQ-E2E-01 | JRN-01–JRN-16 | Existing API/unit/browser evidence in [source map](SOURCE-MAP-F02.md) | Existing tests cover only a subset; full persona × permission × scope × entitlement × state matrix and security regressions are not yet implemented. |
| REQ-MDM-01 | JRN-02, JRN-06, JRN-07 | [CAP-MASTER-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace), [CAP-GANG-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Current worker/task/period/gang basics exist; effective-dated workforce, borrowing, calendars, UOM/rates and controlled imports remain gaps. |
| REQ-CHECK-01 | JRN-07, JRN-08, JRN-09, JRN-15 | [CAP-MUSTER-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace), [CAP-WORKFLOW-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Full checkroll/payroll calculation and reconciliation depend on signed DEC-06 examples; posting remains gated. |
| REQ-PLAN-01 | JRN-02, JRN-16 | No full planning/crop/inspection/chemical/PPE/weather implementation found in reviewed slice | Detailed requirements, operating controls and role/scope tests need definition. |
| REQ-SUP-01 | JRN-16 | No full materials/fleet/weighbridge implementation found in reviewed slice | Stock/fleet/weighbridge workflows, controls and reconciliation requirements need definition. |
| REQ-REP-01 | JRN-11, JRN-12, JRN-14, JRN-15 | Limited operational lists and pagination; [CAP-AUDIT-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Consolidated reporting, exports, field-level protections and reconciliation/performance evidence are missing. |
| REQ-INT-01 | JRN-13, JRN-15 | [CAP-MUSTER-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) includes outbox; [CAP-DEPLOY-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) for runtime boundary | No dispatcher, partner adapters, acknowledgements or reconciliation; DEC-07 contracts are open. |
| REQ-OPS-01 | JRN-10, JRN-13, JRN-16 | Production startup guard and CI; [CAP-DEPLOY-01](SOURCE-MAP-F02.md#anchored-implementation-to-test-trace) | Production identity, HTTPS/secrets, monitoring, restore rehearsal, load/SLO, cutover, UAT and support acceptance remain open. |

## Acceptance workflow

1. Owner reviews each draft REQ-* and JRN-* key against the actual product scope and any signed requirements source.
2. Replace or map draft keys to approved IDs; preserve trace links if IDs change.
3. For each accepted requirement, add exact implementation/schema/API/browser/test anchors, or mark **not implemented** with a phase owner and acceptance test plan.
4. For each journey, confirm actor, scope fixture, preconditions, action, expected allow/deny result, persisted effect, audit result and recovery/conflict behavior.
5. Resolve or explicitly defer the related decision in [F02-OWNER-DECISIONS.md](F02-OWNER-DECISIONS.md), using the proposal in [F02-DECISION-RECOMMENDATIONS.md](F02-DECISION-RECOMMENDATIONS.md) only as a recommendation.
6. Obtain owner acceptance before closing F02 or starting F03.

**Current status: F02 remains in progress.** This crosswalk improves draft traceability; it is not client sign-off, implementation proof for missing capabilities, or production certification.
