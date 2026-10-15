# F02 — Persona Journey Register (review draft)

**Status:** Proposed journey inventory for owner review; not yet an approved business requirements baseline.  
**Review date:** 16 October 2026  
**Branch:** `planning/production-roadmap-data-security`  
**Canonical phase tracker:** [PROGRESS.md](PROGRESS.md)  
**Related evidence:** [TRACEABILITY-F02.md](TRACEABILITY-F02.md), [SOURCE-MAP-F02.md](SOURCE-MAP-F02.md), [F02-OWNER-DECISIONS.md](F02-OWNER-DECISIONS.md)  
**CI evidence:** [GitHub Actions run #31](https://github.com/kunal1274/ssjns-eoms/actions/runs/38793118636) passed on commit `7e022cc32ca4f3e21d7f0cf4fb622e2a4154f473` after this register and the draft requirement catalogue were added. CI confirms repository checks only; it does not approve these proposed personas or journeys.

## Purpose and interpretation

This register turns the F01–F25 foundation/access/role/licensing/journey scope into testable candidate journeys. It is derived from the owner-defined [production roadmap](PRODUCTION-ROADMAP.md), current source/test inventory, and selected DEC-01 hierarchy baseline. It does **not** silently convert undecided proposals into approved rules.

- Journey IDs `JRN-*` are traceability keys assigned for this draft, not pre-existing owner-issued requirement IDs.
- “Expected allow/deny” is a proposed acceptance boundary based on the product's stated security goals; where policy depends on a decision, that dependency is called out.
- “Current evidence” describes only tested behavior in the repository build. “Not implemented” means no implementation/evidence was found in the reviewed source; it does not claim that no related idea exists elsewhere.
- Persona names are functional archetypes, not a final job-title catalogue. A customer may combine roles, but effective permissions and data scope must remain separately enforced.
- Hosted-demo-only journeys are not inferred. Add them only when a specific screen/action/outcome is identified.

## Candidate personas

| Persona key | Candidate persona | Main responsibility | Scope boundary to validate |
|---|---|---|---|
| PER-01 | Platform operator | Provision and support customer tenants; manage platform-level configuration | Platform operations only; no routine access to customer operational data without an explicit, audited support grant |
| PER-02 | Customer administrator | Manage customer users, role assignments, hierarchy configuration and licensed access | One selected customer tenant; no cross-tenant administration by default |
| PER-03 | Group/company administrator or finance user | Perform approved cross-estate/company oversight and financial attribution | Only explicitly assigned group/company/legal entities; no access merely because records roll up to a parent |
| PER-04 | Estate manager | Maintain estate operational masters, assign supervisors and review operational work | Assigned estate and explicitly inherited descendants |
| PER-05 | Division/field/block supervisor | Plan/coordinate work and capture or confirm permitted field activity | Assigned division/field/block and active assignments; exact capture/review split requires DEC-03/04 |
| PER-06 | Clerk / field data-entry user | Enter operational records and resolve permitted validation issues | Assigned operational scope and allowed create/edit actions; no elevated approval by implication |
| PER-07 | Auditor / compliance reader | Inspect authorized audit history and evidence | Explicit audit-read permission and scope; must not mutate operational or audit records |
| PER-08 | License/commercial administrator | Manage contracted modules, seats, expiry and renewal state | Contract/entitlement administration, separate from operational permissions |
| PER-09 | Integration service identity | Exchange approved records with SAP Business One and HR/payroll/finance systems | Narrow service identity, explicit tenant/scope/field access and approved interface contract |
| PER-10 | Offline field operator | Capture permitted work while a previously authenticated field session is temporarily disconnected | Only preloaded, authorized references and own pending drafts; server validates identity/scope again at sync |

## Candidate journey matrix

| Journey ID | Persona and journey | Proposed positive acceptance | Proposed negative/boundary acceptance | Current evidence / gap | Phase and decision links |
|---|---|---|---|---|---|
| JRN-01 | Platform operator provisions a customer tenant and initial administrator | Tenant is created with an isolated identity, stable ID and explicit initial-admin grant; provisioning is audited | Platform user cannot browse tenant data by default; duplicate/invalid tenant setup is rejected | No tenant provisioning flow found | F06, F08, F12; DEC-02/03 |
| JRN-02 | Customer administrator configures group/company and plantation hierarchy | Configure optional group/company and Region/Business Unit → Estate → Division/Afdeling → optional Field → Block; assign responsible legal entity and effective dates | Cannot attach nodes across tenants, create cycles/invalid parents, or grant implicit sibling/upward/other-tenant access | DEC-01 architecture baseline selected; current schema only partially represents company/estate; full hierarchy and hierarchy-change history absent | F06, F12; DEC-01 |
| JRN-03 | Customer administrator invites, activates, suspends and revokes a user | Authorized admin manages user lifecycle; changes are audited and revocation takes effect within an approved interval | Unauthorized admin cannot alter privileged users; suspended/revoked sessions cannot continue protected actions | Basic local login/session/logout exists; full invitation/recovery/administrative lifecycle absent | F07–F08; DEC-02 |
| JRN-04 | Customer administrator creates and publishes a least-privilege role | Select versioned permissions and explicit scope; preview effective access; publish change with history and rollback path | Cannot grant permissions outside own authority, widen scope implicitly, or activate a role that enables unlicensed features | Fixed manager/supervisor/clerk roles only; role templates/editor/publish/preview absent | F09–F18; DEC-03 |
| JRN-05 | License administrator assigns contracted modules and seats | Activate contracted modules/seats and track effective/expiry state; changes are auditable | User/customer cannot self-enable a module or exceed capacity; expiry/suspension follows approved contract rules without deleting data | No license or seat enforcement found; named vs concurrent and expiry/grace rules unresolved | F19–F22; DEC-05 |
| JRN-06 | Estate manager maintains workers, task occurrences and periods | Authorized manager creates/updates/deactivates permitted masters; changes validate capacity/version and are audited | Supervisor/clerk writes, duplicate identities, stale versions, invalid capacity and writes to locked periods are rejected | Current worker/task/period routes and tests cover many of these cases | F10–F12, F24–F25; DEC-03/06 |
| JRN-07 | Supervisor captures work in an assigned estate and gang | Valid assigned supervisor creates a persisted muster with validated references, conserved allocation, idempotency and audit/outbox intent | Deny unauthenticated/unassigned user, wrong-estate references, invalid payload and changed-payload retry; repeated identical retry does not duplicate | Current muster capture, assignment, RLS, idempotency and validation tests exist; block-level authorization is absent | F11–F12, F23–F25; DEC-03/06 |
| JRN-08 | Manager confirms, reviews or reverses captured work | Permitted transition persists with version/state/period checks, reason where required and immutable audit evidence | Reject wrong role, stale/duplicate transition, locked period, missing assignment and any prohibited self-approval | Current muster confirmation/review/reversal and negative cases are tested; same-manager review remains provisional and generic correction lineage is absent | F11–F13, F23, F25; DEC-04/06 |
| JRN-09 | Clerk corrects a rejected record and hands it back for review | Correction path preserves original evidence, records reason/actor and returns work to the correct queue | Cannot overwrite approved/posted history or bypass required review; correction does not silently duplicate payroll/finance effects | No generic rejection/correction lineage or reusable workflow engine found | F13, F23–F25; DEC-04/06 |
| JRN-10 | Offline field operator captures and synchronizes work | Previously loaded references support the documented offline draft flow; retries preserve immutable idempotency key/payload; acknowledged drafts leave the queue | Account switching, expired session, server failure, conflicting payload or revoked scope cannot silently post work; unauthorized data is not synced | Partial PWA/device-draft and sync tests exist; no app-level local encryption or complete cold-start offline identity; server scope matrix incomplete | F07, F11–F12, F25 |
| JRN-11 | Auditor reads scoped audit history | Authorized reader filters/reads permitted history with actor, time, reason and linked transaction evidence | Clerk or unrelated tenant/scope cannot read sensitive audit details; no role can mutate append-only audit evidence | Audit writes are protected and mutation denial is tested; audit-read permission/retention policy remains undecided | F09, F12, F17, F25; DEC-03/08 |
| JRN-12 | Group/company user views consolidated operational and financial reporting | Report aggregates only entities and periods explicitly assigned; totals reconcile to source records | Cross-company/tenant records, protected fields and exports outside assigned scope are excluded or denied | Limited lists/pagination only; consolidated reports/exports and field-level controls absent | F11–F12, F24–F25; DEC-03/06/08 |
| JRN-13 | Integration service sends approved event and reconciles acknowledgement | Approved event is dispatched idempotently; acknowledgement/retry/failure is visible and reconcilable | Unknown service identity, unauthorized fields/scope, duplicate replay and unapproved live posting are rejected or quarantined | Transactional outbox exists; dispatcher, partner adapters, acknowledgements and reconciliation are absent | F11–F12, F23, F25; DEC-07 |
| JRN-14 | Operations user reviews a task queue and resolves an exception | Dashboard/queue shows only permitted actionable work, correct status/owner/next action and relevant exceptions | Direct API access cannot bypass queue visibility restrictions; closed/locked/unassigned items cannot be acted on improperly | Current screens are limited to muster, maintenance, gangs, periods and audit; comprehensive role-specific queues absent | F11–F12, F24–F25; DEC-03/04 |
| JRN-15 | Payroll/finance owner reconciles checkroll and prepares posting | Approved calculations reconcile to signed examples; posting/exports are attributable and reversible through a linked adjustment process | Unapproved rates/rounding, duplicate posting, unauthorized wage/bank data access and posting before approval are blocked | Full payroll, financial posting and compensating integration flows absent; no calculation assumptions should be inferred | F12–F13, F19–F25; DEC-04/06/07 |
| JRN-16 | Estate operations user plans work and records field operations | Approved planning, crop, rainfall, inspection, chemical/PPE and corrective-action flows persist against the right operating node | User cannot access unrelated blocks or perform restricted safety/chemical actions; overdue exceptions remain visible to authorized roles | These downstream workstreams are not implemented in the current slice | F12, F24–F25 and downstream EOMS workstreams; detailed requirements required |

## Minimum cross-product tests for F25

Do not attempt to enumerate every combinatorial permutation in prose. Once the owner approves the role/permission/scope/license catalogue, build a parameterized CI matrix that covers at least:

1. **Identity:** anonymous, active, suspended, revoked, expired session, platform/service identity.
2. **Tenant and scope:** same tenant and assigned node; sibling node; parent node without explicit parent permission; different legal entity; different tenant; missing/invalid context.
3. **Action and state:** read/create/update/confirm/review/reverse/export; draft/confirmed/reviewed/reversed/locked/expired/exception states as applicable.
4. **Entitlement:** licensed; feature not licensed; seat capacity reached; expiry/grace/suspended states only after DEC-05 rules are approved.
5. **Data path:** UI, direct API/IDOR, SQL under restricted runtime role, search/list, report/export, offline sync, background job, integration identity.
6. **Concurrency and recovery:** duplicate request, lost response, stale version, concurrent confirmation, pooled connection reused across different actors/tenants, transaction rollback, retry after conflict.
7. **Audit and separation of duties:** allowed reader vs forbidden reader; allowed approver vs self-approval/conflict; immutable original record and linked correction/reversal.

Every test case should identify the requirement/journey ID, actor, tenant and scope fixture, precondition, action, expected HTTP/UI/database result, audit expectation and evidence link. Missing policy decisions must be marked blocked rather than assigned invented expected outcomes.

## Review items needed to accept this register

- Confirm, rename, combine or remove the candidate personas and journeys.
- Identify any required hosted-demo-only screen/action/outcome not represented here.
- Accept or change proposed allow/deny boundaries where the decision register identifies an unresolved policy.
- Supply/approve business requirement IDs if there is a separate signed requirements source; until then, F01–F25 plus JRN-* are trace keys, not a substitute for a signed specification.
- Mark each unresolved DEC-02–DEC-09 as Accepted, Changed, Deferred with owner/date, or Not applicable.
- Accept this baseline before F03 starts. F02 remains **In progress** until the owner baseline and relevant blockers are accepted/deferred.

## Evidence boundaries

The current source-map and CI links prove only the tested repository build with synthetic data. They do not establish exact parity with the ChatGPT-hosted rendered demo, production security certification, load capacity, or behavior for missing features. No implementation, client sign-off, or production readiness is implied by this draft register.
