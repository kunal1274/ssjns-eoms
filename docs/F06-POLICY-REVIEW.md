# Versioned mapping policy design review

23 October 2026. Verified implementation: `a638bc4a991d8fc69198c77d9a118d9001a2f405` / [CI39972578640](https://github.com/kunal1274/ssjns-eoms/actions/runs/39972578640), verify and quality-gate success. Actual proof:51 unit/contract +106 PostgreSQL/API =157 tests, zero failures; all56 desktop/mobile executions; ledger256passed/40untested item/project rows (148items/128mapped/20gaps), not whole-product coverage. E2E-JRN-06-009 took4.0s desktop/3.9s mobile. Upgrade through022, earlier browser/PWA/installability, format/type/build, zero-finding dependency audit and full Docker gates passed. Docker repeated157 tests and proved actual proxy policy proposal/independent review/exact retry plus persisted policy/review/source audit after removal/recreation with retained volumes; earlier2MiB/retry/work persistence checks remain active. This proof/index follow-up changes documentation only. First candidate499ccf8 / CI39970849847 passed its157 tests/56 executions but failed the dependency audit before Docker. The replacement above includes Vite7.3.7/ip-address10.7.4 fixes, long-criteria mobile wrapping/overflow proof and an explicit superseded-review retry assertion.

F06 remains In progress. This increment records R0 design proposals and individual review statements; it does not activate business policy, approve mappings, authenticate sources or modify historical facts. Authoritative owner/client policy, role and custody acceptance remain open. Full F01–F25 and reusable visible testing remain delivery scope.

## Ten connected delivery steps

| Step | Capability | Current status |
| --- | --- | --- |
| 1 | Strict R0 proposal contract with explicit custody, independent approver and evidence/concern criteria; eight fixed safeguards | Implemented and automatically verified in CI39972578640 |
| 2 | Persist immutable estate-scoped policy versions with predecessor, actual actor, reason, support reference and database-computed SHA-256 | Implemented and automatically verified in CI39972578640 |
| 3 | Serialize competing versions and bind exact retries to actor/key/content; reject stale revisions and changed retries | Implemented and automatically verified in CI39972578640 |
| 4 | Forced RLS, narrow database functions and scoped list/detail pagination; no direct application-table writes | Implemented and automatically verified in CI39972578640 |
| 5 | Independent design review bound to exact version/digest; linked reviewer corrections and current-per-reviewer totals | Implemented and automatically verified in CI39972578640 |
| 6 | Guided criteria authoring, fixed safeguard explanation and validation before save | Implemented and automatically verified in CI39972578640 |
| 7 | Inspect short/detailed proposal/review history; copy criteria into a new version; preserve superseded history | Implemented and automatically verified in CI39972578640 |
| 8 | Frozen uncertain submissions with exact receipt recovery; stale/conflict guidance, failed-read recovery and denied-scope clearing | Implemented and automatically verified in CI39972578640 |
| 9 | Connect fresh mapping readiness to the latest recorded design version, while retaining disabled approval/application | Implemented and automatically verified in CI39972578640 |
| 10 | Real PostgreSQL/API adversarial tests, stable visible journey, coverage bindings, Docker retry/persistence proof and manual replay guide | Implemented and automatically verified in CI39972578640 |

A separate current estate manager with customer setup permission can record a design review of another author's current proposal. This is an implementation collaboration boundary using existing permissions, not the future production mapping approver role. Outcomes are changes requested, not supported, or support for design only. No voting threshold is inferred. Aggregate counts are descriptive; statements stay visible after reviewer revocation and reflect authority when recorded, not an ongoing authorization permit. Superseding a policy closes new reviews of the old version but permits recovery of an already committed exact retry. Earlier proposals/reviews remain immutable.

Digest covers PostgreSQL's canonical JSONB text of the stored normalized proposal plus fixed safeguards, encoded UTF-8 and SHA-256 hashed in the database. It is not the original evidence-file digest or a signature. Read-only readiness references the current proposal, not an accepted executable policy. No mapping decision/application endpoint is introduced.

## Manual and visible replay

On the PERN checkout/Docker environment, sign in as an estate manager who has customer setup access. Open Task capacity → Open legacy attribution review → Open source mapping preview → Mapping policy design review.

1. Fill all three proposed criteria (10–2000 characters) and the proposal reason (3–500). Save and inspect the version, criteria, fixed safeguards and detailed provenance. The author cannot independently review that version.
2. Sign in as a separate authorized manager with customer setup access. Inspect that exact version; record a reference, reason and design outcome. Correct it with a new linked review revision. Inspect both current and superseded statements and support references.
3. Copy criteria into a new proposal, edit them and supply a reason. Save the next version. Reopen the earlier version and confirm its original criteria/reviews remain visible and new review is disabled.
4. Inspect mapping readiness on an explicitly selected source check. It references the latest proposal identity/version and still shows approval/application disabled. Source authenticity remains unverified.
5. For automated recovery/revocation scenarios, run E2E-JRN-06-009. It loses a response after the real backend commit, recovers the same receipt, verifies linked history and clears private metadata on setup/membership denial. Original business snapshots remain unchanged.

Use `npm run test:e2e:headed -- --grep E2E-JRN-06-009` to watch it, or `npm run test:e2e:ui -- --grep E2E-JRN-06-009` for replay controls. Run the full regression suite with `npm run test:e2e`. These commands require the project's documented local API/database/Playwright setup. Manual owner observation is separate from automated evidence.

The published chatgpt.site prototype does not receive these repository changes. No merge/deploy is performed. Next: authoritative acceptance/role/custody capture, governed bound mapping requests and independent decisions, transactional overlay application, compensation and reconciliation, volume/client-data/UAT/provisioning gates; then F07–F25. See ENGINEERING-CHECKPOINT.md for exact tested source/run evidence and F06-MAPPING-DECISION-NEXT.md for the planned next decision-flow matrix. Human client/owner acceptance is still open.
