# F06.6c2 saved reconciliation review

Implemented candidate, 19 October 2026; full database/browser/container verification pending. F06 remains In progress. No phase closure, merge or deployment.

A manager who also has customer setup authority can preview a manifest, enter a retention reason, save a freshly evaluated immutable snapshot, reopen it and read short/detailed actual audit. Migration 018 adds forced-RLS review/audit tables with append-only guards. No historical work, allocations, company attribution or task link is changed by saving. Source evidence remains explicitly unverified. Saving blocked proposals retains their problems for review; it does not grant approval or import authority.

Save identity is scoped by estate, actor and retry UUID. Concurrent/repeated identical submissions return the original record and create one audit event; changed content under the same identity conflicts. The UI keeps an uncertain save's payload/key unchanged for retry, disables edits while recovery is pending and prevents repeated successful submission until a new preview. Private drafts/keys are in memory; closing/reloading can recover a committed review through the saved list, but does not preserve an uncommitted draft. All list/detail/retry requests recheck manager, membership and setup authority. Actual audit records retain actor, original server request reference, reason, digest and time; a replay does not invent another event.

## Manual and visible replay

Use the branch's shared local environment and a deliberately provisioned manager with setup authority; no automatic grant is created. Task capacity → Open legacy attribution review → Open source mapping preview → upload/paste version-1 manifest → Preview source mappings → retention reason → Save review snapshot → Open saved review → short audit / View detailed review audit. Load saved manifest for revalidation starts a fresh preview; old saved results remain a snapshot of their save time.

Run E2E-JRN-06-005 with `npm run test:e2e:ui -- --grep E2E-JRN-06-005` or `npm run test:e2e:headed -- --grep E2E-JRN-06-005` after local test prerequisites. Four named steps cover committed-response loss/retry, reload/audit, stale revalidation and authority loss, using actual upgraded PostgreSQL and restricted-role API. Existing tests and thresholds remain active. CI browser execution is headless and does not display on the owner's computer. The hosted Sites prototype does not receive these repository changes.

## Remaining delivery

Original source evidence authentication; independently governed decisions/approval/application or overlay policy; high-volume staging, row reconciliation and rollback; actual client-data/manual/persona acceptance; explicit production bootstrap/setup-grant/inheritance dependencies. Continue full F01–F25 scope and reusable visible replay/manual-recording workstream. Saved review storage alone closes none of these gates.
