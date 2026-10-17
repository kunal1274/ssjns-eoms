# Current project handoff

Purpose: recover this plan after a new conversation, environment restart or another developer taking over. This file and PROGRESS.md are the durable project checkpoint; they do not schedule autonomous work outside an active session.

## Goal and source

Deliver the complete Estate Opera EOMS solution end to end against the accepted requirements/client documents: connected role-based journeys for new users, shared PERN/Docker codebase, security/scopes/custom roles/licensing, understandable short/detailed audit, user-friendly error/info feedback and real test evidence. Repository: kunal1274/ssjns-eoms. Working branch: planning/production-roadmap-data-security; draft PR #1. Do not merge/deploy automatically.

## Read in this order

1. PROGRESS.md: canonical F01–F25 status and evidence.
2. PRODUCTION-ROADMAP.md and F02 requirement/journey crosswalk/evidence map: full scope and gaps.
3. AUDIT-AND-USER-FEEDBACK.md: audit, feedback and recovery acceptance across all 16 journeys.
4. PLAYWRIGHT-JOURNEY-TEST-PLAN.md and PLAYWRIGHT-WORKBENCH-QUICKSTART.md: reusable testing plan and runnable commands.
5. F05-QUALITY-GATES.md: actual repository-policy gate and tested source/run evidence.

## Current delivery state

- F01–F04 complete for their defined gates.
- F05 is Complete (owner exception) for development sequencing: on 17 October 2026, 02:22 IST the owner instructed proceeding with the existing ruleset. Missing repository controls remain a release risk, not a blocker to continued development. See F05-OWNER-EXCEPTION.md; do not ask for the same authorization again.
- F06 is In progress. First increment: customer roots and company/estate boundary keys, safe organization/history reads and guided estate handoff. F07 and later phases have not started.
- Safe server error/correlation logs, expandable audit presentation, main API/device-sync recovery and visible browser replay exist. Raw-audit API authorization and full field/scope controls remain future work.
- Playwright Test runner/UI/headed/report commands and reusable fixture/page object exist. The first capture/confirm/audit/logout journey passed at desktop/mobile widths in CI 38946761298 on source 179aae4dde45d834e28cf8644fc48187b11b12e0. See the tracker for newer evidence.
- Prior validation/recovery source: 76d9f904b853288bb6ae669c19c4ccb3c691aac0, CI run 38950026833. All three scenarios passed at both viewport widths (six executions), plus 45 unit/API tests and the full existing browser/PWA/Docker gate. Sign-in validation/service recovery and work-form validation/retry are now verified partial coverage. An earlier run exposed an incorrect test assumption: no-worker selection disables Save, so the corrected case verifies prevention rather than expecting an error after submitting.

## Next concrete queue

1. F06.1 is verified. F06.2 controlled configuration is verified by CI 38977060930 on source 258a03860ed53a3f9cbdbd0b1f3ba80f9661bab4. F06.3a task/block linkage is verified by CI 38980380357 on ede87f56bd25b13071162fb494f16bd340ef1c9d. F06.3b is verified by CI 38999436012 attempt 2 on 3ba0b5d41f7c45cdb3178a74d227bb89e6f09ce0. Continue F06.3c effective ownership/governed movement/deactivation. Keep the full regression gate and owner exception.
2. Complete local interactive observation with the owner: `npm run test:e2e:ui` / `npm run test:e2e:headed` after host test setup. The browser opens on the executing computer; remote headless CI does not show it on the owner's desktop.
3. The initial 39-item coverage ledger is implemented; [coverage guide](PLAYWRIGHT-COVERAGE-LEDGER.md). Next expand the inventory from actual screens and add reviewed-recording conversion/run metadata, preserving precise assertion mappings and visible gaps. Local execution evidence is not fabricated.
4. Add reviewed-recording conversion and real run/result metadata, then a project-aware local runner-backed one-click dashboard. Keep secrets/session traces private and commands allowlisted. Prove a versioned shared kit against a second project before claiming portability.
5. F05 development progression is accepted by owner exception. Continue F06–F25 in order; carry repository-policy risk into release readiness. The testing workbench remains a parallel workstream and does not replace the business modules.

