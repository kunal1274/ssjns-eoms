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

F06.3c1 adds `E2E-JRN-02-004`: baseline/as-of dates, prospective schedule, audit detail, persisted muster attribution and real conflict retention. Run visibly using `npm run test:e2e:headed -- --grep E2E-JRN-02-004` after isolated setup. Current suite: eight scenarios × two projects, all verified in CI 39007971408. This does not implement the planned custom one-click execution dashboard.

F06.3c1 verified: [CI 39007971408](https://github.com/kunal1274/ssjns-eoms/actions/runs/39007971408), source `bb4eebe9aa1c37140f1d4933c2287dd624ea9d11`; 74 unit/API tests, migration-009 legacy-null preservation, sixteen journey executions, ledger UI and existing browser/PWA/Docker gates passed. This journey prepares synthetic companies/estates in isolated eoms_test; company provisioning UI and owner-desktop observation remain separate pending work. The follow-up records evidence only.

F06.3c2a adds `E2E-JRN-02-005`: independently reviewed cancellation and linked correction, then protected captured work. Run visibly using `npm run test:e2e:headed -- --grep E2E-JRN-02-005` after isolated setup. It prepares a separate synthetic reviewer browser context at the same viewport using a valid test-DB session, while requester sign-in uses the normal UI. Login/session correctness remains JRN-03 coverage and the rate limit is unchanged. For manual demo, use the explicit development manager/reviewer accounts from your private .local account file; requesting and reviewing require different principals. Current suite: nine scenarios × two projects. [CI run 39014863357](https://github.com/kunal1274/ssjns-eoms/actions/runs/39014863357) passed all eighteen executions on source `1e17700a68d0fdaf0033d64445a7af4ebe659f35`, plus 78 unit/API tests, migration-010 upgrade preservation, ledger UI and browser/PWA/Docker gates. New journey: 5.9s desktop/5.8s mobile. Owner-desktop observation and reviewed recording/dashboard conversion remain pending.

F06.3c2b1 adds `E2E-JRN-02-006` for reviewed operating movement and area lifecycle. Visible isolated replay: `npm run test:e2e:headed -- --grep E2E-JRN-02-006`. Both principals use synthetic test-DB sessions to focus on operations without extra login attempts; login correctness remains JRN-03. For manual demo, use separate development manager/reviewer principals from the private local accounts file. The guided panel is Organization → Operating placement → Move an estate or change area availability. Current suite: ten scenarios × two viewport projects. [CI run 39016388790](https://github.com/kunal1274/ssjns-eoms/actions/runs/39016388790) passed all twenty executions on source `34a8d6431f8d1670ce7bd67c5fd563364a8761c8`, plus 82 unit/API tests, migration-011 upgrade preservation, ledger UI, browser/PWA and Docker/proxy/persistence/final gates. Movement journey: 6.5s desktop/6.3s mobile. The first mobile fixture failed on exact header text including an asynchronously appended role; header-scoped text plus exact session-principal checks fixed it. Owner-desktop observation remains pending.

### Manual movement and availability demo

Use synthetic development data and an estate explicitly assigned to both development setup principals. Use separate browser profiles/sessions for requester and reviewer; their accounts and passwords are in the private local account file. Company/estate provisioning and production identity administration are separate pending work.

1. As requester, open **Organization → Operating placement**. Create two optional operating areas with distinct codes and reasons. Select the demo estate and save its initial placement, if it has no placement history.
2. In **Move an estate or change area availability**, choose **Move estate**, a different **Move destination**, and a **Move reason**. Select **Request estate move**. Expect Pending, unchanged placement/version and guidance that you cannot review your own request.
3. Before approval, choose the occupied source as **Lifecycle area**, enter a reason and select **Deactivate area**. Expect dependency guidance and a support reference. Your reason stays in the form; no lifecycle change is saved.
4. As the independent reviewer, open the same panel. Choose the pending **Move request**, inspect requested/current placement and version, explicitly select **Approve immediate move** or **Reject and preserve placement**, enter **Move review reason**, then select **Record move decision**. Rejection preserves placement; approval changes it immediately. The reviewer must have explicit setup authority and this estate assigned.
5. Expand **View move audit details**. Check requester/reviewer identities, reasons, source/destination IDs, expected version, decision and both support references. In Recent placement changes, expand **View placement change details** to see before/after placement and the approved move decision reference.
6. As requester, select **Refresh placement lists**. Confirm the new placement and incremented version. Choose the vacated source under **Lifecycle area**, add a reason and select **Deactivate area**. Other assigned estates or active children still block this action, even when outside your estate access. Coordinate those dependencies first; there is no cascading deactivation.
7. Confirm the source is Inactive and absent from **Move destination**. Select it under **Lifecycle area**, enter a new reason and select **Reactivate area**. Expect Active and distinct before/after lifecycle history. For nested areas, deactivate business units before the region; reactivate the region before business units.
8. To remove operating placement, request **Customer root** and obtain independent approval. Later reattachment must also use the reviewed move form. Returning to root does not make the initial-placement shortcut available again.

Repeat automatically with `npm run test:e2e:headed -- --grep E2E-JRN-02-006`. This creates its own isolated synthetic fixture and valid requester/reviewer test sessions. It exercises the operational forms; it does not replay your last manual recording. Recording review/conversion and the custom one-click execution dashboard remain planned.

### Estate and unit availability demo

Current increment F06.3c2b2 adds `E2E-JRN-02-007`. Run visibly against the isolated synthetic test database with `npm run test:e2e:headed -- --grep E2E-JRN-02-007`. It prepares one valid setup-principal test-DB session and its own estate/units/tasks. Authentication remains separately covered. Current suite has eleven scenarios × two projects. [CI run 39022200186](https://github.com/kunal1274/ssjns-eoms/actions/runs/39022200186) passed all twenty-two executions on source `52f5861545e43951011f365834669d1b7c2ed4ef`, plus 87 unit/API tests, migration-012 upgrade preservation, ledger UI, prior browser/PWA and actual Docker/proxy/persistence/final gates. Lifecycle journey: 8.4s desktop/8.0s mobile. The final journey also verifies that opening availability setup from confirmed detail closes the old detail panel. Owner-desktop observation and recording/dashboard conversion remain pending.

1. Open **Organization → Estate and unit availability**, choose an assigned synthetic estate, and inspect availability/version/open drafts. Setup changes require explicit customer authority.
2. With a configured block containing draft work, try pausing it. Expect retained reason, draft guidance and support reference. Pausing a field/division with active children also blocks; estate pause checks all its drafts, including unlinked legacy work.
3. Return to **Muster register** and inspect/confirm valid draft work under the existing period/capacity rules. There is no automatic deletion or cancellation. If a draft cannot validly confirm, retain it and resolve its business discrepancy before pausing.
4. Deactivate the block, then its field/division with separate reasons. Expand **View availability audit details** to inspect before/after status/version, actor/time and support reference. Capture choices exclude the configured task, while historical work/maintenance retain it.
5. Deactivate the estate once no drafts remain. It stays assigned/readable and the Muster register shows **Estate inactive — new work is paused**. Existing historical review/reversal remains governed by the original period/access rules.
6. Use **Open availability setup**, reactivate estate first, then division → field → block. Attempting a child too early returns recovery guidance and keeps your reason. Refresh task lists and capture again.

An estate pause preserves individual unit flags; reactivating the estate resumes only units that are themselves active. Legacy unlinked task codes do not establish a block relationship; use the existing explicit link-review journey for attribution. Offline drafts may require review after availability changes. The headed journey is automated regression; arbitrary manual-recording conversion and the one-click reusable runner dashboard remain planned.

### Searchable hierarchy and history demo

F06.3d1 adds `E2E-JRN-02-008`. Visible isolated replay: `npm run test:e2e:headed -- --grep E2E-JRN-02-008`. It prepares 201 assigned estates, 501 units and older customer history under a separate synthetic customer, using a valid setup-user test-DB session. These are test fixtures, not production/customer provisioning acceptance. Existing authentication/rate limits remain unchanged. Current suite has twelve cases × two projects. [CI run 39023986833](https://github.com/kunal1274/ssjns-eoms/actions/runs/39023986833) passed all twenty-four executions on source `9960466d006ce204310bd63b7702d3868c63fd1a`, plus 91 unit/API tests, migration-013 upgrade, ledger UI, prior browser/PWA and Docker/proxy/persistence/final gates. Explorer journey: 4.2s desktop/4.8s mobile. Existing offline regression was strengthened and passed after fixing availability-banner remount/session-expiry interference. Owner-desktop observation and recording/dashboard conversion remain pending.

1. Open **Organization → Find estates, units and recorded changes**. Enter customer/company/estate name or code under **Find assigned estate**, choose page size and select **Search estates**. **Load more estates** appends the next page. A new search starts at the first page.
2. Select **Inspect …** on an assigned estate. Use **Find operating unit**, type and availability filters, then **Search units**. A page error keeps loaded rows; use **Retry units**. The automated journey injects one safe 503 and then tests a real successful retry. It does not treat the mock response as backend outage evidence.
3. Select **Review unit history**, optionally enter **History support reference** or a type/text filter, then **Search history**. Expand **View explorer audit details** to inspect actual actor ID, recorded before/after fields and references. Clear the unit filter to broaden the permitted history scope.
4. Choose **Customer name/code changes** for customer display history; estate/unit/type filters do not apply there. Search `customer.created` to find original creation even when it is older than the overview's recent 50-event window. **Load more history events** browses older records; rerun Search history for newer events.
5. Select **Continue to selected estate** to open its Muster register. Seeing parent labels does not grant unassigned estates or history. Other configuration selectors still have their separate bounded lists; full selector and dedicated-ledger pagination is the next increment.

The explorer performs literal text search (% and _ are not wildcards), pages in stable record-ID order, and rechecks current access on every request. It does not claim a full historical snapshot of master labels or permissions, a 5–10 lakh-row load benchmark, or completion of all EOMS journeys.

## F06.3d2a — Configuration selectors (verified below)

Implemented searchable/paged Hierarchy estate, Existing unit and allowed Unit parent choices, plus configured task block and exact-code legacy-link selection. Each page and pinned selected record rechecks current scope; selected records remain visible outside the search, and ineligible pins cannot authorize a new choice. Parent type/active/exclusion filters and exact-code constraints bind cursors; authoritative write checks and optimistic versions remain unchanged. Searching/retrying retains entered names/reasons and IDs; stale writes require explicit refresh/reselection. A successful write followed by failed list refresh blocks further setup writes until refresh succeeds. An estate beyond the overview is retained after saving, without silently retargeting another estate.

Three new API cases and E2E-JRN-02-009 cover scoped pins/current revisions/revoked membership, filters/cursors, deep hierarchy setup, injected search failure with real retry, real concurrent edit conflict, configured/explicit legacy task linking and captured estate/task/block/company alignment. Synthetic fixture uses 201 estates and 1,002 initial units; this is functional limit evidence, not a volume/performance benchmark. Inventory is 81 items (61 mapped/20 gaps). Actual full PostgreSQL/browser/Docker execution evidence and counts are recorded below.

F06 remains In progress. Next F06.3d2b: other customer/company/group, operating placement/responsibility and estate/unit availability selectors, main estate dropdown and dedicated decision-ledger pagination; then F06.4 acceptance/dependency reconciliation. Other F07–F25 delivery, typed sites, full custom/inherited permissions, provisioning, mandatory attribution rollout, complete lifecycle/offline matrix, owner-desktop observation, recording conversion and reusable one-click runner dashboard remain open. Keep existing draft PR and F05 owner exception; no merge/deployment.

Manual selector journey: Organization → Hierarchy setup → Search Hierarchy estate → Find → choose estate. Choose field/block type, search the allowed Unit parent, select it, enter code/name/reason and save. Searches/retries retain the chosen parent and form inputs. Search Existing unit to edit a record beyond the overview table. On version conflict, select Refresh hierarchy lists, rerun Find Existing unit, then select Load selected Existing unit before reviewing and saving the latest version. This explicit reload replaces the editor with the freshly read version and clears its previous reason; search alone preserves your draft fields. In the selected estate, Task capacity → Add task → Search Configured block → Find → select → enter reason and task fields → Save. An unlinked legacy task requires Link block → exact matching configured block → review reason → Confirm. Continue to Muster register and capture the configured task. Do not assume structure labels grant access.

Replay this slice with `npx playwright test jrn-02-selectors --headed` after the documented isolated host setup. `npm run test:e2e:ui` opens the Playwright UI on the executing computer. Headless remote CI does not show a browser on the owner's desktop; the custom one-click cross-project dashboard remains planned.

## Verified F06.3d2a — 17 October 2026 (India)

[CI run 39055317015](https://github.com/kunal1274/ssjns-eoms/actions/runs/39055317015), attempt 1, passed for branch source `251b4cc068dc02a2af65d35890de66c7d1e12302` (the PR workflow tests its generated merge with the base). Both verify and quality-gate succeeded. Passed: 35 unit/config/security/ledger tests + 59 PostgreSQL/API tests; separate legacy-upgrade harness through migration 013; all 26 desktop/mobile Playwright executions, including E2E-JRN-02-009 in 11.0s/12.6s; generated-ledger UI; all existing browser/workflow/PWA/installability checks; formatting/typecheck/build; dependency audit with zero known vulnerabilities; actual Docker build/start, container database/unit/API/upgrade checks, proxy/login/capture/idempotency and retained-volume persistence after recreation. Actual ledger: 122 passed/40 untested item/project rows (61 mapped assertions/20 gaps across two projects), not whole-product coverage.

The new journey reached an assigned estate outside the 200-estate setup overview and created a field/block using parents beyond the old 500-unit list. It retained selected IDs and typed fields through an injected correlated search failure followed by a real retry, recovered a real concurrent-edit conflict via Refresh hierarchy lists → Find Existing unit → Load selected Existing unit, created a configured task and explicitly linked an exact-code legacy task, then persisted work with the correct estate/task/block/legal-company identities. The synthetic browser fixture starts with 201 estates and 1,002 units. API cases additionally verified negative customer/account/estate pins, parent/type/exclusion/exact-code filters, cursor binding, live revisions/ineligible pins and membership revocation without read-side history mutation. This is functional limit evidence, not a production load benchmark.

Candidate source `aadc7cc3fcfa112b745836f7aefc0a7652032c6c` / CI 39028819063 passed API/legacy browser checks but failed both new viewport cases because the controlled Unit reason field lacked a stable accessible name after text entry. An explicit accessible label fixed the contract. Source `81f891b5f00f60d08d33f8df4ace814469bd3a6a` / CI 39054836196 progressed through retained fields and a real conflict, then failed because the new test used the shortened button label Refresh lists instead of the actual Refresh hierarchy lists. The test/guide now use the actual action; assertions and timeout thresholds were not weakened. An explicit selected-unit reload makes review of the latest saved version possible without changing the dropdown choice. The complete final suite above passed. This evidence follow-up changes documentation only.

F06.3d2a is verified; F06 remains In progress. Continue the ordered F06.3d2b queue in [F06 acceptance matrix](F06-ACCEPTANCE-MATRIX.md): remaining context/configuration selectors, dedicated decision-ledger pagination and then F06.4 acceptance/dependency reconciliation. The full F07–F25 delivery and parallel visible testing/recording/dashboard plan remain in force. Owner-desktop observation, production volume/performance, full persona/permission/offline acceptance and release readiness remain open. Keep the current draft PR/F05 owner exception; no merge/deployment.
