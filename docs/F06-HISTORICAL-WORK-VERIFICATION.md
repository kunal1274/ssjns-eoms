# Historical work browser acceptance: engineering checkpoint

18 October 2026. F06.6b positive historical-work browser acceptance is verified for the scope below. F06 remains In progress. This compact technical checkpoint does not retransmit the blocked full client-derived tracker/handoff payload.

## Verified source and full gate

Branch source `272d2d401498841f1405603276aa07d3197f31e2`, [CI 39142448119](https://github.com/kunal1274/ssjns-eoms/actions/runs/39142448119), attempt 1: verify and quality-gate succeeded. The PR workflow exercises the generated merge with the base. This later evidence/index update changes documentation only.

| Check | Executed result |
| --- | --- |
| Unit and real PostgreSQL/API | 39 + 81 = 120 passed, zero failures; same suites passed inside Docker. |
| Playwright | All 44 desktop/mobile executions passed. New E2E-JRN-06-003: 3.6s / 3.6s, including real upgrade/API, history preservation, retry, read-only detail, return, scope revocation and explicit restoration. |
| Ledger | 208 passed / 40 untested item/project rows; inventory 124 items, 104 mapped / 20 gaps. Not whole-product coverage. |
| Existing regression and upgrade | Prior API/negative/journey/browser/maintenance/workflow/PWA/session/offline/installability and legacy-upgrade checks through migration 017 passed. |
| Delivery | Generated-ledger UI, formatting/type/build, zero-known-vulnerability audit and actual Docker/database/proxy/idempotency/retained-volume persistence checks passed. |

This closes the positive historical-work browser handoff gap recorded in the previous checkpoint. It does not complete historical reconciliation/import, manual UAT, F06 or the broader product. No merge/deployment or owner-visible/manual acceptance is claimed.

## Behavior and connected journey

Task capacity → Open legacy attribution review → Work without recorded company → Find / More → Open recorded work → historical detail and source references → Return to unresolved work review. Opening a work detail focuses its destination. Historical detail states that company attribution was not captured, explains that today's company/current task link is not historical evidence, and exposes work/estate/task IDs for source reconciliation. Return opens the work queue directly and focuses its panel. Normal workspace navigation clears that return context.

The current source does not infer or change missing attribution, import mappings, approve corrections or manufacture business history. A failed detail read retains the selected row/search and shows safe recovery guidance/support reference. Access loss clears cached review data; restoration requires an explicit refresh. Existing server authorization and immutable attribution guards remain in force.

## Real historical browser fixture

E2E-JRN-06-003 creates a disposable local PostgreSQL database. It applies migrations 001–004, inserts 28 synthetic historical confirmed work records with original allocations before company attribution existed, then applies the remaining migrations normally. One modern insert captures a real company snapshot. A real API instance uses the restricted eoms_app role (verified non-superuser/non-bypass-RLS). The browser relays API requests to that local fixture service and receives real responses; historical rows are not mocked. One transient 503 is injected explicitly for error recovery. No guards are disabled and no successful audit events are invented.

The assigned clerk's synthetic session is isolated; UI sign-in is covered by existing journeys. The new case checks beyond-first-page historical rows, literal search, exclusion of the modern attributed record, failed-detail/retry and focused handoff, original worker allocations, missing-attribution guidance/source IDs, read-only state, return navigation, reload/reopen, forbidden sibling reads, revocation clearing, explicit restoration and exact before/after preservation of all work/shares/business audit. The fixture closes its API/pools and drops only its generated database.

## Verification scope and baseline

Local: 39 unit/config/security/ledger tests, TypeScript, production build and full formatting checks passed. No new API route, migration, production grant or dependency was added. The full gate executed 120 unit/API tests and 44 desktop/mobile executions. Actual inventory/ledger results are recorded above; they are not whole-product coverage.

Prior verified implementation: e5538c2e487a58357aea7700d7496b76bd551a9e / CI 39133843552. Documentation follow-up 2a773cfb6bd277739c3b8ff83990f7778f6e0e19 / CI 39134599066 passed. Existing regression assertions/timeouts remain active.

## Remaining and next

Source-backed company/block mappings, reconciliation/import review and any governed historical correction model remain open. Production customer bootstrap/setup grants, inherited/custom scopes and other F08–F13 dependencies require explicit acceptance; F06 is not closed by this browser case. Persona/owner/manual UAT, broader F07–F25/business processes, load/production acceptance and the parallel visible recording/one-click reusable runner work remain open. No merge/deploy or hosted-prototype change is included.

## Manual and visible replay

For an existing upgraded local database, open the work review queue, choose a known historical record, inspect original date/allocations and the missing-company warning, expand View historical record references, then Return to unresolved work review. Compare the original source; do not treat today's company as proof. Record actual observation/persona/commit separately from CI.

A freshly seeded database may have no pre-attribution work. Do not remove guards or clear company fields to manufacture such records. After the existing host/Docker test setup, run `npx playwright test jrn-06-historical-work --project=chrome-desktop --headed`, or select E2E-JRN-06-003 in `npm run test:e2e:ui`. This creates and removes its own real upgraded fixture database. The browser opens on the executing computer; remote CI is not owner-visible/manual acceptance.
