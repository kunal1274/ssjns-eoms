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

1. F06.1 is verified. F06.2 controlled configuration is implemented; finish real PostgreSQL/Playwright/Docker CI verification, record exact source/run, then continue F06.3 model/access completion. Keep the full regression gate and owner exception.
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

Controlled optional groups/company assignment and division/optional-field/block setup are implemented with explicit customer grants (not implied by manager role), RLS, parent/type/scope guards, optimistic versions and reasoned before/after history. Local checks/build/35 unit tests passed; full CI evidence is pending. Six new API/DB tests and E2E-JRN-02-002 preserve the existing regression suite. Inventory: 46 items, 26 mappings and 20 explicit gaps across two projects. Next after verification: F06.3 region/business-unit/effective ownership/move/deactivation/access inheritance and occurrence-block linkage; full permission engine dependencies remain F09–F13. F06 is not complete. Visible owner desktop observation and full test dashboard/recording conversion are still queued.
