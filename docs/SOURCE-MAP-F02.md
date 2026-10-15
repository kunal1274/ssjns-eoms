# F02 — Source-to-test map for the current EOMS slice

**Status:** Working evidence map; not a complete approved requirements baseline.  
**Branch:** `planning/production-roadmap-data-security`  
**Current CI evidence:** [GitHub Actions run #9](https://github.com/kunal1274/ssjns-eoms/actions/runs/38784677797)

This map names current source locations and test cases so later work can distinguish implemented behavior from missing requirements. A passing test proves only the scenario it asserts.

## Route and capability mapping

| Capability | Source | Existing tests/evidence | Known boundary |
|---|---|---|---|
| Login, session and logout | `apps/api/src/app.ts`: `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`; `apps/api/src/security.ts` | `tests/api.test.ts`: “unauthenticated API access fails”; “session is real, scoped and invalidated on logout”; “wrong password, cross-origin write and missing CSRF are rejected” | No complete invitation, recovery, MFA/SSO, session-admin or production identity lifecycle. |
| Estate listing and scope checks | `apps/api/src/app.ts`: `GET /api/estates`, `estateTx`, per-estate routes | `tests/api.test.ts`: “cross-estate routes are denied; database RLS also filters unscoped SQL”; “cross-estate worker IDs fail reference validation” | Current security boundary is estate membership; full customer/group/division/block inheritance is absent. |
| Muster creation and shares | `apps/api/src/app.ts`: `POST /api/estates/:estateId/musters`; transaction, task/gang/worker validation, allocation, audit and idempotency | `tests/allocation.test.ts`; `tests/api.test.ts`: “create is persistent and idempotent; changed payload conflicts”; “concurrent confirmations cannot exceed task cap” | Not full attendance/checkroll/payroll. Wage, OT, incentive, deduction and financial rounding rules need approved requirements. |
| Confirmation, review and reversal | `apps/api/src/app.ts`, `apps/api/src/workflow.ts` | `tests/api.test.ts`: clerk restriction, stale version and locked-period tests; `tests/workflow.test.ts`: “approval and reversal are manager-only, versioned, immutable and release area once”; “locked periods reject review and reversal; assignment removal blocks confirmation” | Same-manager review is provisional; reversal is not payroll/SAP compensation. |
| Worker, task and period maintenance | `apps/api/src/maintenance.ts` | `tests/api.test.ts`: “manager maintains workers; stale updates and supervisor writes fail”; “task maintenance validates capacity, duplicate identity and confirmed work”; “period lifecycle is manager-only, versioned, audited and enforces lock”; “catalog pagination is bounded and preserves search and tenant filters” | Effective-dated rosters, borrowing, block assignment and HR lifecycle remain absent. |
| Gang and supervisor assignment | `apps/api/src/workflow.ts` | `tests/workflow.test.ts`: “manager registers gangs and assignments; unassigned supervisor cannot capture” | Assignment controls capture/confirmation; it is not yet a general read-scope rule and is not effective-dated. |
| Audit write protection | `apps/api/src/app.ts`; migration 001 audit table and grants | `tests/api.test.ts`: “runtime cannot modify audit and has no RLS bypass privileges” | Audit reads have no separate permission; sensitivity and retention policy require owner decision. |
| Offline draft sync | `packages/domain/` sync logic and PWA code; README and `docs/MILESTONE-CLOSEOUT.md` | `tests/sync.test.ts`: current-account isolation, lost-response retry, conflict/session/server failure handling; browser checks in CI run #9 | Needs an already loaded signed-in tab for offline capture; no app-level encryption or cold-start offline identity. |
| Migrations and runtime security | `db/migrations/001_foundation.sql` through `004_gangs_review.sql`; `apps/api/src/server.ts` | `scripts/test-db.ts`, `tests/api.test.ts`, CI run #9 | Current role check rejects superuser and RLS bypass but does not verify every role attribute; pooled-context regression tests should be expanded. |

## Schema and data-level security map

| Objects | Present purpose | Follow-up |
|---|---|---|
| `users`, `sessions` | Local account and session storage | Migration 001 grants runtime SELECT on users (including password hashes) and SELECT/INSERT/DELETE on sessions; neither table has RLS there. Design narrow auth access before changing grants. |
| `companies`, `estates`, `memberships` | Company-to-estate relationship and fixed roles | Add agreed customer/group/division/block model and scope inheritance in F06/F12. |
| `workers`, `occurrences`, `periods` | Worker catalog, block/task occurrence capacity, operational lock period | Block is currently a code on an occurrence, not a secured entity. |
| `musters`, `muster_shares`, `idempotency` | Captured work, worker shares and retry idempotency | Musters has a table-level UPDATE grant; restrict mutable columns and test direct mutation denial. |
| `audit`, `outbox` | Operational history and persisted event intent | Audit has runtime INSERT-only access and tests against mutation; no live outbox dispatcher/adapters were found. |
| `gangs`, `gang_supervisors` | Gang registry and supervisor assignments | Gangs has table-level UPDATE grant; review least privilege. RLS is estate-level. |

## Verification baseline

Run #9 passed the existing workflow: clean `npm ci`, migrations and seed, isolated database tests, 5 domain/sync tests, 18 API/workflow integration tests, build, browser/PWA verification and `npm audit --audit-level=high` (0 vulnerabilities). The tests use synthetic data and a restricted runtime role for application behavior.

This does not cover all F02 requirements, prove production capacity, certify the security design, or establish exact parity with the ChatGPT-hosted rendered artifact.

## Next traceability actions

1. Give every approved requirement a stable ID and link it to its source document/owner decision.
2. Link each requirement to the exact API, schema, UI and test location where implemented.
3. Add positive, negative, boundary, concurrency and recovery acceptance cases for uncovered requirements.
4. Mark requirements as implemented, partial, missing or blocked based on evidence.
5. Obtain owner review before F02 is accepted and F03 begins.
