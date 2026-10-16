# F06 — Customer and organizational hierarchy

**Status:** In progress. F06 starts under the owner's documented F05 development exception; see F05-OWNER-EXCEPTION.md. This phase is not complete after the first increment.

## Accepted model and delivery steps

Customer tenant remains a distinct boundary from legal/financial company/group structure and the plantation operating hierarchy. Preserve the accepted DEC-01 flexibility: optional region/business unit, estate, division/afdeling, optional field, block; explicit legal responsibility/effective dates and downward scope grants. Parent visibility never implies sibling/upward/global record access.

| Increment | Scope | Status |
|---|---|---|
| F06.1 Customer boundary and scoped context | Explicit customer roots, company/estate tenant keys, conservative legacy migration, safe read API, history and guided organization-to-estate handoff | Implemented; execution evidence recorded below after verification |
| F06.2 Hierarchy configuration | Separate group/legal relationships and operational nodes; valid parent/type rules, no cycles/cross-tenant links, approved ownership/effective relationships, controlled administration UI/API | Next |
| F06.3 Access and history completion | Explicit inheritance/scoped grants, hierarchy-change lineage, move/deactivation/conflict rules and larger-data navigation; align with F09–F13 permission engine | Planned, dependencies explicit |
| F06.4 Phase acceptance | Positive/negative tenant/hierarchy cases, safe upgrade, persisted UI journeys, audit evidence and reconciled requirements | Pending |

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

## Remaining limits

No customer/group provisioning UI, division/field/block hierarchy CRUD, cycle/move/effective-date model or general inherited authorization is claimed yet. Existing operational records still enforce estate membership; full customer/record/field permission enforcement and production identity remain downstream gates. Production startup remains blocked. F06 completion requires the full roadmap acceptance, not just this working read slice.
