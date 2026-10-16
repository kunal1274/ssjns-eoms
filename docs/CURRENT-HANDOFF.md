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
- F05 remains Blocked on repository enforcement. The active ruleset targets the default branch but only restricts deletion/force pushes; required PR/reviews, quality-gate/up-to-date checks, conversation resolution and linear history remain missing. The connected GitHub tools cannot administer these settings. Recheck before repeating this observation.
- F06 and later phases have not started. Foundation/test-tool improvements do not silently waive their dependencies.
- Safe server error/correlation logs, expandable audit presentation, main API/device-sync recovery and visible browser replay exist. Raw-audit API authorization and full field/scope controls remain future work.
- Playwright Test runner/UI/headed/report commands and reusable fixture/page object exist. The first capture/confirm/audit/logout journey passed at desktop/mobile widths in CI 38946761298 on source 179aae4dde45d834e28cf8644fc48187b11b12e0. See the tracker for newer evidence.
- Latest verified source: 76d9f904b853288bb6ae669c19c4ccb3c691aac0, CI run 38950026833. All three scenarios passed at both viewport widths (six executions), plus 45 unit/API tests and the full existing browser/PWA/Docker gate. Sign-in validation/service recovery and work-form validation/retry are now verified partial coverage. An earlier run exposed an incorrect test assumption: no-worker selection disables Save, so the corrected case verifies prevention rather than expecting an error after submitting.

## Next concrete queue

1. Current increment implements the assertion coverage inventory/reporter/JSON/HTML view. Verify real CI-generated evidence and filters, then record the tested source/run before closing this increment. Keep the full regression gate active.
2. Complete local interactive observation with the owner: `npm run test:e2e:ui` / `npm run test:e2e:headed` after host test setup. The browser opens on the executing computer; remote headless CI does not show it on the owner's desktop.
3. The initial 39-item coverage ledger is implemented; [coverage guide](PLAYWRIGHT-COVERAGE-LEDGER.md). Next expand the inventory from actual screens and add reviewed-recording conversion/run metadata, preserving precise assertion mappings and visible gaps. Local execution evidence is not fabricated.
4. Add reviewed-recording conversion and real run/result metadata, then a project-aware local runner-backed one-click dashboard. Keep secrets/session traces private and commands allowlisted. Prove a versioned shared kit against a second project before claiming portability.
5. As soon as the policy gate is genuinely satisfied, close F05 with proof and proceed F06–F25 in order, adding tests/audit/feedback alongside each business module. The testing workbench does not replace customer hierarchy, identity, permissions, licensing or the remaining client process flows.

## Working conventions

Use synthetic data and isolated eoms_test for runner scenarios; keep serial workers until fixtures support isolation. Keep immutable retry keys and append-only business audit. Manual recordings require fixtures, assertions and review before counting as tests. Local desktop observation, manual usability/accessibility acceptance and production readiness are distinct from headless CI success. Record exact tested source and CI run; documentation-only follow-ups must not imply changed code was tested.

## Last checkpoint

17 October 2026 (India): [CI run 38950026833](https://github.com/kunal1274/ssjns-eoms/actions/runs/38950026833) passed on 76d9f904b853288bb6ae669c19c4ccb3c691aac0. The subsequent evidence update is documentation-only. No local interactive desktop observation or F05 policy closure is claimed.

## Current coverage-ledger increment

Initial inventory: 39 items (19 mapped assertions, 20 explicit gaps) × 2 viewport projects. Reporter captures actual assertion-bearing completed steps and run metadata; stale source, filtered/failed/skipped/flaky/interrupted runs remain non-green. HTML/JSON outputs are local and ignored. Status/schema/fingerprint/binding tests and generated-report browser checks are added; actual CI execution is recorded after verification. This does not complete every control/journey or the planned custom execution dashboard.
