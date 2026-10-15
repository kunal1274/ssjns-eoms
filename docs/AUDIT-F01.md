# F01 — Source Code Audit (initial findings)

**Review date:** 15 October 2026  
**Repository reviewed:** `kunal1274/ssjns-eoms`  
**Branch inspected:** `main`  
**Inspected main HEAD:** `87b3f6d0a0206a704a9719c3171b4ab49bb38520`  
**Audit type:** remote source/configuration review. This is not a local test run, penetration test, or production certification.

## Executive summary

The repository is a real, connected PERN development codebase, not just a static UI. It has a persistent PostgreSQL foundation, basic session authentication, estate membership checks, row-level security (RLS), a muster workflow, worker/task/period maintenance, gang assignments, manager review/reversal, an outbox and an initial PWA/device-draft sync path.

It is nevertheless a **limited development checkpoint**, not the complete EOMS and not a production release. The README and status documents explicitly describe missing production identity, detailed data scope, licensing, configurable roles/workflows, full checkroll/payroll, live ERP/HR adapters, operations/recovery and load validation.

The reported hosted demo (v8) is a separate source surface. The current connected GitHub tooling allowed review of the repository but did not provide the hosted site's source export. Therefore source parity with the hosted demo remains unverified.

## Repository structure observed

- `apps/web`: React + TypeScript + Vite web/PWA frontend.
- `apps/api`: Express + TypeScript API.
- `packages/domain`: domain logic including worker-area allocation.
- `db/migrations`: four migrations (foundation, transaction locks, maintenance, gang/review).
- `scripts`: migrations, synthetic seed setup, database setup and browser verification.
- `tests`: domain/sync, API and workflow tests.
- `compose.yaml`: PostgreSQL service with persistent volume and health check.
- `.github/workflows/verify.yml`: automated CI workflow.

## Verified existing behavior (source-level)

