# F06.6c3 source-file integrity checks

Implemented candidate, 19 October 2026; full PostgreSQL/browser/Docker gate pending. Local 45 unit/contract tests, type/build and formatting pass. F06 remains In progress. No approval, phase acceptance, merge or deployment.

A saved reconciliation review now offers an original-source file check, bounded to 2 MiB of non-empty bytes. The database computes SHA-256 from the supplied bytes and compares it with the saved manifest's declared source digest. Each match or mismatch is an immutable audit event retaining file name, decoded byte length, computed/declared/manifest digests, actor, reason, original request reference and time. A digest match is byte identity against a declaration; source authenticity, factual correctness, provenance review and approval remain unverified. The saved job/snapshot and historical business records are unchanged.

Migration 019 adds forced-RLS events, append-only guards and a narrow database function. Runtime cannot insert claimed results directly. The function computes scope/size/hash/outcome from the job, bytes and authenticated transaction context, rechecks manager/membership/setup access, and serializes actor/job/retry identity. Identical concurrent or lost-response retries return one event; changed bytes/name/reason under that key conflict. Strict canonical base64, decoded size, schema and metadata checks reject malformed or claimed outcomes. Only this POST route permits a 3 MiB JSON envelope; ordinary routes retain 64 KiB. Existing Origin/CSRF/session guards remain active.

Bytes are transient input to this feature. They are not stored in its tables, served, parsed as documents or rendered. Retain originals in a controlled external document repository; this implementation is not an authenticated document vault or malware scanner. Private uploads/retry payloads remain in memory and clear on closing/rescoping or confirmed denial. Reopening recorded checks recovers committed results, not uncommitted file inputs.

## Journey and replay

Task capacity → Open legacy attribution review → Open source mapping preview → preview/save manifest → open saved review → Original source file → Source provenance reason → Check source file digest → short result / View detailed source check. For a mismatch, obtain the correct original or save a corrected manifest as a new review; an existing saved declaration cannot be silently rewritten. A match still requires independently governed source review and decision before any application.

E2E-JRN-06-006 has four actual steps: size/mismatch protection, committed-response loss/recovery, reload/short+detailed audit and revoked setup/membership clearing. Run `npm run test:e2e:ui -- --grep E2E-JRN-06-006` or the headed equivalent after local synthetic test setup. Headless CI does not display on the owner's computer. The hosted Sites prototype is separate.

Docker smoke now includes a 2 MiB source check through the actual web proxy, exactly-once retry and reopening retained review/check metadata after container recreation. This does not claim original file storage. All existing regressions remain active.

## Status and remaining scope

| Capability | Status |
| --- | --- |
| Server-computed source-byte comparison with immutable scoped audit | Implemented; full gate pending |
| Connected UI, mismatch guidance, retry/reload/revocation recovery | Implemented; full gate pending |
| Original source authenticity and independent provenance attestation | Open |
| Approval, governed application/overlay and approval audit | Open |
| Larger files, document retention, high-volume staging/reconciliation/rollback | Open |
| Actual client-data and manual/persona acceptance | Open |
| Production bootstrap/setup-grant/inheritance dependencies and F06 closure | Open |

Inventory expectation: 136 items, 116 mapped, 20 gaps; expected full ledger232passed/40untested rows and50 desktop/mobile executions. These are not proof until CI finishes and are not product completeness percentages. Preserve full F01–F25 business-process scope and parallel visible replay/manual-recording/local one-click reusable-runner workstream.
