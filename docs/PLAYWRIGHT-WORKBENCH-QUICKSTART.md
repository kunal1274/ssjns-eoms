# Interactive journey runner — first working increment

This is the first runnable Playwright Test UI increment, continuing the owner-requested F05 test tooling. It does not start F06 or close the repository-policy blocker.

## Run on your computer

Use the working branch, Node 24 and the host test setup in README. Run `npm ci`, prepare the local PostgreSQL environment/migrations/seed, then `npm run db:test` to create the isolated `eoms_test` database and `.local/test-accounts.json`. Chrome must be installed. Do not mix Docker tooling's account-volume credentials with these host fixture accounts.

```sh
npm run test:e2e:ui
```

Playwright opens its interactive UI locally. Select `E2E-JRN-07-001` under chrome-desktop or chrome-mobile and press Run. Inspect named steps, locator actions, assertions and results; rerun the case from the same interface. App/API servers start for the test and target `eoms_test`. The control interface binds to loopback. It opens on the executing computer, not inside this chat or automatically on another person's desktop.

To watch a real browser window run the case:

```sh
npm run test:e2e:headed
```

For headless regression and the saved report:

```sh
npm run test:e2e
npm run test:e2e:report
```

The report opens only after a run has generated it. Reports/results live under ignored `.local/e2e-report` and `.local/e2e-results`; no fake results are preloaded. Tests are serial with no automatic retries. Config and case versions plus CI commit identify automated evidence; a local report identifies itself as local-unversioned unless a source SHA is supplied. Interactive desktop operation still requires local observation; headless CI is separate evidence.

## Current real scenario

`tests/e2e/jrn-07-capture.spec.ts` is one scenario executed at two viewport widths:

1. Sign in with the seeded assigned supervisor and identify estate/register.
2. Fill work date, task, area, gang and worker selection using a unique task fixture.
3. Save once; assert server status, saved record and user feedback.
4. Confirm; reload and check the persisted quantity/state in PostgreSQL.
5. Verify cross-estate API denial, audit summary/detail, correlated creation/confirmation events and no horizontal overflow.
6. Sign out and verify the sign-in form returns.

This is partial JRN-07/JRN-08/JRN-11 evidence, not complete coverage of those journeys or every field. Fixture task data is unique and lives only in the local synthetic test database. The fixed synthetic December 8800 period is fixture-owned by this suite; no shared database reset or deletion of append-only audit evidence occurs. A fixture closes its database connection after use. Test-generated records remain synthetic evidence; reset only through a separate explicitly chosen local test-environment reset.

Reusable interactions are in `tests/e2e/pages/MusterPage.ts`; fixture accounts/data are in `tests/e2e/fixtures.ts`. Add scenarios with stable IDs and assertions before expanding the component coverage ledger. Current runner projects test viewport differences in Chrome, not independent Safari/Firefox behavior or real mobile devices.

## Record a manual journey and turn it into a case

Start the development API/web at http://localhost:5174, then run `npm run test:journeys:record`. Use Playwright's recorder to capture actions and add visible UI assertions through its assertion tools where supported. Output remains the ignored `.local/recorded-journey.spec.ts` draft. Codegen capture is not a pass result.

Review the draft: remove literal passwords/private inputs, use seeded fixtures and stable accessible locators, replace fixed data with deterministic fixture setup, and add expected success/error/navigation/persistence/audit assertions. Assign an E2E/JRN ID and place the reviewed case in `tests/e2e`; import the fixture test/expect when the case needs EOMS accounts/work data. Run it independently in UI mode, then in regression. The runner package is now installed, so reviewed cases can use `@playwright/test`; raw ignored drafts are not automatically discovered or approved.

## Evidence and limits

The regular CI runs `npm run test:e2e` in addition to all existing browser scripts, after isolated test database setup and Chrome installation. HTML/JUnit results and failure screenshots are generated locally in CI; automatic public artifact upload is deliberately not enabled. Trace/video capture remains off because it can record credentials/requests. Use synthetic data and review any interactive UI snapshot/recording before sharing.

The existing script-based visible replay remains available. A project-aware dashboard, recording-to-case review UI, full field/action/form/navigation inventory, coverage/stale-result engine and a versioned portable kit for other projects remain planned. Playwright UI is the working test runner interface; it is not yet that custom cross-project workbench. No claim is made of manual desktop observation from this remote environment.

## Executed evidence