1. **Muster capture:** validates date, quantity precision, unique worker IDs and bounded worker count; checks estate ownership, active workers, task capacity, gang eligibility and open period.
2. **Transactional writes:** muster creation/confirmation records audit evidence; confirmation creates an outbox event in the same transaction. Idempotency keys and version checks address retry/stale updates.
3. **Current master maintenance:** estate managers can maintain workers, task occurrences and operational periods; updates are versioned, and period locking is enforced for relevant writes.
4. **Gang workflow:** managers maintain gangs and supervisor assignments; supervisor writes check assignment at capture/confirmation.
5. **Review/reversal:** manager-only approval and reasoned operational reversal exist for the current muster slice. Documentation says same-manager confirmation/review is provisional and reversal is not an SAP/payroll correction.
6. **Authentication baseline:** password hashing, opaque session token stored as a hash, HttpOnly/SameSite cookie, eight-hour expiry, origin/CSRF checks and login rate limiting are present in API source.
7. **Database baseline:** the migrations create a restricted `eoms_app` role, enable and force RLS on the current tenant-owned tables, and use estate membership checks and estate-aware foreign keys. The API sets actor context transaction-locally before scoped queries.
8. **Offline/PWA baseline:** device drafts and explicit synchronization are documented; API responses and credentials are not included in the static service-worker cache. The documentation also notes that browser storage is not encrypted by the app and full cold-start offline identity/reference loading is not implemented.
9. **Quality automation:** unit/domain, PostgreSQL integration, browser workflows, build and dependency audit commands are configured. The latest recorded main-branch GitHub Actions run inspected was successful on 12 October 2026: [run #2](https://github.com/kunal1274/ssjns-eoms/actions/runs/38268463329). This is historical CI evidence, not a fresh run of the current planning branch.

## Gaps and items requiring follow-up

| Area | Initial finding | Required follow-up |
|---|---|---|
| Hosted v8 parity | Demo source was not available through this review path; README says published mock UI is separate. | Obtain/export source and compare screen, route, behavior and assets before importing anything. |
| Docker | Compose defines PostgreSQL, while README starts API and web in host processes. | F04 must add/validate the intended containerized application stack, health checks, migrations and persistent volumes without risking data. |
| Requirement traceability | Existing status/verification docs describe delivered slices but not a complete source-requirement-to-test matrix. | F02: trace approved source documents and demo journeys to code, acceptance rules and tests. |
| Architecture conventions | React/TS + Express/TS + PostgreSQL is established, but decisions/conventions are not yet a complete accepted architecture record. | F03: document boundaries, validation, error handling, migrations, API contracts, test patterns and ADRs. |
| Organization hierarchy | Current tables include companies, estates and estate memberships. Customer/group/division/block hierarchy is not represented end-to-end. | F06 and F12: define tenant hierarchy and access inheritance before expanding schema/policies. |
| Authentication lifecycle | Basic local login/logout and sessions exist; SSO/MFA, user invitation/provisioning, recovery, revocation and production identity are documented as open. | F07–F08: define requirements, implement and test full lifecycle. |
| Roles/permissions | Current schema constrains memberships to `manager`, `supervisor`, `clerk`; route checks are role-specific. There is no stable permission catalogue/custom-role engine/editor. | F09–F18: introduce resource/action permissions, scoped assignments, role versioning, templates, editor, preview and tests. |
| Data-level security | Existing RLS protects current estate-level rows. It does not yet express customer-admin/group/division/block scopes or field-level data classifications. | F12 must include API and DB enforcement, tenant-aware foreign keys, fail-closed context, exports/search/attachments, negative tests and independent review. |
| Audit visibility | The audit endpoint is estate-scoped, but source-level routing does not restrict it to a dedicated auditor/manager permission. | Confirm intended policy and enforce it through F09–F12; avoid exposing sensitive audit detail to every estate member by default. |
| Separation of duties | The documented development behavior allows same-manager confirmation and review; the final approval matrix is unsigned. | F13: decide and enforce no-self-approval/conflict rules and delegation if required. |
| Licensing | No plan/feature entitlement or seat enforcement model was found in the reviewed foundation. | F19–F22: agree named/concurrent seats, modules, limits, grace and expiry rules, then enforce on the server. |
| Workflow and journeys | Existing state transitions are muster-specific; no reusable workflow engine, full role-based task queue or complete EOMS journey matrix is present. | F23–F25: design configurable states/approvals/tasks and test authorized and forbidden journeys end-to-end. |
| Integrations | Outbox rows are persisted, but documentation says there is no dispatcher or live SAP/HR adapter. | Design idempotent dispatch, acknowledgement/retry, reconciliation and narrowly scoped service identities before live posting. |
| Production readiness | API startup intentionally throws in production mode pending identity, HTTPS, tenancy and operations review. | Keep the gate in place until security, monitoring, backup/restore, load, rollout and UAT gates pass. |

## Data-level security review notes

The existing database policy is a useful starting point, but it must not be treated as completed data-level security:

- Current row scope is principally **estate membership**; it is not a complete customer → group → estate → division → block policy.
- Current membership role names are fixed and are not a substitute for a permission catalogue.
- Every list, detail, search, report, export, attachment, background job and integration must apply the same authorized scope.
- Pooled PostgreSQL connections must always receive actor/scope context transaction-locally and fail closed if it is absent. Tests must prove that context cannot leak across requests.
- Cross-tenant and cross-scope relationships need database constraints as well as API validation.
- Sensitive fields (especially personal, wage, bank and payroll data) require separate read/write rules and must not leak through logs or exports.
- RLS negative tests must run as the restricted application role, not just as a database administrator.
- RLS does not replace server authorization, threat modeling or an independent security review.

## F01 disposition

**Status remains: In progress.**

The repository audit has begun and this report records the initial source-level findings. F01 is not complete because hosted v8 source reconciliation and fresh local execution evidence remain outstanding. No application code was changed as part of this initial audit.
