# STM EOMS · PERN foundation

Connected PERN development foundation for the Estate Opera EOMS project. The related hosted demo was created within ChatGPT; this repository provides the React + Express/Node + PostgreSQL implementation. Exact parity with the hosted rendered artifact is not claimed until its journeys are traced. Synthetic data only; not a production release.

## Start locally

Prerequisites: Node 24.x, npm, Docker Compose, and Chrome for browser tests. Run all commands from this repository, not an ancestor directory.

```sh
node scripts/setup-env.mjs
docker compose up --build -d --wait api web
docker compose --profile tools run --rm seed
```

Open http://localhost:5174. Use the same hostname as the configured CSRF origin. The API, web and PostgreSQL now run from the shared repository in containers. The seed is explicit and development-only. Generated credentials are in a private named volume; inspect locally using the command in [F04 Docker environment](docs/F04-DOCKER-ENVIRONMENT.md). Database/account volumes survive `docker compose down`; deleting volumes is destructive.

For host-run development instead, install with `npm ci`, run `docker compose up -d --wait postgres`, then `npm run db:migrate`, `npm run db:seed`, `npm run db:test`, `npm run dev:api` and (in another terminal) `npm run dev:web`. Host-run credentials are in the ignored host `.local/dev-accounts.json`; they are separate from Docker tooling's account volume. Do not alternate seed locations against a populated database and expect a new credentials file to be generated. Use one workflow for a given development database.

See [F04 Docker environment](docs/F04-DOCKER-ENVIRONMENT.md) for clean setup, integration checks, persistence, reset boundaries and recorded execution evidence. This is an implementation environment; production startup remains intentionally blocked.

## Working flow

Sign in → New muster → select task/date/workers/area → Save draft → View → Confirm muster → Audit trail. Confirmation is atomic with audit and outbox event creation. Confirmed records survive reload/restart. Each selected worker receives one man-day and an equal area share, with integer hundredths conserving the total. This is one explicitly limited workflow, not complete wage or payroll computation.

Seeded operational periods: September and October 2026. Out-of-period dates reject writes. Managers can add periods and lock/reopen them in Operational periods. A reason is required for a status change.

## Verification

```sh
npm test
npm run test:integration
npm run build
npm audit
npm run test:browser
npm run test:maintenance-browser
npm run test:workflow-browser
npm run verify:browser
```

Integration tests use separate `eoms_test`, with synthetic fixtures. Individual browser tests require running API/web servers and installed Chrome. The combined `verify:browser` runner starts and stops its own servers on ports 4200/4201/5274/5275 and uses isolated synthetic fixtures in the development database. It requires a prior build and seeded development/test databases. It is regression verification, not a load test. Desktop/mobile screenshots are in `docs/`. Domain and API tests were first observed failing against unimplemented code, then passed after implementation.

## Design and current boundaries

- Restricted non-superuser runtime database role, forced row-level security and estate membership checks. Company access derives from accessible estates. Cross-estate foreign keys prevent foreign worker/task attachment.
- Role checks in Express; database policies enforce estate boundaries. Role-specific write authorization still depends on the trusted API. Production connection identity, pooled-context strategy and security review remain required.
- Hashed opaque server sessions, HttpOnly SameSite cookies, Origin + CSRF validation, password hashing, request size limits and login throttling. This is local development identity; SSO/MFA, account provisioning and distributed throttling remain open.
- Indexed, bounded keyset muster pagination. Millions of operational records is the sizing target; no million-row capacity result is claimed. The UI uses searchable keyset-paginated worker/task catalogs (25 per page, maximum 100). Legacy reference endpoints remain capped for compatibility. Search indexes are present; representative load benchmarking is still required.
- Task occurrence lock serializes confirmation against the same area budget. Idempotency keys deduplicate create retries; version checks reject stale draft confirmation. Audit is append-only for the runtime role, not tamper-proof against database administrators.
- Integration outbox records confirmation events atomically. No dispatcher, SAP/HR connection or external acknowledgement is implemented yet.
- React web layout is responsive. The initial PWA shell and device-draft queue are implemented with the limits described below. Full cold-start offline field operation and React Native remain future milestones. React Native will reuse API contracts/domain logic; web UI requires adaptation.
- Effective-dated gang/worker rosters, block restrictions, full role matrix, additional master-data workflows, other activities, allocation modes, multi-stage approval and correction flows, deductions, payroll, reports and business rule sign-off remain in the broader execution plan.
- Production startup is intentionally gated in `server.ts` until hosting, identity, recovery, monitoring, security and tenancy decisions are implemented and validated.