[CI run 38946761298](https://github.com/kunal1274/ssjns-eoms/actions/runs/38946761298) passed on source `179aae4dde45d834e28cf8644fc48187b11b12e0`: E2E-JRN-07-001 passed in chrome-desktop (1.9 seconds) and chrome-mobile (1.8 seconds), alongside 27 unit/config/security/presentation tests, 18 PostgreSQL/API tests, legacy browser/PWA checks, build/formatting, zero known dependency vulnerabilities in that run, and Docker/proxy/idempotency/persistence verification. The final quality-gate passed. This is headless execution evidence; local interactive UI/desktop observation is still pending. A subsequent documentation-only commit records the result.

## Additional selectable cases

E2E-JRN-03-001 checks required/format sign-in fields, focus, no invalid login request, safe injected service-failure guidance/support reference and successful real authentication retry. E2E-JRN-07-002 checks missing work date/gang/area, nonpositive/invalid area precision, no selected worker, preserved inputs after an injected 422 rejection, then a real save with exactly one record/audit event. These are deliberate partial assertions, not complete per-field coverage. Each appears under both desktop/mobile viewport projects in UI mode. Latest CI evidence is in the tracker.

Latest validation/recovery evidence: [CI run 38950026833](https://github.com/kunal1274/ssjns-eoms/actions/runs/38950026833) passed on `76d9f904b853288bb6ae669c19c4ccb3c691aac0`: all three scenarios in both viewport projects (six executions). The no-worker check asserts Save is disabled and re-enabled after selection; it does not attempt to click a disabled control. The full existing quality gate also passed. See CURRENT-HANDOFF.md for the next increment.

## Coverage ledger

The runner now creates `.local/e2e-ledger/index.html` and JSON evidence. Run `npm run test:coverage` to regenerate against current source, then open that file and filter by status/screen. The [coverage guide](PLAYWRIGHT-COVERAGE-LEDGER.md) explains the initial inventory, evidence gates, stale detection and remaining gaps. This is a read-only assertion report; use Playwright UI for test execution.

## Organization scenario

E2E-JRN-02-001 now covers scoped customer/company/estate context, recorded customer display-history disclosure and opening the assigned estate register, at desktop/mobile widths. Both passed in CI 38966302671 on source 8027aad3364576c29d32b7e9a095ab72209f6cec. There are four scenarios/eight viewport executions in total. Full hierarchy creation/moves/inheritance remain unimplemented and are not implied by this read-only journey.

F06.2 adds `E2E-JRN-02-002` using the explicit synthetic setup administrator grant. It configures a legal group/company and division/field/block, edits a block, reloads and inspects history. Run visibly with `npm run test:e2e:headed -- --grep E2E-JRN-02-002` after isolated test setup. The browser opens on the executing computer. Full current suite: five scenarios × two viewport projects; CI evidence is recorded in the F06 tracker.

Verified: [CI 38977060930](https://github.com/kunal1274/ssjns-eoms/actions/runs/38977060930) passed all ten executions on source `258a03860ed53a3f9cbdbd0b1f3ba80f9661bab4`, plus PostgreSQL/upgrade, ledger UI, legacy browser/PWA and Docker gates. This is headless CI evidence; owner desktop observation remains pending.

F06.3a adds `E2E-JRN-06-001`: configured block/task creation, reviewed legacy linking/conflict recovery, persisted muster association, audit details and hierarchy handoff. Run visibly with `npm run test:e2e:headed -- --grep E2E-JRN-06-001` after host test setup. Six scenarios × two viewport projects passed in CI 38980380357.

F06.3a verified: [CI run 38980380357](https://github.com/kunal1274/ssjns-eoms/actions/runs/38980380357), source `ede87f56bd25b13071162fb494f16bd340ef1c9d`; all twelve executions, 66 unit/API tests, upgrade/ledger UI and existing browser/PWA/Docker gates passed. Visible owner-desktop observation is separate and remains pending. The follow-up records evidence only.

F06.3b adds `E2E-JRN-02-003`, with an isolated synthetic estate: region/business-unit setup, initial placement/reload, rejected reassignment, display edit, audit and supervisor visibility denial/handoff. Run visibly using `npm run test:e2e:headed -- --grep E2E-JRN-02-003` after test setup. Current suite: seven scenarios × two viewport projects, all verified in CI 38999436012 attempt 2. Browser observation occurs on the executing computer.

F06.3b verified source `3ba0b5d41f7c45cdb3178a74d227bb89e6f09ce0`: [CI 38999436012](https://github.com/kunal1274/ssjns-eoms/actions/runs/38999436012), attempt 2; 70 unit/API tests, upgrade, fourteen Playwright executions, ledger UI and existing browser/PWA/Docker gates passed. Headless CI does not replace owner-desktop observation. Evidence follow-up is docs only.

F06.3c1 adds `E2E-JRN-02-004`: baseline/as-of dates, prospective schedule, audit detail, persisted muster attribution and real conflict retention. Run visibly using `npm run test:e2e:headed -- --grep E2E-JRN-02-004` after isolated setup. Current suite: eight scenarios × two projects; execution evidence pending. This does not implement the planned custom one-click execution dashboard.
