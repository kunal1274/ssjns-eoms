# Legacy attribution review: engineering checkpoint

18 October 2026. F06.6a is implemented; full verification is pending. F06 remains In progress. This compact checkpoint contains technical facts and synthetic test scope, without retransmitting the blocked full client-derived tracker/handoff payload.

## Delivered behavior

Task capacity → Open legacy attribution review → choose unresolved tasks or work without recorded company → search / Find / More → Review task or Open recorded work. Queue pages recheck estate membership and bind cursors to account, estate, queue and literal search. New partial indexes support unresolved rows; migration 017 changes no historical data or grants. Loaded rows are not a total or completion percentage.

Review task reads its current version and authority. An active-estate manager can open the existing exact-code configured-block review, enter a reason and explicitly save the link. Wrong-estate/block/type/availability/version/role guards remain server enforced. Refresh reviewed task is the explicit conflict recovery. A committed link whose refresh fails offers Refresh saved task; it is not resubmitted. A saved task disappears from the unresolved queue and its retained detail shows the actual short/expanded actor/reason/before/after/support audit.

Temporary list errors preserve loaded rows and the mapping draft. Confirmed scope loss clears cached rows/detail/private input, invalidates delayed responses and never selects another estate. The panel opens on demand to preserve existing task workflows.

Missing historical company attribution remains unresolved and readable. The work queue uses missing recorded attribution, not today's estate company; Open recorded work fetches the scoped actual detail. Task linking changes a current task reference and does not rewrite historical work. Approved import/reconciliation and any governed historical correction model remain separate work, not an automatic backfill.

## Verification scope

Local checks: 39 unit/config/security/ledger tests; TypeScript, production build and formatting passed. Added three real PostgreSQL/API cases for literal paged queues/cursor binding, scoped viewer/foreign/revoked access, current versions/reasoned audit and exclusion of new attributed work. The upgrade harness inserts 28 actual pre-attribution work rows before migration 009 and verifies missing-attribution API pagination, exact search and original detail after migrations through 017. It does not disable guards or fabricate successful history.

Added E2E-JRN-06-002, desktop/mobile: paging plus service retry with retained mapping draft; real capacity-version conflict; committed link/read failure and safe refresh; actual audit and persisted removal from the queue; assigned read-only review and honest empty missing-company guidance; membership revocation clearing private review and rejecting an older authorized detail response. Positive historical-work browser handoff remains an explicit acceptance gap; its real positive API/upgrade path and the empty browser path are distinct evidence.

Inventory: 120 items / 100 mapped / 20 gaps. Expected full gate: 39 unit + 81 API = 120 tests, 42 viewport executions and 200 passed / 40 untested item/project ledger rows. These are expectations until execution succeeds. Existing regressions, timeouts and assertions remain active. Prior verified source 7d233761cbd913b8f48a93a1e5dbdcfe103af48a / CI 39131106651; documentation follow-up 05cfa1d1ac80743d3b07975d2458290d95ae6474 / CI 39131847993 also passed.

## Remaining and next

- Positive browser handoff for real upgraded historical work, source-backed mapping/import review and broader legacy-data reconciliation are not complete.
- Production customer bootstrap/setup-grant administration and inherited/custom scope permissions remain explicit F08–F13 dependencies; do not infer phase closure or an accepted deferral.
- Owner/persona/manual UAT, keyboard/phone usability observation and full F06 acceptance remain open; F07–F25/full business-process scope remains in force.
- Visible replay/recording review, local one-click runner and second-project reusable-kit proof remain the parallel testing workstream.
- No merge, deployment, production-data update or hosted-prototype change.

## Manual and visible check

After the existing local Docker/host setup, open Task capacity → Open legacy attribution review. Search a synthetic unlinked task, review its exact recorded block/version, select a matching configured block, enter a reason and save. Verify one link event, retained identity/capacity/work and removal from unresolved search. In two tabs, change task capacity in one and attempt the old link version in the other: expect a conflict, retained reason and explicit fresh review. With an assigned supervisor, review is read-only. An empty missing-company queue does not prove all migration data is reconciled.

Watch `npx playwright test jrn-06-legacy-review --project=chrome-desktop --headed`, or select E2E-JRN-06-002 in `npm run test:e2e:ui`. The browser opens on the executing computer; remote CI does not constitute owner observation. Record tested commit, persona, steps, observed outcome and issue/support references for manual acceptance.
