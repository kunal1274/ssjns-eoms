# Assertion coverage ledger

The initial ledger connects specific field, action, form, navigation and audit checks to real Playwright results. It is part of the reusable testing workstream inside EOMS, not completion of the full product or F05 repository-policy gate.

## Use it

After the test environment setup in PLAYWRIGHT-WORKBENCH-QUICKSTART.md:

```sh
npm run test:e2e
npm run test:coverage
```

Open `.local/e2e-ledger/index.html` on your computer. Filter by status or screen. The Playwright reporter creates this view automatically after a run; the second command regenerates it and checks source freshness. `npm run test:coverage-ui` verifies the generated HTML filters against actual successful run evidence and known open gaps; CI runs this after the journey tests.

Machine-readable outputs:

| File                                | Meaning                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/e2e/coverage-inventory.json` | Versioned control/assertion inventory, journey, screen, category, case and named-step bindings                                                         |
| `.local/e2e-ledger/latest-run.json` | Latest actual runner attempt: selected case/project IDs, attempts, assertion-bearing completed step names, status, source fingerprint and run metadata |
| `.local/e2e-ledger/coverage.json`   | Derived current status for each inventory item and viewport project                                                                                    |
| `.local/e2e-ledger/index.html`      | Local filterable view of the same derived statuses                                                                                                     |

Generated evidence/reports are ignored, not committed as sample passes. With no run file, mapped items show not-run and unmapped items show untested. They do not become green from test discovery. Use `npm run test:e2e:ui` to select/replay journeys; this ledger is a read-only report, not the custom one-click execution dashboard.

## Initial scope and honest gaps

The current inventory has 66 items: 46 assertion mappings and 20 unmapped control/journey gaps, each displayed for desktop/mobile Chrome viewport projects (132 rows). The initial ledger before F06 had 39 items. It represents all 16 accepted journey IDs through specific assertions or explicit gaps, but is **not** a complete enumeration of every EOMS control. Counts are inventory items × projects, not a product coverage percentage.

The mapped controls include email/password prevention, safe login recovery, date/gang/area validation, missing-worker disabled Save, retained input after a rejected submission, exactly-once corrected save/audit, confirmation/reload, selected audit disclosure, cross-estate denial, audit-screen overflow and logout navigation. Existing browser/API scripts cover additional behavior; that evidence is separate and is not silently imported as a runner pass. An untested row means no executed assertion mapping in this ledger, not proof that no other test exists.

Mappings reference the actual stable case ID and named `test.step`. The reporter accepts a completed step only when it contains an executed Playwright assertion. Merely clicking/filling or having the step title in source does not count. Unit checks validate that inventory bindings resolve to named steps in their real test source. Grouped assertions are conservative: if a scenario/group fails, earlier individual field checks are not promoted to independent passes. A failed evidence row does not by itself prove that every associated control is defective.

## Status contract

| Status        | Interpretation                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| untested      | No runner assertion mapping yet                                                                                                                            |
| not-run       | Mapping exists, but no current selected execution evidence for this item/project                                                                           |
| running       | Selected run is still in progress; no early pass                                                                                                           |
| passed        | Current fingerprint, successful overall case/run, expected normal success, completed assertion-bearing mapped step, no preceding failed retry/global error |
| failed        | Latest mapped case failed/timed out, or an expected-failure convention cannot establish normal passing evidence                                            |
| skipped       | Latest selected test was skipped; not accepted coverage                                                                                                    |
| cancelled     | Selected run/case was interrupted                                                                                                                          |
| flaky         | A failed/nonpassing attempt was followed by a pass; it remains non-green                                                                                   |
| blocked       | The mapped case passed but the overall run/global error prevents accepting the evidence                                                                    |
| mapping-error | A passed case did not complete the required assertion-bearing step                                                                                         |
| stale         | Relevant source fingerprint differs; prior status remains visible, including previous failures                                                             |

The latest attempt replaces the latest snapshot, even on failure. A filtered run does not inherit passes for unselected cases/projects. Reporter mapping/flaky/stale/global errors fail the runner rather than hiding behind an overall green result. Skips and unimplemented gaps remain visible; this initial phase does not require every planned product feature to pass. F25 acceptance still requires complete agreed coverage/explicit scope decisions.

## Freshness and safety

A SHA-256 fingerprint covers source under apps/packages/db/tests/e2e/scripts plus package/lock, TypeScript and Playwright config files. Inventory and test versions are included. Generated dist/node_modules/hidden files, environment secrets and local reports are excluded. Documentation-only commits do not invalidate unchanged application/test evidence; the original run commit and timestamp remain visible.

Run evidence is a snapshot of the named synthetic environment at execution time. Fingerprints do not detect later database contents, external service changes or every runtime environment change; rerun after those changes. An old report already open in a browser does not auto-refresh: rerun `test:coverage` and reload it before assessing current freshness. Interrupted processes that cannot write a final event can remain marked running/incomplete; they never create a new pass.

Evidence stores allowlisted IDs, statuses and static named-step titles, not request bodies, passwords, cookies, SQL exceptions or screenshots/traces. Do not put secrets/private values in test/step names. Outputs use private local file permissions and atomic replacement; malformed evidence fails validation and removes derived reports instead of displaying the old green report as newly generated. HTML escapes dynamic labels/metadata. Trace/video/public artifact upload remains off under the existing plan.

## Extend and reuse

Add a stable inventory ID, accepted journey ID, screen/category, precise control assertion and real case/step binding. Keep missing field boundaries and navigation/error paths as explicit unmapped rows. Run the case independently, then the full regression gate. Avoid broad entries that imply every field is covered by a single successful click.

`packages/testing/coverage.ts` contains reusable schema/status/rendering logic. `scripts/coverage-files.ts` supplies the EOMS source/inventory adapter; `scripts/coverage-reporter.ts` supplies Playwright events. A versioned shared package and second-project adapter remain future work. The reviewed-recording workflow, source-linked control discovery and project-aware execution dashboard remain queued in CURRENT-HANDOFF.md.

## Executed evidence

[CI run 38957729942](https://github.com/kunal1274/ssjns-eoms/actions/runs/38957729942) passed on `85d8ec16b6aa9b74a0ad9966f50c7e03dcf0b45a`. Six real journey executions produced 38 passed/40 untested ledger rows; regeneration matched. The separate browser check verified status filtering, combined screen/status selection, known gaps, restored rows and no page errors. The first candidate exposed ambiguous filter labels; explicit label associations fixed the UI and the same browser assertion then passed. 52 unit/API tests, existing browser/PWA, build/formatting, dependency audit (zero known vulnerabilities in that run), actual Docker/persistence and final gate also passed. A later documentation-only update records this proof. Local interactive desktop observation and full inventory/workbench acceptance remain open.

F06.1 evidence: [CI run 38966302671](https://github.com/kunal1274/ssjns-eoms/actions/runs/38966302671), source `8027aad3364576c29d32b7e9a095ab72209f6cec`, includes three new organization/history/estate-handoff mappings. Actual generated counts: 44 passed and 40 untested rows; filters passed. These remain partial product assertions, not complete hierarchy coverage.

F06.2 adds four assertion bindings for E2E-JRN-02-002: group/company setup, division/field setup, block create/edit, and persisted relationships/history. Actual full-run rows are 52 passed/40 untested in CI 38977060930 on source 258a03860ed53a3f9cbdbd0b1f3ba80f9661bab4; all ten executions and ledger UI checks passed. This does not close the full JRN-02 gap.

F06.2 executed proof: [CI run 38977060930](https://github.com/kunal1274/ssjns-eoms/actions/runs/38977060930). This later evidence update changes documentation only.

F06.3a adds four precise E2E-JRN-06-001 bindings for configured task creation, legacy-link conflict/review, persisted block/task/work identity and link audit/navigation. Actual current full run: twelve viewport executions, 60 passed/40 untested item/project rows in CI 38980380357. Complete JRN-06 remains a gap.

F06.3a executed evidence: [CI run 38980380357](https://github.com/kunal1274/ssjns-eoms/actions/runs/38980380357) on `ede87f56bd25b13071162fb494f16bd340ef1c9d`. The configured/matching block selectors gained explicit accessible names after the first browser failure; the unchanged journey assertions passed at both viewports and the ledger UI passed. This evidence follow-up changes documentation only.

F06.3b adds four exact E2E-JRN-02-003 mappings for optional area setup, persisted initial estate placement/ownership preservation, label/audit review and ordinary-user sibling isolation/handoff. Actual fourteen viewport executions and 68 passed/40 untested rows in CI 38999436012 attempt 2. Full JRN-02 stays an explicit gap.

F06.3b executed proof: [CI run 38999436012](https://github.com/kunal1274/ssjns-eoms/actions/runs/38999436012), attempt 2, source `3ba0b5d41f7c45cdb3178a74d227bb89e6f09ce0`. All fourteen executions and ledger UI passed. The first attempt had an occupied Docker port after browser success; the full rerun passed. Later evidence changes are documentation only.

F06.3c1 adds four precise E2E-JRN-02-004 mappings for baseline boundary review, dated scheduling/detail, captured work identity and real recorded-work conflict/recovery. Actual sixteen viewport executions and 76 passed/40 untested rows in CI 39007971408. Full JRN-02 remains a gap.

F06.3c1 executed evidence: [CI 39007971408](https://github.com/kunal1274/ssjns-eoms/actions/runs/39007971408), source `bb4eebe9aa1c37140f1d4933c2287dd624ea9d11`. The fixture directory refresh and stable reason-field accessible name preserve the original assertion contract. All sixteen executions and ledger UI passed. Later evidence updates are documentation only.

F06.3c2a adds four precise E2E-JRN-02-005 mappings for cancellation/self-review denial, independent review/provenance, linked replacement and replacement work/conflict recovery. Verified eighteen viewport executions and 84 passed/40 untested rows by CI 39014863357 on source `1e17700a68d0fdaf0033d64445a7af4ebe659f35`. Full JRN-02 and full SoD remain gaps.

F06.3c2b1 adds four E2E-JRN-02-006 assertion mappings: pending placement/self-review, deactivation dependency recovery, independent move/provenance, area lifecycle/inactive destination rejection. Expected 20 viewport executions, 92 passed/40 untested rows; real CI pending. These mappings do not close full JRN-02, full SoD or every lifecycle gap.
