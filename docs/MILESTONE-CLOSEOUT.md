# Built-milestone closeout

The user's confirmed scope is to complete the milestones built so far. The original enterprise EOMS scope is larger and is not being represented as finished.

| Delivered slice | Working behavior | Evidence |
| --- | --- | --- |
| PERN foundation | Persistent muster workflow, session authentication, scoped roles/RLS, task budget concurrency and audit/outbox transactions | API tests and capture browser test |
| Maintenance | Worker name/status, task creation/capacity, operational period create/lock/reopen, version conflicts and search pagination | Maintenance API/browser tests |
| Gang and review | Supervisor assignments enforced on writes; manager review and terminal reasoned reversal; original evidence retained | Workflow API/browser tests |
| Initial PWA | Installable static shell, durable account-labelled device drafts, explicit sync, stable retry IDs, conflict retention/retry and logout discard protection | Sync tests, offline browser test, Chrome installability diagnostics |
| Delivery automation | Build, unit/API/browser tests and dependency audit in pinned GitHub Actions workflow | Local repeatable runner; hosted result checked after push |

## Using the checkpoint

- Development UI: http://localhost:5174.
- Built PWA preview: http://localhost:5175. Start with the README's two PWA commands if not running.
- Sign in with the generated local accounts in `.local/dev-accounts.json`. Credentials are excluded from Git.
- Test data includes labelled QA tasks, records and far-future periods. This is a synthetic development environment.
- Draft sync creates server drafts; it never confirms or posts payroll automatically.

## Limits that remain intentional

- Offline capture uses already-loaded references in an open signed-in tab. After offline reload, reconnect to authenticate; queued drafts are retained. No app-level encryption or offline identity provisioning is implemented.
- Gang scope currently controls capture/confirmation, not estate-wide reads. Effective-dated worker rosters, borrowing and block assignment remain future slices.
- Manager-only review/reversal is provisional. Reversal is operational, not an SAP/HR compensation workflow. Formal unlock/replacement lineage and configurable approval stages remain future slices.
- Task occurrence semantics, company database topology and payroll rules still require client sign-off.
- The outbox persists events but has no live dispatcher/adapters. Other original modules, million-record benchmarks, production identity, recovery validation and rollout are not delivered here.

## Verification commands

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run db:test
npm test
npm run test:integration
npm run build
npm run verify:browser
npm audit --audit-level=high
```

Database setup assumes the local `.env` and PostgreSQL are ready as documented in README. `verify:browser` expects Chrome and free verification ports; it does not terminate unrelated processes. Avoid running regression scripts against real operational data.

Technical references used for the offline design: [MDN service-worker lifecycle and caching](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).
