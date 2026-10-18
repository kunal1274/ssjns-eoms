# F06.5 — Typed operational sites: implementation contract

18 October 2026. **Planned implementation; no site schema/API/UI is delivered by this document.** This is the next bounded slice of accepted DEC-01 / REQ-TEN-01 / REQ-MDM-01, connected to JRN-02 and later JRN-06/16. It follows the F06.4 client reconciliation. It does not replace F07–F25 or deliver mill, nursery, workshop or inventory operations.

## First increment: F06.5a site master and scoped navigation

Model a facility independently of division/field/block. Use a stable UUID, mandatory customer and responsible legal company, type (`mill`, `nursery`, `warehouse`, `workshop`, `other`), customer-local code, name, optional estate, active flag and optimistic version. Do not create fictitious blocks or invent client facility mappings during migration. New tables start empty on legacy upgrade; no historical site/actor/grant backfill is allowed.

The first increment keeps identity, type, code, customer, company and optional estate immutable after creation. Name/availability changes require reason and expected version. Relationship moves and dated responsibility are explicit later work, not generic unrestricted PATCH fields. The displayed company relationship is a current master association, not title ownership or a historical accounting snapshot. Future transactions must capture their own approved attribution.

| Boundary | Server/database contract |
| --- | --- |
| Tenant/legal links | Composite customer/company and customer/estate keys reject mixed tenants. Estate link is optional and references stable identity. Do not require the site's company to equal the estate baseline company without a signed business rule: dated estate responsibility already exists. |
| Linked-site reads | Require current membership of the linked estate; customer setup authority alone does not expose an unrelated linked estate's facility details. A visible company/customer label never grants sibling access. |
| Unlinked-site reads | First slice permits explicit customer setup administrators to view configuration only. Ordinary estate members receive no access to unlinked sites. Operational unlinked-site assignments are F09–F12 work, not an inferred customer/company grant. |
| Linked-site writes | Require both explicit customer setup authority and linked-estate membership. Recheck estate lifecycle and legal-company eligibility on creation. No site form grants membership or operational authority. |
| Unlinked-site writes | Require explicit customer setup authority. Label the facility as not linked to an estate; never substitute the current header estate silently. |
| Every write | Validate type/code/name/UUID/reason/version; parameterized queries, transaction context, optimistic concurrency, stable server error/reference, same-transaction append-only event. Runtime cannot delete sites or edit history. |
| Database access | Restricted runtime grants, forced RLS, fail-closed actor context, trigger immutability/version checks and tenant-aware foreign keys. Dedicated projected site history avoids widening generic hierarchy-history readership or changing its old estate-null interpretation. |
| Availability | Pause/resume affects site-master eligibility only. It must not claim to stop nursery stock, warehouse issues, workshop jobs or mill operations that do not exist yet. Future consumers require dependency/lifecycle guards before adoption. Historical detail remains readable within current scope. |

## API/navigation contract to implement

Use the established transaction/context/error helpers. Proposed routes under `/api/navigation/customers/:customerId/sites` provide scoped keyset search by code/name, optional type/active/estate filters, maximum page size 100 and a checked selected-ID pin. Cursor binds actor, tenant, filters and route; each page/pin revalidates current scope. Reject forged/mismatched cursors. Keep displayed labels separate from authoritative IDs.

Customer-scoped create plus site-specific versioned edit routes use strict payload schemas; reject unknown relationship/identity updates rather than ignoring them. Detail/history routes recheck exact site access and return only authorized, bounded projections. Search failure must not clear the current site, reason, draft name or already-loaded rows. A committed save with failed refresh must be identified and block blind resubmission until authoritative reload. Transaction audit and response must agree on saved ID/version.

Treat the proposed route spelling as implementation design, not an existing public API. During implementation, reconcile company-label RLS with visible site references without expanding access to company or estate operational records. Do not expose raw history JSON as a shortcut.

## Connected novice journey

1. Organization → choose accessible customer → open **Operational sites**. Explain the facility's purpose and required setup permission; show a useful empty state and next action.
2. Browse/search a permitted site or choose Create. Select type and responsible company using scoped paged selectors; choose an optional estate explicitly or **Not linked to an estate**. Show current access limits without implying permissions have been assigned.
3. Enter code/name and reason. Required/format/duplicate/foreign-scope errors identify the affected field or action; preserve safe input. Submitting shows progress and prevents repeated clicks.
4. Save → confirm the actual site identity/version → inspect short history and expanded before/after/reason/actor/time/support reference. Only then offer name/availability changes under current authority.
5. Open a linked estate only through an access-checked handoff. For an unlinked site, remain in site detail; explain that operational assignment/workflows are later delivery. No dead-end link to an unbuilt business form.
6. Version conflict → explain another change → reload current values → explicitly reselect Edit and review before retry. Revoked scope clears actionable data and provides recovery; never retarget another site or estate automatically.

## Required evidence before implementation is marked verified

| Evidence layer | Acceptance cases |
| --- | --- |
| Real PostgreSQL/API | Valid linked/unlinked create and reload; all types; same-customer duplicate code vs different-customer code reuse; foreign company/estate rejection; linked membership plus setup authority; unlinked admin-only visibility; non-admin/own/sibling/foreign/revoked users; unauthenticated/no-context denial. |
| Direct database | Mixed-tenant FK rejection, forced RLS, immutable scope/type/code, correct version increments, required reason, append-only/no-delete/no-history-mutation and honest actor/request provenance. |
| Search/history | Beyond-first-page data, pinned selection, literal percent/underscore, bound/malformed/actor-switched cursors, request boundaries, scoped history, failed More retaining loaded results and revoked-access reload. |
| Concurrency/recovery | Stale and concurrent edits do not overwrite; successful commit followed by failed refresh does not duplicate; denied/stale/no-op actions do not manufacture successful history. |
| Upgrade | Migration from pre-site schema preserves existing companies/estates/units/work/memberships and existing history; creates no guessed site/grant. Migration runner and actual Docker persistence checks remain active. |
| Browser | Reserve E2E-JRN-02-014 for planned site setup → saved detail/history → estate handoff, plus validation/retry/stale/revocation cases at desktop/mobile widths. Add coverage bindings only after real assertions exist. Keep the existing 34 viewport executions and all PWA/session/idempotency/authorization regressions. |
| Manual | Keyboard focus/labels, phone/tablet layout, novice completion, error clarity and owner-visible replay. Headless CI is separate evidence from owner observation/UAT. |

Implementation order: migration/guards → API + real DB tests/upgrade → scoped selectors/detail/history UI → connected Playwright journey and coverage bindings → full existing CI → record exact tested source/run and remaining limits. F06.5a may be verified only after these checks actually pass. F06 itself stays open for remaining attribution/provisioning/inheritance and explicit acceptance work.
