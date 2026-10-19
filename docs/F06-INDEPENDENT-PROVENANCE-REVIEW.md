# F06.6c4 independent provenance observations

Implemented candidate, 19 October 2026; full database/browser/Docker gate pending. Local47 unit/contract tests, type/build/format pass. F06 remains In progress. No phase closure, mapping approval, merge or deployment.

A source-check record now connects to a separately authenticated reviewer's provenance observations. Outcomes are corroborated provenance, concerns or insufficient evidence. A corroborating statement requires a matching source digest and an explicit declaration that the reviewer examined the controlled original and its provenance. Each observation retains controlled document reference, reason, reviewer, examination declaration, source/manifest digests, original server request reference, revision and previous-observation identity. The preparer and that source-check's uploader can read but cannot record independent observations on their own evidence.

These are non-authorizing human statements, with a conservative development independence safeguard. They do not machine-authenticate the source, certify factual correctness, establish a signed production approval policy or authorize import/application. They do not close F13 or generic separation-of-duties acceptance. Source-check authenticity flags and saved snapshots stay unchanged, including after corroboration. Originals remain in the external controlled repository; the app retains references and observations, not source files.

Migration020 adds forced-RLS append-only observations and a narrow database function. Runtime cannot directly insert or rewrite observations. The function rechecks manager membership/setup scope, preparer/uploader independence, original-examination/matching-byte conditions and authenticated request provenance. Stable actor/check/retry identity returns a committed observation once on repeated/concurrent retry. Changed content under that identity conflicts. Per-reviewer expected revision guards serialize new observations; stale tabs conflict. Corrections append a new linked revision, preserving every previous statement. Read results mark each reviewer's current versus superseded observations, with scoped paging. There is no aggregate approval state or automatic choice between conflicting reviewers.

The UI guides examination, source identity/reference, outcome, declaration, reason, short/detailed audit and correction. Temporary uncertain writes keep immutable payload/key and lock fields for same-submit recovery; stale conflicts retain draft and direct the reviewer to refresh. Confirmed authorization loss clears private input and loaded metadata. Uncommitted drafts/retry keys remain in memory; reopen committed observations after reload. Role/person identity administration and production policy remain separate.

## Journey and visible replay

Task capacity → legacy attribution review → source mapping preview → save review → source-file digest check → Open provenance review. The preparer sees a readable independence explanation and disabled recording form. A separately authorized manager with setup permission signs in, opens the same saved review/check, examines the controlled original externally, records a reference/outcome/reason and optionally declares examination. Corroboration stays disabled until the matching-byte/examination conditions hold. To correct an observation, refresh history, inspect the current revision and record a new one; superseded statements remain in the audit.

Run E2E-JRN-06-007 using `npm run test:e2e:ui -- --grep E2E-JRN-06-007` or the headed equivalent after local synthetic test setup. Four actual steps cover preparer/independent identity, committed-response recovery/audit, stale-tab linked correction, and reload/setup/membership revocation. Existing regressions and timeouts remain active. Headless CI does not display on the owner's desktop. The hosted Sites prototype does not receive these branch changes.

Docker smoke now uses the separately seeded development reviewer to record/retry a non-authorizing synthetic observation through the actual proxy and reopen it as the preparer after container recreation. No live/client approval is exercised by that fixture.

## Status and next queue

| Capability | Status |
| --- | --- |
| Independent non-authorizing observations and immutable correction lineage | Implemented; full gate pending |
| Guided reviewer UI, retry/stale/reload/revocation recovery | Implemented; full gate pending |
| Signed source-authenticity criteria and trusted document custody/retention | Open |
| Owner-approved mapping decisions, approval audit and application/overlay policy | Open |
| Larger files, bulk staging, row reconciliation/rollback and client-data acceptance | Open |
| Bootstrap/setup-grant/inheritance dependencies and persona/manual UAT | Open |
| F06 acceptance and F07–F25/full business-process delivery | Open |

Expected full gate:144 unit/API tests(47+97),52 desktop/mobile executions. Inventory140items/120mapped/20gaps; expected ledger240passed/40untested item/project rows. These are expectations until CI completes, and assertion counts are not whole-product coverage percentages. Preserve the full roadmap and parallel reusable visible testing/manual-recording/local one-click runner workstream.
