# Playwright journey, UI/UX and regression test plan

Owner request: 16 October 2026. Playwright is the browser automation standard for EOMS. This plan extends the accepted 16-journey baseline and the audit/feedback matrix; it does not mark unimplemented workflows as covered. Keep one PERN codebase and shared Docker environment.

## Current baseline and intended result

The repository already uses the `playwright` package with executable browser scripts. `npm run verify:browser` starts temporary API/web/PWA servers and runs capture, maintenance, review/reversal, offline sync and installability checks serially. These are partial journey evidence. The latest application-source verification before this plan was CI run [38925295750](https://github.com/kunal1274/ssjns-eoms/actions/runs/38925295750), source `d3b61c3bc9e9ff4ab4085d7d40ccaf062352c36d`; 43 unique unit/API tests plus the existing browser/PWA/Docker checks passed.

The next test infrastructure increment will adopt the Playwright Test runner (`@playwright/test`, matched to the existing Playwright version), reusable fixtures/page objects, named steps, tags, HTML/JUnit reports and failure traces. These runner features are **planned**, not installed/configured by this document. Keep the existing scripts in the quality gate until equivalent scenarios have passed in the new runner; remove duplication only with recorded parity.

## Delivery matrix

| Increment | Phase | Status | Deliverable and acceptance |
|---|---|---|---|
| Existing browser/PWA regression baseline | F05 | Implemented, partial journey coverage | Current serial scripts remain required; source evidence above |
| Journey test design and coverage rules | F05 continuation | Documented in this plan | Stable case IDs, reusable structure, positive/negative/UI/audit checks |
| Runner and reusable fixtures migration | F05 continuation after current policy gate is resolved | Planned | Matching locked runner dependency, config, independent fixture setup/cleanup, one migrated capture/review scenario, parity and CI evidence |
| Customer/identity/role/scope scenarios | F06–F18 alongside implementation | Planned | Every new feature ships with allowed and denied actor/scope cases; no phase closes solely on UI visibility |
| License/seat/expiry scenarios | F19–F22 alongside implementation | Planned | Contract-configured boundary cases and API parity |
| Workflow and guided task scenarios | F23–F24 | Planned | Complete handoffs, correction lineage, next actions and audit/feedback acceptance |
| Full release regression and persona acceptance | F25 | Planned | Every accepted journey has linked executed evidence or an explicit approved scope decision; unresolved critical coverage blocks release |

Main branch now reports protected and the active ruleset targets the default branch. At this review it only enforces deletion and force-push restrictions. Required PR review, `quality-gate`/up-to-date checks, resolved conversations and linear history remain missing; F05 remains Blocked and F06 Not started. Test planning does not waive that dependency.

## Reusable organization

Proposed structure (not created yet):

- `tests/e2e/fixtures/`: isolated synthetic customer/estate/user/role/license data, authenticated contexts, clock and offline helpers.
- `tests/e2e/pages/`: sign-in, navigation, master maintenance, muster, device queue, audit and later administration components. Page objects express reusable interactions; scenario assertions stay visible in the test.
- `tests/e2e/journeys/`: scenario files named with stable journey IDs, for example `jrn-07-work-capture.spec.ts`.
- `tests/e2e/support/`: deterministic test data, state/audit probes, API denial helpers and cleanup utilities.
- `playwright.config.ts`: project/browser/viewport matrix, timeouts, reporting and artifact policy; CI commands documented beside it when implemented.

Use accessible roles/labels first and stable test IDs only where necessary. Avoid positional selectors, arbitrary sleeps and repeated sign-in/form code. Use web-first assertions, response/event waits and explicit test steps so a failure identifies the business action. A test must run alone, in a group and against a clean database without relying on another test's leftover state.

## Scenario template

Each case records:

| Field | Example / rule |
|---|---|
| ID and traceability | `E2E-JRN-07-001`; link actual REQ-* IDs from the accepted crosswalk |
| Persona and scope | Assigned supervisor, selected customer/estate/gang; explicit license/workflow state |
| Preconditions | Synthetic active worker/task, open period, assigned gang; fixture owns all IDs |
| Given / When / Then | Capture valid work → save draft → persisted record with conserved allocation |
| Guided journey | User can identify starting screen, required fields, current state and next permitted action |
| Feedback | Success/error/info severity, plain message, recovery action, valid support reference on failure |
| Persistence/audit | Assert committed state plus one corresponding immutable event and request correlation where applicable |
| Boundary variants | Other estate/customer, unassigned user, stale version, invalid references, revoked access, unlicensed action |
| Evidence | Commit, CI run, browser/project, case ID, pass/fail and bounded artifact links |
| Coverage status | Planned, partial or verified; skipped/unimplemented cases never count as verified |

## Journey coverage inventory

All rows need normal, negative, recovery, UI/UX and audit assertions where relevant. Existing evidence means a slice only.

| Journey | Current browser evidence | Additional required scenarios |
|---|---|---|
| JRN-01 Tenant provisioning | None | Initial administrator, duplicate/invalid provisioning, tenant isolation and failure recovery |
| JRN-02 Hierarchy | None | Legal/operational hierarchy setup, invalid parents/cycles, effective changes and scoped navigation |
| JRN-03 User lifecycle | Partial sign-in/session/logout | Invitation/recovery, MFA, suspension/revocation, expiry and safe access explanations |
| JRN-04 Custom roles | None | Create/edit/preview/publish/rollback, forbidden grants, effective access and versioned audit |
| JRN-05 Licensing | None | Assign seats/modules, capacity boundary, expiry/grace/renewal and preserved data |
| JRN-06 Masters | Maintenance browser script | Full permission/field scopes, stale versions, lifecycle and contextual validation |
| JRN-07 Work capture | Capture and offline browser scripts | Block/customer boundaries, production permission model, invalid input and retained form values |
| JRN-08 Review/reversal | Workflow browser script | Independent maker/checker, rejected/returned states, stale state and correction lineage |
| JRN-09 Correction | None | Preserve original, reasoned correction, resubmission and queue handoff without duplicate effects |
| JRN-10 Offline sync | Offline browser script | Expanded revoked-scope/storage failures, cold-start limits, safe pending/blocked recovery across devices where supported |
| JRN-11 Audit review | Summary/detail browser checks | Authorized full history, search/filter/pagination/export, sensitive-field denial and record links |
| JRN-12 Reporting | None | Scoped totals/source reconciliation, export permissions and loading/empty/error states |
| JRN-13 Integration | No complete browser journey | Outbox/receipt/retry/reconciliation UI; API/worker tests verify partner effects and exactly-once business outcomes |
| JRN-14 Task queues | Limited register/navigation | Role-specific owners, blockers, handoffs, deadlines and next permitted action |
| JRN-15 Payroll/finance | None | Signed calculation examples, approvals, reconciliation, posting and linked adjustments; no live posting in tests |
| JRN-16 Wider field operations | None | Decompose into approved planning/crop/inspection/safety journeys and test each persisted process |

The existing scripts and their actual assertions remain authoritative for current coverage; this inventory must not inflate partial evidence into complete workflow acceptance. Maintain links in F02-JOURNEY-EVIDENCE-MAP.md and the requirement crosswalk as cases are implemented.

## UI/UX acceptance in every journey

- The user can identify the current estate/scope, stage, required fields, available next step and reason for a blocked action.
- Required-field and business errors retain safe entered data, identify the issue, move focus appropriately and offer a recovery action. Error summaries and field associations are tested when implemented.
- Loading, empty, success, warning, pending/offline, conflict and failure states are distinct; no false success after failed or ambiguous writes.
- Keyboard navigation, visible focus, accessible names, disclosure controls, dialog focus/return, status/alert announcements and responsive overflow are checked. Screen-reader behavior and usability require manual acceptance as well; browser assertions alone do not establish accessibility compliance.
- Test desktop and mobile layout for critical journeys. Add controlled visual baselines only for stable components with fixed locale/time/fixtures; never automatically accept changed screenshots.
- Short audit summaries explain the action. Authorized detailed evidence displays captured actor/time/reason/version/reference and permitted before/after values without private raw payloads.
- Permission and entitlement denials are checked through both UI and direct API. A hidden button is not authorization evidence.

## Regression execution strategy

| Suite | When | Scope |
|---|---|---|
| Smoke | Every PR | Login/scope selection, capture/read-back, representative review/audit, safe failure and logout |
| Feature regression | Every relevant PR, in addition to smoke | Changed journey plus dependent masters/roles/scopes, negative cases and error recovery |
| Full current regression | Every PR until measured, proven selection exists | Preserve current `verify:browser`, API/security and Docker quality gate; do not weaken it for speed |
| Expanded full regression | Planned scheduled runs and release candidates | All implemented journeys/personas/scopes/entitlements, critical browser/viewport matrix and upgrade/migration flows |
| Release acceptance | F25 / promotion | Full executed matrix, retained evidence, manual guided-journey/accessibility review and open-defect assessment |

Proposed tags: `@smoke`, `@regression`, `@negative`, `@offline`, `@accessibility`, plus journey IDs. Tag filters and new runner commands will be documented and verified with the runner increment; they are not runnable today. No recurring automation is created by this plan.

Current executable baseline: `npm run verify:browser` after dependencies, PostgreSQL migrations/seed and browser installation. The current CI already supplies this setup. Isolated scripts can also be run through existing package commands when their API/web/PWA servers and fixtures are ready. The canonical full quality gate remains `.github/workflows/verify.yml`.

## Reliable runs and failure evidence

Keep tests serial against the current shared database. Introduce parallel workers/shards only after each worker has an isolated database/schema/tenant fixture and safe port allocation; never reset a shared customer dataset. Docker is the common reproducible environment, with explicit synthetic seed and cleanup. Do not run destructive test setup against production.

Use fixed business dates and controlled clocks for expiry/effective-date tests; avoid random collisions with fixture-owned unique IDs. Real application/API/database behavior is required for workflow acceptance. Mock only deliberate external failure conditions; injected failure tests must also exercise successful recovery against the real server.

Planned failure artifacts: case/step report, sanitized screenshot, trace on failure, optional bounded video and relevant request IDs. Traces can contain cookies, headers, requests and employee data: use synthetic accounts/data, exclude credentials/session storage from source and public artifacts, review/sanitize captures, restrict access and set an approved retention period before upload. No real worker/payroll/bank data in recordings. Never log passwords, tokens or full request bodies merely to simplify diagnosis.

Keep retries bounded and visible (proposed one diagnostic retry in CI). A fail-then-pass is flaky evidence needing an owner/defect, not an unconditional green acceptance; no silent quarantine, blanket skips or unlimited retry. Reports must distinguish product defects, test defects and environment failures. Track journey coverage, first-run pass rate, flake count, duration and unresolved defects; agree numeric performance targets from measured baseline.

## Definition of done

A journey closes only when its accepted requirement links, synthetic preconditions, happy path, denied boundaries, recovery states, user guidance, persisted effects and authorized audit evidence pass. Record exact commit/run/project evidence, update the coverage matrix and retain manual acceptance where needed. API/domain tests carry calculation/concurrency/security depth; Playwright verifies the connected user experience and does not replace them.
