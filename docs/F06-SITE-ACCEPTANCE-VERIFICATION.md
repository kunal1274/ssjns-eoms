# Site journey acceptance: engineering checkpoint

18 October 2026. **Implemented; full CI verification pending.** This compact note contains implementation/testing facts only. The broader client-derived tracker/handoff upload remains excluded following the recorded approval-review rejection.

This increment adds explicit site-access refresh and clear-selection recovery. A denied detail/history response removes cached facility/history/editor data and invalidates older responses. A temporary service failure retains recoverable rows/drafts. Setup authority is rechecked separately from estate-linked read access. HTTP recovery errors retain the trusted response status and a safe message, not raw response diagnostics. Audit summaries now show actor display labels, with stable actor IDs in expanded detail. Organization has a direct site-setup navigation link.

Added E2E-JRN-02-015: create all five unlinked types with required/format prevention; page site choices with failed-page recovery and retained draft; type/status filters and checked out-of-filter pin; page/search real history by actor/support reference with retained edit; reload without inventing an estate handoff.

Added E2E-JRN-02-016: assigned viewer/read-only behavior plus direct write denial; setup revocation removes unlinked history/private draft; explicit access restoration checks actions again; estate membership revocation removes detail/history/handoff and rejects a delayed previously authorized history response. Fixtures revoke only their added authority/session data and preserve recorded history.

Local checks pass: 39 unit tests, TypeScript, formatting and production build. Added one PostgreSQL/API case for type/status filters, pin eligibility and actor/reference search. Inventory is 115 items / 95 mapped / 20 gaps. Expected full results are 117 unit/API tests, 40 viewport executions and 190 passed / 40 untested viewport ledger rows; these are expectations, not executed CI proof.

Prior verified core: source 9039e74a755e326074c2348c34f04e39657b8406 / CI 39127550259. Documentation follow-up b4e95cf4bd9e932047ef25416b895b57f329c596 / CI 39128350227 also succeeded. Existing regressions, established timeouts and server authorization remain active. No merge/deployment. F06/manual/client acceptance remains open.

Next after verification: reconcile remaining model/provisioning/legacy-attribution dependencies and prepare explicit F06 acceptance evidence; continue broader identity/permissions/business flows and visible testing work. No whole-product coverage claim is made.

Replay after existing host setup: `npx playwright test jrn-02-site-acceptance --project=chrome-desktop --headed`, or select E2E-JRN-02-015/016 in `npm run test:e2e:ui`. The browser opens on the executing computer. The separate hosted prototype is unchanged.

## First acceptance candidate

Source 5308134546791c06df43fa32b1223e1a0bb92492 / CI 39129695263: 37 of 40 browser executions passed; three failed. Two exposed Chromium HTML-pattern compatibility, and one exposed navigation before the selected customer context was ready. Neither candidate nor coverage ledger is accepted as green. Corrections retain all assertions and timeouts: escape the pattern hyphen for current HTML regex rules, enable the direct link only for a resolved customer and explicitly focus/scroll its destination. A permission-service retry also clears previously loaded unlinked details if the retry confirms setup authority was revoked. Fresh full verification follows.
