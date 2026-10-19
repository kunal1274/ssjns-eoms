# Mapping policy R0 — concrete proposal for review

19 October 2026. Status: proposed, not approved or activated. This document is a reviewable design, not client sign-off, source authentication, mapping approval or authorization to execute migration. The readiness UI displays this draft status. No approval/application endpoint is delivered by this increment.

The project roadmap says: “Do not guess payroll multipliers, UOM precision, approval rules, data retention, license model or integration behavior. Use approved requirements and signed-off examples.” R0 makes the proposed rules concrete before that gate. Development, automated verification and reversible preparation continue under the existing owner authorization. F05 controls exception remains unchanged.

## Recommended baseline

| ID | Proposed rule and resulting behavior |
| --- | --- |
| R0-01 | Preserve original historical facts. Work-company proposals create a separately classified migration-attribution overlay, never overwrite muster legal-company/responsibility snapshots, quantities, shares, state or historical audit. Original and adjusted views must be separately labeled. No downstream payroll/finance recomputation or posting follows by implication. |
| R0-02 | Keep task-block proposals in the existing exact-code, versioned, reasoned task-link workflow initially. Do not introduce automatic bulk task linking or unlinking. Already recorded links remain immutable. Reversal needs a separately approved correction model. |
| R0-03 | Bind any future mapping decision to an immutable job/manifest digest, explicitly selected matching source-check ID, controlled-document/custody references, current observation IDs/revisions and a published policy version. A digest match or human corroboration alone is never an approval. |
| R0-04 | Require a separately authorized mapping approver, distinct from preparer, source uploader and provenance reviewer(s) relied on for the decision. Scope must include the same customer and estate. No delegation, role conflict exception or automated substitute is inferred. Final role/delegation rules and staffing must be confirmed. |
| R0-05 | Current validation issues, missing source evidence, current concerns/insufficient evidence, revoked reviewer authority or disputed custody pause the proposed approval path. A positive statement never cancels another current concern. Preserve revoked reviewers' statements; resolution needs explicit reasoned lineage, not deleting history or silently dropping a person. Minimum evidence/approver counts and trusted custody criteria require owner/client acceptance before activation. |
| R0-06 | Revalidate current caller/approver scopes, policy version, source/check/observation identities, record versions, target validity and estate/path lifecycle inside the application transaction. The readiness report spans a read window and is not a lock, reusable permit or guarantee against later drift. Changed facts return a conflict requiring renewed review. |
| R0-07 | Start with a bounded staged overlay batch, all-or-nothing commit, immutable decision/application receipt, exact-payload idempotent retry, row totals and original/adjusted reconciliation. No partial-apply fallback, background bypass, direct business-row backfill or live ERP/payroll posting. High-volume staging is a later accepted expansion. |
| R0-08 | Withdraw or supersede an applied overlay through a separate reasoned, authorized compensating event. Preserve the initial approval/application and its audit. Backup/restore, cross-system compensation, retention/expiry and production cutover require explicit accepted runbooks and tests; no numeric durations/tolerances are invented here. |

## Cases to use for policy acceptance

| Case | Proposed result |
| --- | --- |
| Clean mapping, matching bytes, current corroboration, agreed policy/roles | Eligible to request a separate approval; still no automatic application. |
| Clean mapping and a positive human statement while policy/custody criteria are unsigned | Inspection only; approval/application remain disabled. |
| One positive statement and another current concern/insufficient observation | Pause for explicit resolution; do not pick the positive statement. |
| Concern author's setup grant or estate role revoked | Retain the statement and flag changed authority; revocation does not resolve the concern. |
| An older concern has a linked new observation from the same reviewer | Show lineage and that reviewer's current statement; never treat multiple revisions as additional independent people. |
| Record, policy, target or observation changes after decision | Conflict; refreshed review/decision is required before a transactional application. |
| Replay after a committed response is lost | Recover the same immutable receipt for the same identity and payload; create no duplicate application. |
| Incorrect attribution discovered after overlay application | Authorized compensating overlay event, preserving original facts and all prior decisions. |
| Historical task already linked, or proposed block code/path invalid | Existing guarded workflow rejects the proposal; R0 does not overwrite/unlink it. |
| Recomputed payroll/finance or external legal/entity effect requested | Separate approved downstream workflow and reconciliation; no implied dispatch. |

## Review boundary

Accept or amend R0-01–08 as a proposed implementation baseline, identify the authoritative client/owner decision and confirm approver staffing/custody criteria. Production acceptance remains separate. Until approved, continue read-only readiness and synthetic/reversible preparation; do not represent this proposal as an active business policy. A future versioned policy/decision lifecycle must record who accepted exactly which revision and why. No such acceptance is fabricated by publishing this document.
