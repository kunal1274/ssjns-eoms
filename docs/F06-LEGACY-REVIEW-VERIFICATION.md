# Legacy attribution review: engineering checkpoint

18 October 2026. F06.6a scoped queues/task-link automated verification passed for the scope below. F06 remains In progress. This compact checkpoint contains technical facts and synthetic test scope, without retransmitting the blocked full client-derived tracker/handoff payload.

## Later historical-work browser acceptance

The positive historical-work browser gap recorded below is now verified by source `272d2d401498841f1405603276aa07d3197f31e2` / [CI 39142448119](https://github.com/kunal1274/ssjns-eoms/actions/runs/39142448119). See [historical work checkpoint](F06-HISTORICAL-WORK-VERIFICATION.md): real pre-attribution records, focused detail/return, recovery, original allocations/audit, scope loss/restoration and reload passed at both viewports. Full gate: 120 unit/API, 44 executions, ledger 208 passed/40 untested, upgrade/browser/PWA/Docker/persistence success. This supersedes only that acceptance gap; source-backed reconciliation/import and F06/manual acceptance stay open. Original F06.6a evidence below retains its tested scope.

## Verified source and full gate

Branch source `e5538c2e487a58357aea7700d7496b76bd551a9e`, [CI 39133843552](https://github.com/kunal1274/ssjns-eoms/actions/runs/39133843552), attempt 1: verify and quality-gate both succeeded. The PR workflow exercises the generated merge with the base. This evidence/index follow-up changes documentation only.

| Evidence | Actual result |
| --- | --- |
| Unit and PostgreSQL/API | 39 + 81 = 120 passed, zero failures; same suites passed inside Docker. |
| Legacy upgrade | Real pre-attribution rows retained; missing-company pagination/search/detail and RLS passed through migration 017, including inside Docker. |
| Playwright | All 42 desktop/mobile executions passed; E2E-JRN-06-002 took 7.0s / 6.8s. |
| Coverage ledger | 200 passed / 40 untested item/project rows; 120 inventory items / 100 mapped / 20 gaps. No whole-product coverage percentage is claimed. |
| Existing regressions | Browser/maintenance/workflow/PWA/session/offline/installability, generated-ledger UI and existing negative cases passed. |
| Delivery checks | Format/type/build, zero-known-vulnerability audit, actual Docker build/start/database/proxy/idempotency/retained-volume persistence passed. |

No merge/deployment, owner-desktop observation, manual UAT, F06 closure or positive historical-work browser handoff is claimed.

## Delivered behavior

Task capacity → Open legacy attribution review → choose unresolved tasks or work without recorded company → search / Find / More → Review task or Open recorded work. Queue pages recheck estate membership and bind cursors to account, estate, queue and literal search. New partial indexes support unresolved rows; migration 017 changes no historical data or grants. Loaded rows are not a total or completion percentage.

Review task reads its current version and authority. An active-estate manager can open the existing exact-code configured-block review, enter a reason and explicitly save the link. Wrong-estate/block/type/availability/version/role guards remain server enforced. Refresh reviewed task is the explicit conflict recovery. A committed link whose refresh fails offers Refresh saved task; it is not resubmitted. A saved task disappears from the unresolved queue and its retained detail shows the actual short/expanded actor/reason/before/after/support audit.

Temporary list errors preserve loaded rows and the mapping draft. Confirmed scope loss clears cached rows/detail/private input, invalidates delayed responses and never selects another estate. The panel opens on demand to preserve existing task workflows.

Missing historical company attribution remains unresolved and readable. The work queue uses missing recorded attribution, not today's estate company; Open recorded work fetches the scoped actual detail. Task linking changes a current task reference and does not rewrite historical work. Approved import/reconciliation and any governed historical correction model remain separate work, not an automatic backfill.

## Verification scope

Local checks: 39 unit/config/security/ledger tests; TypeScript, production build and formatting passed. Added three real PostgreSQL/API cases for literal paged queues/cursor binding, scoped viewer/foreign/revoked access, current versions/reasoned audit and exclusion of new attributed work. The upgrade harness inserts 28 actual pre-attribution work rows before migration 009 and verifies missing-attribution API pagination, exact search and original detail after migrations through 017. It does not disable guards or fabricate successful history.

Added E2E-JRN-06-002, desktop/mobile: paging plus service retry with retained mapping draft; real capacity-version conflict; committed link/read failure and safe refresh; actual audit and persisted removal from the queue; assigned read-only review and honest empty missing-company guidance; membership revocation clearing private review and rejecting an older authorized detail response. Positive historical-work browser handoff remains an explicit acceptance gap; its real positive API/upgrade path and the empty browser path are distinct evidence.

Inventory and executed counts are recorded above. Existing regressions, timeouts and assertions remain active. Prior verified source 7d233761cbd913b8f48a93a1e5dbdcfe103af48a / CI 39131106651; documentation follow-up 05cfa1d1ac80743d3b07975d2458290d95ae6474 / CI 39131847993 also passed.

## Remaining and next

- Positive browser handoff for real upgraded historical work, source-backed mapping/import review and broader legacy-data reconciliation are not complete.
- Production customer bootstrap/setup-grant administration and inherited/custom scope permissions remain explicit F08–F13 dependencies; do not infer phase closure or an accepted deferral.
- Owner/persona/manual UAT, keyboard/phone usability observation and full F06 acceptance remain open; F07–F25/full business-process scope remains in force.
- Visible replay/recording review, local one-click runner and second-project reusable-kit proof remain the parallel testing workstream.
- No merge, deployment, production-data update or hosted-prototype change.

## Manual and visible check

After the existing local Docker/host setup, open Task capacity → Open legacy attribution review. Search a synthetic unlinked task, review its exact recorded block/version, select a matching configured block, enter a reason and save. Verify one link event, retained identity/capacity/work and removal from unresolved search. In two tabs, change task capacity in one and attempt the old link version in the other: expect a conflict, retained reason and explicit fresh review. With an assigned supervisor, review is read-only. An empty missing-company queue does not prove all migration data is reconciled.

Watch `npx playwright test jrn-06-legacy-review --project=chrome-desktop --headed`, or select E2E-JRN-06-002 in `npm run test:e2e:ui`. The browser opens on the executing computer; remote CI does not constitute owner observation. Record tested commit, persona, steps, observed outcome and issue/support references for manual acceptance.

## Candidate history

Source 0e3b18dca3db8c418cc82db8f8045d76a5db926c / CI 39133271946 was superseded/interrupted. It passed 39 unit + 81 API tests, the real pre-attribution upgrade/read tests and the new desktop journey (7.2s), but provides no completed full gate. Follow-up 849f1aa24b7865f2023c6fc5e4091ffa7dfe1237 / CI 39133556128 stopped at formatting before application checks. The formatting-only correction retained all assertions/timeouts; the final full run above passed. The viewer window now explicitly supplies its base URL, and hierarchy guidance requires selecting the same customer/estate.