## Git and handoff

This folder is the repository root. Secrets, generated credentials, dependencies and build output are ignored. Remote: https://github.com/kunal1274/ssjns-eoms.git. Windsurf can open this same folder and continue from the tests and migration history. See `docs/STATUS.md` and `docs/VERIFICATION.md` for the current checkpoint.

## Manager maintenance milestone

Managers now use Workers to add, rename, deactivate/reactivate workers; Task capacity to add occurrences and edit area budgets; and Operational periods to add, lock and reopen months. Supervisors and clerks can inspect these lists but cannot maintain them. Updates use optimistic versions; stale changes return 409 and require refresh. No records are hard-deleted. Worker deactivation excludes future selection; historical allocations remain intact. Existing drafts are not automatically invalidated by worker deactivation.

Task identity is immutable in this slice. Capacity changes lock the same occurrence row as confirmation and cannot reduce below confirmed area. Draft totals are not reserved; they are checked at confirmation. Period updates lock the same row used by capture/confirmation, so committed closure blocks subsequent writes. Reopening remains a single-manager operation pending client approval of the final approval matrix.

`test:maintenance-browser` creates synthetic workers/tasks and a far-future period to avoid closing operational months. It verifies create/edit/search/lock/reopen and captures desktop/mobile evidence.

## Gang and review milestone

Use Gangs to register gangs and assign existing estate supervisors. New muster capture selects an active registered gang. The API checks current assignments on supervisor creation and confirmation; managers may operate any active gang in their estate. Assignment changes take effect immediately, use optimistic versions, and retain before/after audit evidence. Estate-wide read access remains unchanged. This is not yet effective-dated worker membership, borrowing or block-level authorization. The supervisor picker currently returns up to 200 eligible staff; larger directories require pagination.

After confirmation, a manager can approve work or reverse it with a reason. Development default: same-manager confirmation/review is allowed, with no second approver. This rule remains provisional pending client sign-off. Approval leaves operational status confirmed and records a separate review state. Reversal is terminal: original quantities/shares, confirmation and approval evidence remain, while current task totals exclude the reversed work. Duplicate or stale transitions return 409; refresh to inspect the persisted outcome. Audit and outbox events commit in the same transaction. Locked months reject review/reversal.

This is an operational reversal only. No payroll/SAP reversal is sent, and no automatic replacement or linked correction document is created. Posted-period protection, configurable approval stages, formal unlock/correction lineage and partner compensation must be implemented before live integrations.

Migration 004 registers historical free-text gang codes without granting new assignments. Managers must explicitly assign supervisors to those historical gangs before further confirmation. The development seed creates G-01 and assigns seeded estate supervisors to it; rerunning that development-only seed restores those demonstration assignments. No historical muster is deleted or renamed.

## PWA and device drafts

Build once with `npm run build`. In separate terminals run `npm run dev:pwa-api` and `npm run preview:pwa`, then open http://localhost:5175. The existing http://localhost:5174 development UI remains available, but its hot-reload server does not register the built service worker. Both use the same development PostgreSQL database; each browser origin has its own local draft queue.

Sign in online, select the estate and load the task, gang and workers. Save on device explicitly, or disconnect while keeping the signed-in tab open and use Save on device. Reconnect and choose Sync drafts. Acknowledged items become server drafts and leave the queue. Confirmation, review and reversal are separate online actions. No automatic/background posting occurs.

The built app has a manifest, icons and a versioned static-only service-worker cache. Install app appears when the browser exposes its installation prompt; otherwise use the browser's installation menu. Close existing app tabs and reopen to activate a waiting build update. API responses, authentication credentials and server masters are never cached by the service worker.

Device drafts use IndexedDB and are separated by account. Sync validates the active server identity, uses the original immutable idempotency key, and coordinates tabs through Web Locks. A lost response or server/session failure retains pending work. Validation/permission/period conflicts become Needs review. Fix the cause, choose Retry after correction and sync again; the payload/key remain unchanged. To change captured values, discard and re-enter after checking for an earlier server acknowledgement.