## Working conventions

Use synthetic data and isolated eoms_test for runner scenarios; keep serial workers until fixtures support isolation. Keep immutable retry keys and append-only business audit. Manual recordings require fixtures, assertions and review before counting as tests. Local desktop observation, manual usability/accessibility acceptance and production readiness are distinct from headless CI success. Record exact tested source and CI run; documentation-only follow-ups must not imply changed code was tested.

## Last checkpoint

17 October 2026 (India): [CI run 38950026833](https://github.com/kunal1274/ssjns-eoms/actions/runs/38950026833) passed on 76d9f904b853288bb6ae669c19c4ccb3c691aac0. The subsequent evidence update is documentation-only. No local interactive desktop observation or F05 policy closure is claimed.

## Current coverage-ledger increment

Initial inventory: 39 items (19 mapped assertions, 20 explicit gaps) × 2 viewport projects. Reporter captures actual assertion-bearing completed steps and run metadata; stale source, filtered/failed/skipped/flaky/interrupted runs remain non-green. HTML/JSON outputs are local and ignored. Status/schema/fingerprint/binding tests and generated-report browser checks are added; actual CI execution is recorded after verification. This does not complete every control/journey or the planned custom execution dashboard.

## Verified ledger checkpoint — 17 October 2026 (India)

Latest verified source: `85d8ec16b6aa9b74a0ad9966f50c7e03dcf0b45a`, [CI run 38957729942](https://github.com/kunal1274/ssjns-eoms/actions/runs/38957729942). Passed: 34 unit/config/security/presentation/ledger tests + 18 PostgreSQL/API tests, six journey executions, generated ledger filters, all legacy browser/PWA checks, formatting/build, dependency audit and Docker/proxy/idempotency/persistence/final gate. Actual ledger: 38 passed and 40 untested rows (19 mapped items and 20 gaps × 2 projects). An initial browser check found ambiguous filter labels; explicit associations fixed it and the same check passed. Later evidence commits are documentation-only. Next queue: reviewed-recording conversion/run metadata, expanded control inventory, then a real local runner-backed execution dashboard. F05 repository-policy gate remains open.

## Current F06 progression

The owner explicitly accepted the current ruleset for continuing development. See F05-OWNER-EXCEPTION.md and F06-CUSTOMER-HIERARCHY.md. F06.1 code is implemented; fresh execution evidence is recorded after verification. Historical blocked notes below/above do not override this later authorization. Next business increment: configurable hierarchy; keep the reusable testing workstream queued alongside it.

## Latest verified business checkpoint

Source `8027aad3364576c29d32b7e9a095ab72209f6cec`, [CI run 38966302671](https://github.com/kunal1274/ssjns-eoms/actions/runs/38966302671): F06.1 customer boundary/scoped Organization/history/estate-handoff verified; 55 unit/API tests, separate legacy upgrade harness, eight browser-runner executions and full prior/Docker/final gate passed. Current inventory is 42 items (22 mappings, 20 gaps), rendered at two viewport projects: 44 passed/40 untested rows. Later evidence edits are docs only. Continue F06.2; do not re-block on the owner-accepted F05 ruleset exception. F06 remains In progress.

## Active F06.2 checkpoint

Controlled optional groups/company assignment and division/optional-field/block setup are implemented with explicit customer grants (not implied by manager role), RLS, parent/type/scope guards, optimistic versions and reasoned before/after history. Full CI passed on the exact source recorded below. Six new API/DB tests and E2E-JRN-02-002 preserve the existing regression suite. Inventory: 46 items, 26 mappings and 20 explicit gaps across two projects. Next after verification: F06.3 region/business-unit/effective ownership/move/deactivation/access inheritance and occurrence-block linkage; full permission engine dependencies remain F09–F13. F06 is not complete. Visible owner desktop observation and full test dashboard/recording conversion are still queued.

## Verified F06.2 — 17 October 2026 (India)

[CI run 38977060930](https://github.com/kunal1274/ssjns-eoms/actions/runs/38977060930) passed for branch source `258a03860ed53a3f9cbdbd0b1f3ba80f9661bab4` (the pull-request workflow checks its generated merge with the base). Passed: 35 unit/config/security/ledger tests + 27 PostgreSQL/API tests; separate pre-F06 legacy upgrade through migrations 005/006 with original IDs/membership preserved, RLS enforced and no implicit setup grants; ten desktop/mobile Playwright executions including E2E-JRN-02-002; generated-ledger UI; existing browser/workflow/PWA/installability checks; formatting/build; dependency audit with zero known vulnerabilities; actual Docker build/start, container database tests, proxy/idempotency/persistence after recreation and quality-gate. Ledger: 52 passed/40 untested item/project rows (26 mappings/20 gaps across two viewport projects), not a product coverage percentage.

The first candidate failed because a newly inserted synthetic test email was uppercase while sign-in normalizes emails; normalizing that fixture fixed the failure without changing authentication. The verified run includes sibling-estate unit/history denials. This evidence follow-up is documentation-only. F06.2 controlled configuration is verified; F06 stays In progress. Next: F06.3 model/access completion, then F06.4 requirement/journey acceptance. F05 owner exception remains valid; local visible desktop observation, complete process coverage and the custom replay/recording dashboard remain open.

## Active F06.3a checkpoint

Implemented stable task/block links and explicit reviewed legacy attribution without guessed migration or rewriting historical work. Configured task creation, current/recorded block display, legacy link review, stale-write guidance and short/detailed audit are connected to task/muster navigation. Full CI including API/upgrade, twelve Playwright executions and Docker passed as recorded below. Inventory: 50 items (30 mapped,20 explicit gaps), expected 60 passed/40 untested rows. After verification, next F06.3b is optional region/business-unit placement, then effective ownership/move/deactivation/inheritance and F06.4 acceptance. Full custom permissions, mandatory block attribution/legacy rollout, visible owner desktop testing and recording/dashboard work remain open. Keep F05 owner exception and existing draft PR.

## Historical publication / CI checkpoint (resolved below)

Implementation remains local. Automatic approval review rejected the GitHub create-tree upload because it considered explicit authorization to share the source/documentation with the public repository unverified. Read-only checks confirmed the destination is the existing kunal1274/ssjns-eoms repository and draft PR #1, branch planning/production-roadmap-data-security, still at 2063535a200a3583d236d8365c9d3ecb4e1cd9d9. No F06.3a source has been pushed. Owner confirmation to push this concrete increment to that public destination is needed before retrying. Local typecheck, formatting, all 35 unit/config/security/ledger tests, production build and twelve-test discovery passed. PostgreSQL/API/upgrade, actual Playwright execution and Docker CI are NOT verified for this increment. Prior F06.2 evidence remains valid for its exact source only.

Owner confirmation, 17 October 2026, 04:38 IST: “yes okay to approve and confirmed and lets proceed.” This explicitly authorizes pushing the prepared F06.3a increment to the existing public kunal1274/ssjns-eoms repository/current draft PR and running CI. The publication blocker above is resolved; verification remains pending actual execution. No automatic merge/deployment is authorized.

## Verified F06.3a — 17 October 2026 (India)

[CI run 38980380357](https://github.com/kunal1274/ssjns-eoms/actions/runs/38980380357) passed for branch source `ede87f56bd25b13071162fb494f16bd340ef1c9d` (the pull-request workflow checks its generated merge with the base). Both verify and quality-gate succeeded. Passed: 35 unit/config/security/ledger tests + 31 PostgreSQL/API tests; the legacy-upgrade harness through migration 007 with old task ID/code/version preserved and block reference left unlinked; twelve Playwright desktop/mobile executions including E2E-JRN-06-001; generated-ledger UI; all existing browser/workflow/PWA/installability checks; formatting/typecheck/build; dependency audit with zero known vulnerabilities; actual Docker build/start, container database tests, proxy/idempotency and retained-volume persistence after recreation. Unit/API/upgrade checks also ran successfully inside Docker. Actual ledger: 60 passed/40 untested item/project rows (30 mapped assertions and 20 gaps across two viewport projects), not a product coverage percentage.

The initial CI candidate passed its database tests but the new browser case timed out because the configured selector lacked a stable accessible name. Explicit accessible names for both configured/matching block selectors fixed the UI contract; the same full journey then passed at both viewports (3.6s/3.5s). No assertions were weakened. The approved public-repository push completed; earlier publication-block notes are historical. This later evidence update changes documentation only. F06.3a is verified; F06 overall remains In progress.

Next concrete increment: F06.3b optional region/business-unit nodes and scoped estate placement, followed by effective ownership, move/deactivation rules, inheritance, larger-data navigation and F06.4 acceptance. Legacy unlinked creation remains a visible compatibility path; mandatory attribution/rollout and discrepancy resolution remain open. Custom permissions remain F09–F13 dependencies. Owner-desktop visible observation and the recording/replay dashboard workstream remain pending. Keep the existing draft PR and F05 owner exception; no automatic merge/deployment.

## Active F06.3b checkpoint

Optional region/business-unit nodes and initial estate placement are implemented with separate legal ownership, explicit setup grants plus estate membership, visible ancestor labels only and append-only reasoned history. Full CI/upgrade/fourteen browser executions/Docker passed as recorded below. Current inventory 54 items (34 mapped/20 gaps), expected fourteen executions and 68 passed/40 untested rows. Record actual source/run before verification. Next F06.3c effective ownership/governed movement/deactivation, then inheritance/large-data/site completion and F06.4 acceptance. Keep the owner-authorized public repository/current draft PR, F05 exception and full test-workbench queue. No merge/deploy.

## Verified F06.3b — 17 October 2026 (India)

[CI run 38999436012](https://github.com/kunal1274/ssjns-eoms/actions/runs/38999436012), attempt 2, passed for branch source `3ba0b5d41f7c45cdb3178a74d227bb89e6f09ce0` (the PR workflow checks its generated merge with the base). Both verify and quality-gate succeeded. Passed: 35 unit/config/security/ledger tests + 35 PostgreSQL/API tests; separate legacy-upgrade harness through migration 008 proving old estate IDs/company unchanged, area null/version 1 and no guessed area nodes; fourteen desktop/mobile Playwright executions including E2E-JRN-02-003; generated-ledger UI; all prior browser/workflow/PWA/installability checks; formatting/typecheck/build; dependency audit with zero known vulnerabilities; actual Docker build/start, container database tests, proxy/idempotency and persistence after recreation. Unit/API/upgrade checks also passed inside Docker. Actual ledger: 68 passed/40 untested item/project rows (34 mappings/20 gaps × two projects), not a product coverage percentage. The placement scenario passed in 4.7s desktop/4.3s mobile.

The first candidate exposed an old manager test's hard-coded two-estate assumption after new authorized fixtures were added. Comparing the exact returned ID set with actual memberships fixed fixture coupling and retained the negative-scope assertions. The corrected run's first attempt passed all application/browser checks but Docker could not bind host port 55432 because it was occupied. Re-running the failed job on a fresh runner passed the complete gate without application changes. These failures and retry are retained as evidence. This later evidence update changes documentation only.

F06.3b optional operating placement is verified. F06 remains In progress. Next F06.3c: effective legal responsibility/ownership history plus governed movement/deactivation rules; custom permission/inheritance alignment stays with F09–F13. Full typed operational sites, large-data navigation, grant administration, legacy block-attribution rollout and F06.4 requirement/journey acceptance remain open. Owner-desktop observation, reviewed recording conversion and custom replay dashboard/shared kit remain queued. Keep the existing draft PR/F05 owner exception; no automatic merge or deployment.
