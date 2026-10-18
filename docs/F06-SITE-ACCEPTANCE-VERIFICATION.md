# Site journey acceptance: engineering checkpoint

18 October 2026. **F06.5b automated verification complete; F06/manual acceptance remains open.** This compact note contains implementation/testing facts only. The broader client-derived tracker/handoff upload remains excluded following the recorded approval-review rejection.

## Verified source and gate

Tested source: `7d233761cbd913b8f48a93a1e5dbdcfe103af48a`. [CI run 39131106651](https://github.com/kunal1274/ssjns-eoms/actions/runs/39131106651), attempt 1: both verify and quality-gate succeeded. This evidence/checklist follow-up changes documentation only.

- 39 unit/config/security/ledger tests + 78 PostgreSQL/API tests = 117, with zero failures; the same tests and upgrade harness also passed inside Docker.
- All 40 desktop/mobile journey executions passed. E2E-JRN-02-015: 25.5s/25.5s. E2E-JRN-02-016: 7.8s/7.6s. Existing assertions and timeout thresholds remain active.
- Actual inventory: 115 items, 95 mapped and 20 explicit gaps. Actual generated ledger: 190 passed and 40 untested item/project rows across two viewports. This is not whole-product coverage.
- Legacy upgrade, existing browser/maintenance/workflow/PWA/session/offline/installability checks, generated-ledger UI, formatting/type checking/build, zero-known-vulnerability audit and actual Docker build/start/database/proxy/idempotency/persistence checks passed.
- No merge, deployment, owner-desktop observation, manual UAT or F06 phase closure is claimed.

## Delivered behavior

This increment adds explicit site-access refresh and clear-selection recovery. A denied detail/history response removes cached facility/history/editor data and invalidates older responses. A temporary service failure retains recoverable rows/drafts. Setup authority is rechecked separately from estate-linked read access. HTTP recovery errors retain the trusted response status and a safe message, not raw response diagnostics. Audit summaries now show actor display labels, with stable actor IDs in expanded detail. Organization has a direct site-setup navigation link.

Added E2E-JRN-02-015: create all five unlinked types with required/format prevention; page site choices with failed-page recovery and retained draft; type/status filters and checked out-of-filter pin; page/search real history by actor/support reference with retained edit; reload without inventing an estate handoff.

Added E2E-JRN-02-016: assigned viewer/read-only behavior plus direct write denial; setup revocation removes unlinked history/private draft; explicit access restoration checks actions again; estate membership revocation removes detail/history/handoff and rejects a delayed previously authorized history response. Fixtures revoke only their added authority/session data and preserve recorded history.

Local checks passed: 39 unit tests, TypeScript, formatting and production build. The added PostgreSQL/API case covers type/status filters, pin eligibility and actor/reference search. Executed full-gate counts are recorded above.

Prior verified core: source 9039e74a755e326074c2348c34f04e39657b8406 / CI 39127550259. Documentation follow-up b4e95cf4bd9e932047ef25416b895b57f329c596 / CI 39128350227 also succeeded. Existing regressions, established timeouts and server authorization remain active. No merge/deployment. F06/manual/client acceptance remains open.

## Next delivery queue

1. Inventory scoped legacy tasks without explicit block links and historical work without recorded company attribution. Guide explicit approved mapping/remediation; preserve historical identity and never infer a backfill from current labels.
2. Record production customer bootstrap/setup-grant administration and inherited permissions as explicit F08–F13 dependencies, including their effect on F06 closure. A phase deferral needs an accepted gate change.
3. Complete the persona/scope/recovery acceptance matrix and owner manual UAT; keep F06 In progress until blockers or explicit approved deferrals are resolved.
4. Continue F07–F25 and the full business-process scope. Keep owner-visible replay, reviewed recording conversion, local one-click runner and second-project reusable-kit proof as the parallel testing workstream.

Replay after existing host setup: `npx playwright test jrn-02-site-acceptance --project=chrome-desktop --headed`, or select E2E-JRN-02-015/016 in `npm run test:e2e:ui`. The browser opens on the executing computer. The separate hosted prototype is unchanged.

## Candidate history (superseded by the passing run above)

Source 5308134546791c06df43fa32b1223e1a0bb92492 / CI 39129695263: 37 of 40 browser executions passed; three failed. Two exposed Chromium HTML-pattern compatibility, and one exposed navigation before the selected customer context was ready. Neither candidate nor coverage ledger is accepted as green. Corrections retain all assertions and timeouts: escape the pattern hyphen for current HTML regex rules, enable the direct link only for a resolved customer and explicitly focus/scroll its destination. A permission-service retry also clears previously loaded unlinked details if the retry confirms setup authority was revoked. The final full gate above subsequently passed.

Second candidate 1ef5b5459ac6fb91082431b13a4b8f7b9dc81edb / CI 39130500654: 117 unit/API tests and 38 of 40 browser executions passed. Both expanded revocation cases passed; the two remaining failures were the same option-state assertion. The logged element already carried native `disabled`; Playwright's generic enabled-state matcher does not recognize option disabledness. The test now checks the native option `disabled` property directly, retaining the API eligibility assertion and selected detail checks. The final full gate above subsequently passed.

## Owner/manual acceptance checklist

These checks are **pending observation**, independently of CI. Update/rebuild the local Docker branch as described in MANUAL-TESTING.md; use synthetic data and generated development accounts. Start at Organization → select the permitted customer → Go to operational site setup and history.

| Check | User actions | Expected result |
| --- | --- | --- |
| Unlinked creation | Choose Create operational site, type, responsible company, Not linked to an estate, unique code, name and reason; save and reload. | Version 1 persists with the chosen identity and company; no estate handoff appears. Empty/invalid fields prevent submission. |
| Availability and audit | Edit a facility, change name or Active/Paused with a reason; save; expand View site change details. | Version increments once; short audit shows actor/reason; expanded view shows IDs, before/after and support reference. |
| Search, filters and recovery | Search by code/name; change type/status; use More where present. Use Playwright 015 to observe deterministic failed-page/retry recovery. | Explicit selection stays identifiable; an out-of-filter choice is marked unavailable for a new choice; loaded rows and unsaved draft survive a temporary page failure. |
| Read-only access | Sign in with the assigned supervisor account; inspect a linked facility. Use Playwright 016 for isolated setup/membership revocation. | Linked assigned site is readable; create/edit and unlinked setup sites are unavailable. Confirmed revocation clears restricted details/history/draft and does not select another estate. |
| Stale edit | Open a site in two tabs, save a reasoned change in one, then save the older version in the other. | Conflict preserves input. Refresh operational site → Edit operational site loads the current version for deliberate review; no overwrite or invented successful event. |
| Keyboard and phone | Use Tab/Enter through the direct link, search, form and expanded history; inspect at a phone width. | Destination receives focus, fields have clear labels, errors guide recovery, and all required actions remain reachable. Record actual layout/focus problems rather than inferring a pass from viewport CI. |

Record date, tested commit, persona, steps, observed result and any issue/support reference. Remote headless CI is not owner-visible replay or manual usability acceptance. Full F06 and broader product acceptance remain open.
