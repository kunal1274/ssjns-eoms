# F06 — Customer and organizational hierarchy

**Status:** In progress. F06 starts under the owner's documented F05 development exception; see F05-OWNER-EXCEPTION.md. This phase is not complete after the first increment.

## Accepted model and delivery steps

Customer tenant remains a distinct boundary from legal/financial company/group structure and the plantation operating hierarchy. Preserve the accepted DEC-01 flexibility: optional region/business unit, estate, division/afdeling, optional field, block; explicit legal responsibility/effective dates and downward scope grants. Parent visibility never implies sibling/upward/global record access.

| Increment                                  | Scope                                                                                                                                                                | Status                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| F06.1 Customer boundary and scoped context | Explicit customer roots, company/estate tenant keys, conservative legacy migration, safe read API, history and guided organization-to-estate handoff                 | Verified; see executed evidence below        |
| F06.2 Controlled configuration             | Optional legal groups/company assignment and estate division/field/block configuration, explicit setup grants, parent/type/scope guards and versioned history        | Verified; see F06.2 execution evidence below |
| F06.3 Model/access completion              | Region/business-unit nodes, ownership/effective dates, inheritance/scoped grants, moves/deactivation and large-data navigation; align with F09–F13 permission engine | Planned, dependencies explicit               |
| F06.4 Phase acceptance                     | Positive/negative tenant/hierarchy cases, safe upgrade, persisted UI journeys, audit evidence and reconciled requirements                                            | Pending                                      |

## F06.1 behavior

Migration 005 adds customers and append-only-for-runtime customer display-history, plus mandatory customer_id on companies and estates. The composite estate/company/customer foreign key rejects mixed-tenant relationships. Existing companies/estates keep their original IDs; memberships/work/allocations are not rewritten. Until client-approved mapping exists, each legacy company receives its own customer root with a deterministic MIG code. This conservative migration is not a claim about the customer's final commercial/group structure. Do not merge companies into a tenant just because their names look similar.

Fresh synthetic seed supplies customer IDs explicitly. A reseed preserves an existing company's customer mapping. New customer inserts/updates capture safe before/after code/name history in the same transaction through a restricted trigger function. System/migration actions retain a null actor and are labeled honestly; no fictional user/request ID is created. The runtime role has SELECT only on customer/history tables, no provisioning or mutable-history grant.

`GET /api/organization` returns only estates readable through existing membership/RLS, with their company and customer display context. A user can see the root label of their assigned estate without gaining access to any other estate under that company/customer. `GET /api/customers/:customerId/history` checks customer visibility and projects only display code/name changes, actor, time and a valid request reference if captured. This provisional display-history read rule is not a new sensitive-administration audit permission; granular permissions remain F09–F12 work.

The Organization navigation screen guides: choose accessible customer → inspect legal company and assigned estate → inspect recorded customer display history → open estate register. It is intentionally read-only in this increment; tenant provisioning, reparenting and node configuration have no new UI write action. API queries are bounded (200 estate rows, latest 50 history events) and explicitly report truncation. Full pagination/search is pending before large-customer acceptance. Loading, empty, history failure and organization failure states are distinct.

## Verification obligations

- Real PostgreSQL/API tests: authentication, own-estate-only results, same-customer sibling denial, foreign-customer/history denial, no-context RLS, runtime mutation denial, mixed-tenant FK rejection and before/after history.
- A separate temporary local database creates the pre-F06 schema and legacy company/estate/user/membership, then applies migration 005 and verifies preserved IDs, customer mapping/history and runtime RLS. It does not reset the shared test/development database.
- E2E-JRN-02-001 runs at desktop/mobile viewport widths: scoped organization context, customer creation evidence and handoff to the assigned estate's register. It is partial hierarchy evidence, not proof of all JRN-02/F06 requirements.
- All existing domain/API/browser/PWA/Docker/coverage checks remain active. New coverage inventory items are mapped to actual named assertion steps.

## Historical F06.1 limits (superseded in part by later increments)

No customer/group provisioning UI, division/field/block hierarchy CRUD, cycle/move/effective-date model or general inherited authorization is claimed yet. Estate codes still have their legacy global uniqueness constraint; tenant-local business codes and their negative cases must be addressed with controlled hierarchy configuration. Existing operational records still enforce estate membership; full customer/record/field permission enforcement and production identity remain downstream gates. Production startup remains blocked. F06 completion requires the full roadmap acceptance, not just this working read slice.

