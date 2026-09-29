# STM EOMS · PERN foundation

First connected development milestone, separate from the approved UI demo. React + Express/Node + PostgreSQL with TypeScript. Synthetic data only; not a production release.

## Start locally

Prerequisites: Node 24+, npm, Docker Compose, and Chrome for browser tests. Run all commands from this repository, not an ancestor directory.

```sh
npm ci
node scripts/setup-env.mjs
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run db:test
npm run dev:api
```

In another terminal in the same repository:

```sh
npm run dev:web
```

Open http://localhost:5174 (use localhost, which matches the configured CSRF origin). Development credentials are generated in `.local/dev-accounts.json`; inspect them locally. They are not committed. Manager sees both seeded estates; each supervisor sees their estate; clerk has read access. Database persists in a dedicated Docker volume. Do not delete that volume unless you intend to discard this development data.

## Working flow

Sign in → New muster → select task/date/workers/area → Save draft → View → Confirm muster → Audit trail. Confirmation is atomic with audit and outbox event creation. Confirmed records survive reload/restart. Each selected worker receives one man-day and an equal area share, with integer hundredths conserving the total. This is one explicitly limited workflow, not complete wage or payroll computation.

Seeded operational periods: September and October 2026. Out-of-period dates reject writes. New periods require an administrative migration/maintenance operation until the period-management workflow is built.

## Verification

```sh
npm test
npm run test:integration
npm run build
npm audit
npm run test:browser
```

Integration tests use separate `eoms_test`, with synthetic fixtures. Browser tests require running API/web servers and installed Chrome; they create one labelled QA muster in the development estate, using 0.10 Ha of its first task. They are a smoke check, not an unrestricted repeatable load test. Desktop/mobile screenshots are in `docs/`. Domain and API tests were first observed failing against unimplemented code, then passed after implementation.

## Design and current boundaries

- Restricted non-superuser runtime database role, forced row-level security and estate membership checks. Company access derives from accessible estates. Cross-estate foreign keys prevent foreign worker/task attachment.
- Role checks in Express; database policies enforce estate boundaries. Role-specific write authorization still depends on the trusted API. Production connection identity, pooled-context strategy and security review remain required.
- Hashed opaque server sessions, HttpOnly SameSite cookies, Origin + CSRF validation, password hashing, request size limits and login throttling. This is local development identity; SSO/MFA, account provisioning and distributed throttling remain open.
- Indexed, bounded keyset muster pagination. Millions of operational records is the sizing target; no million-row capacity result is claimed. Reference lists currently cap at 200 workers / 100 tasks and need searchable pagination before large-estate rollout.
- Task occurrence lock serializes confirmation against the same area budget. Idempotency keys deduplicate create retries; version checks reject stale draft confirmation. Audit is append-only for the runtime role, not tamper-proof against database administrators.
- Integration outbox records confirmation events atomically. No dispatcher, SAP/HR connection or external acknowledgement is implemented yet.
- React web layout is responsive. PWA installation, offline queue/conflict resolution and React Native are future milestones. React Native will reuse API contracts/domain logic; web UI requires adaptation.
- Gang assignment restrictions, full role matrix, master-data CRUD, other activities, allocation modes, approval/reversal flows, deductions, payroll, reports and business rule sign-off remain in the broader execution plan.
- Production startup is intentionally gated in `server.ts` until hosting, identity, recovery, monitoring, security and tenancy decisions are implemented and validated.

## Git and handoff

This folder is the repository root. Secrets, generated credentials, dependencies and build output are ignored. Connect the client-selected remote after its URL is supplied. Windsurf can open this same folder and continue from the tests and migration history. See `docs/STATUS.md` and `docs/VERIFICATION.md` for the current checkpoint.
