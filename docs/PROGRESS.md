# Estate Opera EOMS — Progress Tracker

**Last updated:** 16 October 2026  
**Repository:** [kunal1274/ssjns-eoms](https://github.com/kunal1274/ssjns-eoms)  
**Working branch:** `planning/production-roadmap-data-security`

This is the canonical top-level tracker and matches the 25 phases supplied by the project owner. Data-level security is explicitly included in F12 and is also a cross-cutting acceptance requirement for F02–F05 and all later modules.

## Status rules

- **Not started** — the phase has not entered implementation/acceptance.
- **In progress** — work has started, but the acceptance gate is not yet satisfied.
- **Blocked** — progress requires missing access, a dependency or an owner decision.
- **Ready for testing** — implementation is ready for acceptance verification.
- **Complete** — the acceptance criteria and evidence are recorded.

Existing code is evidence for an audit, but does not automatically mean a phase is complete. Each phase must be reviewed against its full scope and acceptance criteria.

## Progress

| ID | Workstream | Phase | Status | Current note |
|---|---|---|---|---|
| F01 | Foundation | Source code audit | **Complete** | Source/configuration/security review recorded and fresh CI run #3 passed dependency install, migrations, DB tests, 5 domain/sync tests, 18 integration tests, build, browser/PWA workflows and npm audit (0 vulnerabilities). Findings remain open for their assigned phases; production is still gated. See [F01 audit](AUDIT-F01.md). |
| F02 | Foundation | Requirements traceability | **Complete** | Owner accepted the 34 REQ-* acceptance statements and 16 JRN-* journey inventory as the planning/traceability baseline; [acceptance record](F02-OWNER-ACCEPTANCE.md). [CI run #38849671680](https://github.com/kunal1274/ssjns-eoms/actions/runs/38849671680) passed on the acceptance commit, including DB checks, unit/integration tests, build, browser verification and dependency audit. Implementation gaps and customer-specific/production gates remain open in their assigned phases. |
| F03 | Foundation | Architecture conventions | **Complete** | Owner accepted ADR-F03-01–09 on 16 October 2026; Node 24.x metadata/CI/image conventions aligned. API error/correlation/redaction deltas remain explicit F05/security implementation work. [Accepted baseline](F03-ARCHITECTURE-CONVENTIONS.md). |
| F04 | Foundation | Docker environment | **Complete** | Shared PostgreSQL/migration/API/web and explicit seed/verification tools implemented. [CI run 38890867618](https://github.com/kunal1274/ssjns-eoms/actions/runs/38890867618) passed on `9d642cfa79ca9463a36923f8eec55e1ca9e6965c`, including actual container tests, web-proxy login/draft/idempotency and retained-volume recreation. Production release remains gated. [F04 evidence](F04-DOCKER-ENVIRONMENT.md). |
| F05 | Foundation | Automated quality checks | **Blocked** | Implementation and audit/feedback/device-sync/visible-launch continuation verified by [CI run 38945388469](https://github.com/kunal1274/ssjns-eoms/actions/runs/38945388469) on `712da585601306a77f9e4de472da12bcdf708e4d`: 27 unit/security/configuration/presentation/launch-policy + 18 PostgreSQL/API tests, formatting, build, browser, audit, Docker/persistence and quality-gate pass. Main is now targeted by an active ruleset restricting deletion/force pushes; required PR/review, quality-gate/up-to-date, conversation resolution and linear-history enforcement remain missing. The connector cannot apply administration settings. [F05 remaining gate](F05-QUALITY-GATES.md#repository-administration--remaining-external-gate). |
| F06 | Access control | Customer hierarchy | Not started | Current schema has companies and estates; customer/group/division/block hierarchy is incomplete. |
| F07 | Access control | Authentication and sessions | Not started | Basic local-development login/session/CSRF controls exist; production identity requirements remain open. |
| F08 | Access control | User lifecycle | Not started | Full invitation, recovery, provisioning, suspension and revocation lifecycle not accepted or complete. |
| F09 | Access control | Permission catalogue | Not started | Fixed role strings exist; a stable resource/action permission catalogue is not present. |
| F10 | Access control | Role data model | Not started | Current estate membership roles are manager/supervisor/clerk; extensible custom roles/scopes are not implemented. |
| F11 | Access control | Authorization engine | Not started | API role checks exist for current routes; centralized permission-based authorization is not implemented. |
| F12 | Access control | Record-level access | Not started | Estate-level RLS/membership checks exist for current tables. Division/block/record/field scopes and full security verification remain required. |
| F13 | Access control | Separation of duties | Not started | Current same-manager confirmation/review is explicitly provisional; configurable conflict rules and delegation are absent. |
| F14 | Role administration | Role templates | Not started | No accepted template catalogue. |
| F15 | Role administration | Custom role creation | Not started | No customer-admin custom role lifecycle. |
| F16 | Role administration | Permission editor | Not started | No permission matrix/editor. |
| F17 | Role administration | Publishing and audit | Not started | Existing operational audit is not a versioned role publication system. |
| F18 | Role administration | Role preview and testing | Not started | No role simulation/preview against API and data-scope rules. |
| F19 | Licensing | License model | Not started | Commercial plan/entitlement model not implemented. |
| F20 | Licensing | User seats | Not started | DEC-05 named-user product default is accepted; seat assignment/capacity enforcement and customer contract configuration remain unimplemented. |
| F21 | Licensing | Entitlement enforcement | Not started | Server-side module/feature entitlement enforcement not implemented. |
| F22 | Licensing | Expiry and renewal | Not started | Contract-driven expiry, grace, renewal and suspension behavior not implemented. |
| F23 | User journeys | Workflow engine | Not started | Muster-specific state transitions exist; a reusable, configurable workflow engine is not implemented. |
| F24 | User journeys | Dashboards and task queues | Not started | Current UI is focused on a limited muster workflow; role-specific work queues remain. |
| F25 | User journeys | End-to-end journey test | Not started | Existing browser tests cover limited current journeys; the complete persona × permission × data-scope matrix is not covered. |

## F01 acceptance gate

F01 can be marked **Complete** only after all of these are evidenced:

- [x] Uploaded repository ZIP, application source, migrations, tests and project documentation inspected.
- [x] Existing implementation, documented boundaries and source-level security findings recorded in `AUDIT-F01.md`.
- [x] CI workflow reviewed and a fresh run completed on the working branch.
- [x] Clean dependency installation and TypeScript/build commands passed in CI.
- [x] PostgreSQL migrations, seed and integration/security tests passed against the restricted runtime role in CI.
- [x] Browser regression/PWA workflows and dependency audit passed in CI.
- [x] Audit findings and follow-up phases documented; F01 is closed as an audit, not as a claim of production readiness.

F01 closure does not imply that recorded security findings are fixed or that production readiness or exact hosted-demo/repository UI parity has been established.

## Audit and user feedback addition — 16 October 2026

The owner requested short and detailed audit trails plus user-friendly error/info messages across every process. The [delivery matrix and journey acceptance criteria](AUDIT-AND-USER-FEEDBACK.md) assign implementation to existing phases. The F05 continuation adds readable expandable current events and safe main API recovery guidance; full audit authorization, history navigation, all-screen feedback and complete journey coverage remain planned. F05 is still blocked by main branch enforcement; F06 has not started.

The audit/feedback continuation is verified by [CI run 38918867500](https://github.com/kunal1274/ssjns-eoms/actions/runs/38918867500) on `712c587ade8edd56dcffb62a23d43e5945d77eb3`. This evidence update is documentation-only. The new matrix explicitly maps audit/feedback acceptance to JRN-01–JRN-16.

Device-sync recovery now preserves safe support references, explains blocked/paused states and sanitizes storage/transport failures. [CI run 38925295750](https://github.com/kunal1274/ssjns-eoms/actions/runs/38925295750) passed on `d3b61c3bc9e9ff4ab4085d7d40ccaf062352c36d` (43 unique tests plus browser/PWA/Docker and final gate). Comprehensive feedback across every screen remains planned; see the delivery matrix.

## Playwright journey and regression plan — 16 October 2026

The owner requested reusable Playwright E2E user journeys, UI/UX assertions and simplified regression testing. The [implementation plan](PLAYWRIGHT-JOURNEY-TEST-PLAN.md) maps all 16 journeys, existing partial browser evidence, proposed fixtures/page objects/runner migration, regression tiers, failure artifacts and acceptance rules. This update is planning only; no new runner dependency or scenario coverage is claimed.

Repository policy recheck: main now reports protected and active ruleset 25257228 targets the default branch, with deletion and force-push restrictions. Required PR review, quality-gate/up-to-date checks, conversation resolution and linear history are still absent. F05 remains Blocked; F06 remains Not started. This supersedes the earlier observation that main had no protection at all.

## Visible replay and reusable test workbench

The owner requested visible tester-like replay, manual recording, one-click journey verification and reuse in other projects. Visible launch mode and the recorder CLI entry are added to the existing Playwright scripts. The [workbench plan](PLAYWRIGHT-JOURNEY-TEST-PLAN.md#visible-testing-manual-recording-and-reusable-test-workbench) records runner UI adoption, reviewed recordings, actual run/status evidence, field/action/form/navigation coverage, a local runner-backed dashboard and portable project adapters. Those dashboard/runner/coverage features remain planned. No claim of full test coverage or observed local-desktop execution is made. F05 policy blocker remains unchanged.

Visible-launch infrastructure evidence: [CI run 38945388469](https://github.com/kunal1274/ssjns-eoms/actions/runs/38945388469) passed on `712da585601306a77f9e4de472da12bcdf708e4d` (45 unique tests plus headless browser/PWA/Docker and final gate). This does not certify observed local headed runs or implement the planned test dashboard. Ruleset still contains only deletion/non-fast-forward restrictions; F05 remains Blocked and F06 Not started.

## Interactive runner continuation

Playwright Test UI/headed/headless/report commands, matched dependency lock, isolated eoms_test web servers, reusable work fixture/page object and E2E-JRN-07-001 desktop/mobile viewport runs are implemented as F05 test tooling. CI now runs these alongside every existing browser regression. [Quickstart](PLAYWRIGHT-WORKBENCH-QUICKSTART.md). Custom cross-project dashboard and full control/field coverage remain planned. Local type/discovery/format checks passed; fresh CI execution evidence follows. This supersedes the earlier runner-not-installed status without closing the external F05 gate.

Interactive runner evidence: [CI run 38946761298](https://github.com/kunal1274/ssjns-eoms/actions/runs/38946761298) passed on `179aae4dde45d834e28cf8644fc48187b11b12e0`: 45 unit/API tests plus the new journey at two viewport widths, every legacy browser/PWA check and Docker/final gate. [Quickstart and evidence](PLAYWRIGHT-WORKBENCH-QUICKSTART.md). UI-mode local desktop observation and complete journey coverage remain open.

## Continuity and validation/recovery expansion

AGENTS.md and [CURRENT-HANDOFF.md](CURRENT-HANDOFF.md) now record the full delivery goal, authoritative plans, current gate and concrete next queue. Two additional runner cases cover sign-in required/format fields and safe service retry, plus work date/gang/area/worker validation, preserved input, rejected server submission and exactly one corrected save/audit event. Discovery now lists three scenarios across two viewport projects (six executions); actual fresh CI evidence follows.

## Verified checkpoint — 17 October 2026 (India)

[CI run 38950026833](https://github.com/kunal1274/ssjns-eoms/actions/runs/38950026833) passed on `76d9f904b853288bb6ae669c19c4ccb3c691aac0`: 27 unit/config/security/presentation tests, 18 PostgreSQL/API tests, and all three runner scenarios in desktop/mobile viewport projects (six executions), plus existing browser/PWA/installability, formatting/build, dependency audit, Docker/proxy/idempotency/persistence and quality-gate. The no-worker test was corrected to assert the existing disabled Save behavior; no product behavior was weakened. [Current handoff](CURRENT-HANDOFF.md) now identifies the coverage ledger as the next implementation. F05 remains blocked by policy; F06 not started. This evidence update is documentation-only.

## Assertion coverage ledger increment

Implemented a versioned 39-item field/action/form/navigation/audit/journey-gap inventory, Playwright evidence reporter, source fingerprint, JSON/HTML report and screen/status filters. Completed assertion-bearing steps plus a passing current case/run are required; stale, missing, skipped, cancelled, flaky and failed evidence stays visible. CI now validates the generated ledger UI after real journey execution. [Guide](PLAYWRIGHT-COVERAGE-LEDGER.md). Local status/schema/fingerprint/binding tests, build and formatting passed; full CI evidence follows. F05 remains blocked on repository policy; F06 not started.

## Verified assertion ledger — 17 October 2026 (India)

[CI run 38957729942](https://github.com/kunal1274/ssjns-eoms/actions/runs/38957729942) passed on `85d8ec16b6aa9b74a0ad9966f50c7e03dcf0b45a`: 34 unit/config/security/presentation/ledger + 18 PostgreSQL/API tests, all six runner executions, generated-ledger screen/status filtering, existing browser/PWA/installability, formatting/build, dependency audit, Docker/proxy/idempotency/persistence and quality-gate. Reporter and regenerated JSON both reported 38 passed/40 untested rows. This is 19 mapped assertion items and 20 explicit gaps across 2 projects, not whole-product coverage. Explicit accessible filter labels fixed the first UI-check failure. The later evidence commit is documentation-only. Handoff now queues reviewed-recording conversion/run metadata and the execution dashboard; F05 policy gate remains Blocked and F06 Not started.