## Executed F06.1 evidence — 17 October 2026 (India)

[CI run 38966302671](https://github.com/kunal1274/ssjns-eoms/actions/runs/38966302671) passed on source `8027aad3364576c29d32b7e9a095ab72209f6cec`: 34 unit/config/security/presentation/ledger tests, 21 PostgreSQL/API tests and the separate legacy-schema upgrade harness, through both host CI and Docker verification. The upgrade harness preserved original company/estate/membership IDs, created correct customer mappings/history and verified runtime RLS in a separate temporary database. All eight Playwright executions passed, including the new organization/history/estate-handoff scenario at desktop/mobile viewport widths. Existing browser/PWA/installability, coverage-ledger filters, formatting/build, dependency audit (zero known vulnerabilities), Docker/proxy/idempotency/persistence and final quality-gate passed. The generated ledger reported 44 passed/40 untested item/project rows (42 inventory items total).

The later evidence commit is documentation-only. F06.1 is verified; F06 remains In progress. Local interactive observation, complete hierarchy configuration/inheritance, production identity/permission enforcement and full phase acceptance are still open.

## F06.2 controlled configuration

Migration 006 introduces optional customer-local legal groups and company assignment separately from estate-local operating units. A division attaches to its estate; a field requires a division; a block requires a division or field. Composite foreign keys, RLS and trigger checks prevent foreign tenant/estate parents, invalid parent types, self-links and cycles. Per-estate advisory locks serialize hierarchy edits. Unit kind, tenant and estate are immutable; optimistic versions prevent stale overwrites. Estate codes are customer-local, group codes customer-local and unit codes unique within estate and kind.

Setup authority requires an explicit customer grant in organization_admins. An existing manager role alone grants no setup rights. The synthetic manager account receives an explicit development seed grant; legacy upgrade grants nobody automatically. Grant bootstrap/revocation is recorded with honest system provenance. Runtime cannot self-grant, delete hierarchy records or mutate history. Operational writes require both setup authority and estate membership. Legal group visibility does not grant access to sibling estate records. Grant administration UI and the complete permission engine are future work.

Organization → Hierarchy setup guides group creation, company assignment, estate selection and division/optional-field/block creation or editing. A reason is required for every save. Errors preserve entered values and expose safe recovery/reference guidance; version conflicts require refresh and choosing Edit again. A saved write followed by a failed refresh is explicitly identified so users do not blindly resubmit. Lists are bounded with visible truncation notices. Group rename/edit is not exposed in this increment.

Append-only hierarchy events contain projected before/after display/relationship fields, version, actor, reason, timestamp and server request ID. The UI offers a short summary and expandable details. Estate members see only unit history in their estates; legal/setup history requires explicit setup authority. This is provisional display-history scope, not completion of sensitive audit permissions.

### Remaining F06 scope

Region/business-unit nodes; business effective dates and legal ownership lineage; move/deactivation rules and consequences; downward scope inheritance/full permission engine; completion/rollout of canonical task-to-block links (F06.3a adds explicit links while retaining legacy compatibility); full search/pagination; grant lifecycle administration; group editing and final client requirement/journey acceptance remain open. F06 remains In progress. F07–F25 are not completed by this change.

### Verification for this increment

Local typecheck, 35 unit/config/security/ledger tests and production build passed. Added six PostgreSQL/API tests plus legacy upgrade through migration 006; real execution passed in CI as recorded below. E2E-JRN-02-002 creates and assigns a group, creates division/field/block, edits a block, reloads persisted relationships and inspects before/after audit with reason/reference. Four precise assertion bindings expand the inventory to 46 items (26 mapped, 20 gaps); five scenarios across two viewport projects are expected. Expected counts are not executed evidence.

## Verified F06.2 — 17 October 2026 (India)

[CI run 38977060930](https://github.com/kunal1274/ssjns-eoms/actions/runs/38977060930) passed for branch source `258a03860ed53a3f9cbdbd0b1f3ba80f9661bab4` (the pull-request workflow checks its generated merge with the base). Passed: 35 unit/config/security/ledger tests + 27 PostgreSQL/API tests; separate pre-F06 legacy upgrade through migrations 005/006 with original IDs/membership preserved, RLS enforced and no implicit setup grants; ten desktop/mobile Playwright executions including E2E-JRN-02-002; generated-ledger UI; existing browser/workflow/PWA/installability checks; formatting/build; dependency audit with zero known vulnerabilities; actual Docker build/start, container database tests, proxy/idempotency/persistence after recreation and quality-gate. Ledger: 52 passed/40 untested item/project rows (26 mappings/20 gaps across two viewport projects), not a product coverage percentage.

The first candidate failed because a newly inserted synthetic test email was uppercase while sign-in normalizes emails; normalizing that fixture fixed the failure without changing authentication. The verified run includes sibling-estate unit/history denials. This evidence follow-up is documentation-only. F06.2 controlled configuration is verified; F06 stays In progress. Next: F06.3 model/access completion, then F06.4 requirement/journey acceptance. F05 owner exception remains valid; local visible desktop observation, complete process coverage and the custom replay/recording dashboard remain open.

## F06.3a — Connect hierarchy to operational tasks

**Implemented; full CI verification pending.** Migration 007 adds a nullable stable block_unit_id to task occurrences, with an estate-aware foreign key and block-kind validation. Existing task IDs, text codes, versions, work and allocations are preserved; migration never guesses links from matching codes. New tasks can select a configured block and record its code at creation. The text code is a historical snapshot; subsequent block code/name changes retain the same stable task reference, and the task list shows the current configured display alongside the recorded code.

For compatibility, the legacy free-text creation path remains available and is explicitly labeled unlinked. This is not mandatory full block attribution. An estate manager can review an unlinked task against a configured block with exactly the same recorded code and save a required reason using the current task version. Foreign-estate/wrong-kind/mismatched blocks, stale writes and reassignment/removal of recorded links are rejected. Linking is atomic and never rewrites existing work or allocations. This uses current estate-manager authorization, not the unfinished custom permission engine. Setup permission is still separately required to create/change the hierarchy itself.

The database enforces link kind/scope, reason, manager authority, version transition and immutable saved reference. A restricted trigger records projected task-link before/after fields in append-only hierarchy history. The estate audit also records a readable task.block-linked summary, reason, version and request reference. API reads remain estate scoped. The UI guides Task capacity → configured block/task → muster capture, and provides an explicit legacy review panel, retained inputs after rejection and safe guidance for saved-write/failed-refresh cases. Task capacity links to Organization setup. The unit selector remains bounded; large-data search/navigation is still pending.

Four new PostgreSQL/API tests cover configured create/renaming, reviewed legacy linking with unchanged work/allocation rows, foreign/mismatched/unauthorized/stale failures, direct database guards and history. The upgrade harness now includes a pre-F06 task and migration 007 preservation checks. E2E-JRN-06-001 covers configured task creation, explicit legacy mode, an injected no-write conflict with retained fields, real linking, persisted work against the configured task ID, audit review and hierarchy handoff. Four assertion mappings yield 50 inventory items (30 mapped/20 gaps), expected 60 passed/40 untested rows across two projects. Expected counts are not execution proof.

Next F06.3b: optional region/business-unit nodes and scoped estate placement; then effective ownership, move/deactivation rules, inheritance, large-data navigation and final F06.4 acceptance. Full block-attribution rollout, legacy discrepancy resolution and permission-engine alignment remain open.

## Repository publication / CI checkpoint

Implementation remains local. Automatic approval review rejected the GitHub create-tree upload because it considered explicit authorization to share the source/documentation with the public repository unverified. Read-only checks confirmed the destination is the existing kunal1274/ssjns-eoms repository and draft PR #1, branch planning/production-roadmap-data-security, still at 2063535a200a3583d236d8365c9d3ecb4e1cd9d9. No F06.3a source has been pushed. Owner confirmation to push this concrete increment to that public destination is needed before retrying. Local typecheck, formatting, all 35 unit/config/security/ledger tests, production build and twelve-test discovery passed. PostgreSQL/API/upgrade, actual Playwright execution and Docker CI are NOT verified for this increment. Prior F06.2 evidence remains valid for its exact source only.

Owner confirmation, 17 October 2026, 04:38 IST: “yes okay to approve and confirmed and lets proceed.” This explicitly authorizes pushing the prepared F06.3a increment to the existing public kunal1274/ssjns-eoms repository/current draft PR and running CI. The publication blocker above is resolved; verification remains pending actual execution. No automatic merge/deployment is authorized.
