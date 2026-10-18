# Source-referenced mapping preview: engineering checkpoint

18 October 2026. F06.6c1 implemented; full verification pending. F06 remains In progress. This technical note does not retransmit the excluded full client-derived tracker/handoff payload.

## Connected journey

Task capacity → Open legacy attribution review → Open source mapping preview → inspect format/provenance guidance → upload or paste a prepared JSON manifest → Preview source mappings → inspect blocked/review-required rows and expanded provenance → correct the proposal and preview again. Editing invalidates the prior result. A temporary service error preserves the proposal; confirmed authority/scope loss clears private inputs/results. Refresh mapping access explicitly rechecks permission.

The form accepts version 1 JSON, up to 50 rows / 60 KB. Each proposal supplies a source-row reference, task-block or work-company kind, explicit existing record ID/version, explicit target ID and source review reason. Source metadata includes system, document reference and declared source SHA-256. Prepared mappings require a migration owner's verified target IDs; no company/block match is inferred from names. This bounded review tool is not the high-volume import solution.

## Authorization and result contract

GET reconciliation/context and POST reconciliation/preview live under the selected estate. Both recheck estate membership. Preview additionally requires estate-manager plus explicit customer setup authority. Existing Origin/CSRF/authentication/RLS rules stay active. The API checks duplicate source/record proposals (all conflicts block), record scope/current version, already-recorded attribution/link, target scope, block kind/exact code and active path. Every unblocked row still requires source review; no row is approved, imported or applied.

The response carries actor/estate, evaluation time, support request ID, source declaration, a server-computed SHA-256 of the validated normalized manifest, summary and per-row issues/projected current/target detail. The declared source hash is **not verified evidence**; the computed digest identifies the submitted validated proposal, not an accepted business fact. Preview is point-in-time validation and cannot be reused as write authority. Revalidation is required before any separate governed write.

No migration, production grant or dependency was added. The preview issues no business writes and stores no approval/job/audit record or uploaded document. Historical work is not overwritten; existing reasoned task-link writes remain separate. UI provenance is explicitly preview metadata, not fabricated saved history.

## Verification scope

Local 42 unit/config/security/ledger/contract tests passed, plus TypeScript/build/format checks. Three contract cases cover strict schema/limits, all-conflict duplicates and proposal-digest binding. Three new real PostgreSQL/API cases use genuinely upgraded historical data, restricted eoms_app and explicit setup authority; they cover mixed scoped results, immutable original work/shares/audit, modern attribution exclusion, duplicate/stale/foreign/wrong-kind/code/inactive-path denials, Origin/CSRF/session checks and revoked setup/role/membership.

E2E-JRN-06-004 covers manifest-size and JSON guidance, retained upload through a correlated 503, actual report/provenance with review-required and blocked rows, invalidation/revalidation after edits, and cleared proposals/results on setup/membership revocation. The real fixture API's trusted web origin is configured explicitly at construction; production defaults remain unchanged and wrong-origin checks remain tested. Existing historical and all older browser regressions stay active.

Expected full gate: 42 unit + 84 API = 126 tests; 46 desktop/mobile executions; 128 inventory items / 108 mapped / 20 gaps; ledger 216 passed / 40 untested item/project rows. These are expectations until the run succeeds, not whole-product coverage. Prior source 272d2d401498841f1405603276aa07d3197f31e2 / CI 39142448119 passed the full 120-test/44-execution gate; documentation follow-up 40f19cca / CI 39143286496 passed.

## Remaining delivery

Original-evidence upload/authentication, persisted reconciliation jobs and decisions/audit, independent owner approval, approved mapping application/overlay design, high-volume parsing/staging/error exports/idempotency, reconciliation totals/rollback and actual client-data acceptance remain open. No historical correction policy or import acceptance is inferred from this preview. Production bootstrap/setup-grant/inherited-role dependencies and persona/manual F06 acceptance remain explicit. F07–F25/full business processes and visible recording/one-click reusable-runner work remain in force. No merge/deploy or hosted-prototype change.

## Manual / visible replay

Use reviewed synthetic source IDs, versions and target mappings. Upload a valid manifest, inspect declared versus computed hashes, blocked issues and current values, edit one version and rerun. Expect a stale-version block and no record changes. An unblocked historical-company proposal still requires a source-backed decision; there is no Apply button. A user without both required authorities sees read-only guidance.

After existing local Docker/host test setup, run `npx playwright test jrn-06-reconciliation --project=chrome-desktop --headed`, or select E2E-JRN-06-004 in `npm run test:e2e:ui`. The replay supplies its own genuine upgraded fixture and source manifest, preserving normal demo records. Remote CI does not constitute owner-visible/manual UAT. Record persona, commit, steps and actual observations separately.
