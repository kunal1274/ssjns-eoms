# Current engineering evidence

18 October 2026. Full F01–F25/product scope remains in force; F06 is In progress, F07+ not started. F05 owner exception permits development progression and remains a release consideration. No merge/deploy authorization is implied.

Latest verified implementation: `e5538c2e487a58357aea7700d7496b76bd551a9e` / [CI 39133843552](https://github.com/kunal1274/ssjns-eoms/actions/runs/39133843552), verify and quality-gate success. Actual proof: 39 unit + 81 PostgreSQL/API = 120 tests; all 42 desktop/mobile executions; ledger 200 passed/40 untested rows; real pre-attribution upgrade/read checks through migration 017; existing browser/PWA and Docker/proxy/idempotency/persistence gates. New legacy review journey: 7.0s desktop / 6.8s mobile. This index follow-up changes documentation only. See [legacy review checkpoint](F06-LEGACY-REVIEW-VERIFICATION.md) for implemented behavior, candidate history, actual-versus-expected evidence and remaining acceptance.

Prior verified site acceptance: 7d233761cbd913b8f48a93a1e5dbdcfe103af48a / CI 39131106651, including 117 unit/API tests, 40 desktop/mobile executions and the complete upgrade/browser/PWA/Docker/proxy/persistence gate. See [site acceptance checkpoint](F06-SITE-ACCEPTANCE-VERIFICATION.md). Documentation-only follow-up 05cfa1d1 / CI 39131847993 passed.

Next after the current gate: positive real historical-work browser handoff; source-backed attribution/mapping/import review; explicit bootstrap/setup-grant/inheritance dependencies; persona and manual UAT. Historical attribution is never guessed or silently rewritten. Continue full business processes and the parallel visible replay/recording/reusable local-runner workstream.

Use exact tested source/run identifiers. An interrupted, failed, filtered or documentation-only run is not new complete application evidence. Older public tracker/handoff pending statements may lag these compact engineering notes; the full refreshed client-derived payload remains excluded following its approval-review rejection.