Sign out requires connectivity and prompts before discarding unsynced device data. Browser storage is not encrypted by this app and may be evicted or cleared; use trusted devices. Offline capture works only with references loaded in the currently open authenticated session. Offline reload loads the shell but requires reconnection/authentication before viewing or syncing queued drafts. This is not yet a complete secure cold-start offline field application. Encryption/device provisioning, persistent offline reference preparation, revocation policy and full disconnected authentication are later work.

## Automated checks

GitHub Actions runs unit/sync and PostgreSQL integration tests, the build, all four browser workflows, Chrome manifest/installability diagnostics and the dependency audit on pushes to main and pull requests. Actions are pinned to immutable revisions; the job has read-only repository permissions. CI databases/accounts are disposable and independent of local credentials. See `docs/MILESTONE-CLOSEOUT.md` for the delivered checkpoint and explicit future work.

## F05 quality and safe API errors

Run `npm run format:check`, `npm test` and `npm run build` locally; database/browser/Docker checks remain mandatory in CI. API error responses preserve the human-readable `error` string and add a stable `code`, server `requestId` and matching `X-Request-ID`. Application failure logs use allowlisted metadata rather than raw exception messages.

The final `quality-gate` CI job fails for failed, cancelled or skipped verification. Enforcing that job on main also requires repository-admin branch protection; it has not been enabled by a source commit. See [F05 quality gates](docs/F05-QUALITY-GATES.md) for evidence, image/dependency promotion and the exact remaining administrator action. Full production security and deployment acceptance remain open.

## Watch and record browser journeys

After the host verification prerequisites above are ready, run `npm run test:journeys:visible` to watch the existing regression scenarios in Chrome on your computer. Actions are slowed for observation; the current suite covers selected journeys, not every field in the product.

With the development API/web already running at http://localhost:5174, use `npm run test:journeys:record` to open Playwright's recorder. It writes an ignored draft to `.local/recorded-journey.spec.ts`. Use synthetic accounts/data; review recorded inputs before sharing. The generated draft targets the installed Playwright Test runner and needs fixtures/assertions/review before it becomes a regression case. The single-click dashboard and cross-project kit are planned in [the workbench plan](docs/PLAYWRIGHT-JOURNEY-TEST-PLAN.md#visible-testing-manual-recording-and-reusable-test-workbench).

## Interactive Playwright test UI

The first journey is available in Playwright UI mode. After host test setup and `npm run db:test`, run `npm run test:e2e:ui`, select E2E-JRN-07-001 and press Run. Use `npm run test:e2e:headed` for a visible browser, `npm run test:e2e` for headless regression, or `npm run test:e2e:report` for the latest generated HTML report. See [setup, recording review and current limits](docs/PLAYWRIGHT-WORKBENCH-QUICKSTART.md).

## Continuing this project

Start with [the current handoff](docs/CURRENT-HANDOFF.md) and [phase tracker](docs/PROGRESS.md). Repository instructions in AGENTS.md preserve the full EOMS goal, audit/feedback requirements, testing workstream, remaining gates and next action across sessions.

## Field/action coverage ledger

After a journey run, use `npm run test:coverage` and open `.local/e2e-ledger/index.html`. The local view filters actual assertion evidence and open gaps by status/screen, with stale-source detection. No run means no passing evidence. See [scope, status rules and how to extend it](docs/PLAYWRIGHT-COVERAGE-LEDGER.md).

## Organization context — F06 first increment

Open Organization to choose an accessible customer, review its legal company and your assigned estates, inspect recorded customer display changes, then open an estate register. Hierarchy setup also supports optional legal groups/company assignment and division/optional-field/block creation and editing for explicitly granted setup administrators. A manager role alone is insufficient. Saves require a reason and reject stale versions; recent changes offer short and detailed history. It does not grant sibling-estate access or complete the hierarchy phase. Migration 005 preserves legacy IDs and adds explicit customer/company/estate boundaries. [F06 scope and remaining steps](docs/F06-CUSTOMER-HIERARCHY.md).
