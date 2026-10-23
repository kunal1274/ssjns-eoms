# Versioned mapping policy design review

23 October 2026. First candidate 499ccf8 / CI39970849847 passed157 unit/API tests and all56 browser executions (new journey3.7s desktop/3.8s mobile; ledger256passed/40untested), but failed the dependency audit before Docker. It is not complete application proof. Replacement includes pinned Vite7.3.7 and ip-address10.7.4 lockfile updates for the reported advisories, plus mobile wrapping for long criteria and an overflow assertion. Full replacement gate is pending.

F06 remains In progress. This increment records R0 design proposals and individual review statements; it does not activate business policy, approve mappings, authenticate sources or modify historical facts. Authoritative owner/client policy, role and custody acceptance remain open. Full F01–F25 and reusable visible testing remain delivery scope.

## Ten connected delivery steps

| Step | Capability | Current status |
| --- | --- | --- |
| 1 | Strict R0 proposal contract with explicit custody, independent approver and evidence/concern criteria; eight fixed safeguards | Implemented; local contract verification passed |
| 2 | Persist immutable estate-scoped policy versions with predecessor, actual actor, reason, support reference and database-computed SHA-256 | Implemented; PostgreSQL gate pending |
| 3 | Serialize competing versions and bind exact retries to actor/key/content; reject stale revisions and changed retries | Implemented; PostgreSQL gate pending |
| 4 | Forced RLS, narrow database functions and scoped list/detail pagination; no direct application-table writes | Implemented; PostgreSQL gate pending |
| 5 | Independent design review bound to exact version/digest; linked reviewer corrections and current-per-reviewer totals | Implemented; PostgreSQL gate pending |
| 6 | Guided criteria authoring, fixed safeguard explanation and validation before save | Implemented; browser gate pending |
| 7 | Inspect short/detailed proposal/review history; copy criteria into a new version; preserve superseded history | Implemented; browser gate pending |
| 8 | Frozen uncertain submissions with exact receipt recovery; stale/conflict guidance, failed-read recovery and denied-scope clearing | Implemented; browser gate pending |
| 9 | Connect fresh mapping readiness to the latest recorded design version, while retaining disabled approval/application | Implemented; full integration gate pending |
| 10 | Real PostgreSQL/API adversarial tests, stable visible journey, coverage bindings, Docker retry/persistence proof and manual replay guide | Added; local checks passed; full CI pending |

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

The published chatgpt.site prototype does not receive these repository changes. No merge/deploy is performed. Next: authoritative acceptance/role/custody capture, governed bound mapping requests and independent decisions, transactional overlay application, compensation and reconciliation, volume/client-data/UAT/provisioning gates; then F07–F25. See ENGINEERING-CHECKPOINT.md for exact tested source/run evidence once the full gate finishes.
