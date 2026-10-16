# F02 — Owner decision register and proposed defaults

**Status:** DEC-01 is accepted as the product-design default; DEC-02–DEC-09 remain proposals pending explicit disposition by their accountable owners.  
**Purpose:** Make F02 decisions explicit so later architecture and implementation do not encode unapproved assumptions. DEC-01's flexible hierarchy/security design is accepted as the product-design default by explicit project-owner instruction; all other proposed defaults remain unapproved until explicitly accepted. The companion [recommended disposition proposal](F02-DECISION-RECOMMENDATIONS.md) explains a safe interim guard and accountable-owner input for DEC-02–DEC-09.

## Decision protocol

- The F01–F25 phase list remains canonical. This register supports F02 and does not authorize starting F03.
- Proposed defaults are recommendations to accelerate review, not approved product requirements.
- If an item cannot be decided now, record the owner, rationale, interim constraint and the phase it blocks.
- Production access, payroll/financial posting and customer data exposure must remain gated until their applicable decisions and tests are accepted.

## Decisions

### DEC-01 — Customer tenancy, legal entities and plantation operating hierarchy

**Status:** **Accepted as the product-design default on 16 October 2026**, following the project owner's explicit acceptance of the recommended plantation ERP hierarchy. This accepts the flexible product architecture, **not** any particular client's legal-company chart, estate names or customer-specific scope assignments.

**Design principle:** Keep the SaaS tenant boundary, legal/financial structure and plantation operating structure separate. Do not hard-code them into one mandatory chain.

**A. SaaS tenant boundary (security boundary)**

`Platform → Customer tenant`

- Each customer tenant is a hard data-isolation boundary, not an extra plantation operating unit.
- Every tenant-owned record and background/integration operation must carry a verifiable tenant context; PostgreSQL row-level security (RLS) must fail closed if that context is missing or invalid.
- A user can belong to more than one tenant only through explicit membership, with tenant context selected and validated for each request.

**B. Legal and financial structure (configurable)**

`Customer tenant → Group (optional) → Legal entity / Company`

- A tenant may have one company or multiple legal entities under a group.
- Create a separate legal entity only where legal, statutory, tax, currency, fiscal-calendar or accounting requirements justify it; do not create a separate company merely because an estate or division exists.
- Legal entity ownership/accounting attribution must be explicit for operational transactions and can be effective-dated where ownership or responsibility changes.
- Maintain legal/reporting hierarchies separately from the plantation's operational hierarchy when the business needs different views.

**C. Plantation operating hierarchy (configurable)**

`Legal entity / responsible company → Region / Business unit (optional) → Estate / Plantation → Division / Afdeling → Field (optional) → Block`

- **Estate** is the plantation/site management level; **Division/Afdeling** groups fields; **Block** is the primary agronomic and field-operations unit for work, harvest/yield, inputs and cost attribution.
- **Field** is an optional grouping level where the client's terminology and mapping requires it. An estate can contain divisions directly, and configurations may omit levels that do not exist in the real organization.
- Use block-level capture where the process is naturally block-based, then aggregate results upward to field, division, estate, company and group. Do not force every transaction to block level if its real business object is a mill, nursery, warehouse, workshop, fleet asset or another operational site.
- Mills, nurseries, warehouses, workshops and other facilities should be modeled as typed operational sites linked to the relevant tenant and legal entity, and optionally to an estate; do not force them under a block.
- Use stable IDs, tenant-scoped unique business codes, effective dates and an auditable change history for hierarchy changes. Preserve the historical operational/financial attribution of posted records.

**D. Authorization and data-level security**

- Roles/permissions answer **what action** a user may perform; scope assignments answer **which records/locations** they may act on; licensing answers **which modules/features** the customer has purchased. These remain separate controls.
- Scope assignments must name the node and permitted actions/permissions. Descendant access is granted only when the assignment's inheritance policy explicitly allows it. No implicit sibling access, upward access, or access to another tenant.
- Enforce scope in the server and PostgreSQL RLS—not just menus or client-side filters. Apply it to APIs, search, reports/exports, attachments, offline synchronization, background jobs and integrations.
- Where a user has multiple assignments, the effective access is the explicitly authorized union of those assignments within the selected tenant, still constrained by permissions and licensed features.

**Industry/ERP basis:** Microsoft Dynamics 365 recommends deciding legal entities from legal/accounting requirements, using operating units for operational control, and allowing multiple hierarchies for different purposes ([organization hierarchy guidance](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/plan-organizational-hierarchy), [organizational hierarchies overview](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/organizations-organizational-hierarchies)). Plantation references commonly use Estate → Division/Afdeling → Block, with optional Field as a grouping level and block-level capture/aggregation ([plantation ERP overview](https://www.saka-erp.id/software-perkebunan-kelapa-sawit), [plantation hierarchy and block-level data research](https://www.tropcropconsult.com/wp-content/uploads/2017/04/What-does-OMP-do-20170405-small.pdf), [SAP S/4HANA plantation example](https://www.weefer.co.id/sap-s4hana-for-plantation/)). These are a recommended baseline, not a claim that every plantation uses identical terminology.

**Owner/client confirmation still required:** actual group/company structure, optional operating levels, legal entity responsible for each estate/site, special managed-estate arrangements, and any cross-company operational responsibilities. Record these as tenant configuration and customer-specific requirements rather than changing the core design.

**Owner:** Product owner (architecture baseline) and client data/security owner (customer-specific mapping).  
**Downstream phases:** F06 (customer hierarchy), F09–F12 (permissions and record-level access), F19–F22 (licensing) and all modules that store location-scoped transactions.

### DEC-02 — Production identity and session policy

**Question:** Which identity provider and controls are required for production?

**Proposed default:** Use the client's approved OIDC identity provider where available; require MFA for privileged roles and approvers, with a documented policy for other users. Keep local password authentication limited to development/test unless explicitly approved for production. Define provisioning/deprovisioning, recovery, session revocation, expiry, secure cookies, HTTPS and emergency access before enabling production.

**Owner:** Client IT/security and product owner.  
**Blocks:** F07, F08, production access and user lifecycle acceptance.

### DEC-03 — Permission catalogue and audit readership

**Question:** Which stable permissions exist, and who may read sensitive audit details?

**Proposed default:** Define versioned resource/action keys independent of role names (for example, module + resource + action). Assign permissions to standard or customer-defined roles, then bind each assignment to an explicit scope. Enforce policies in the API and data layer; UI visibility is not authorization. Start audit-detail access with designated audit/management roles only, then confirm the final readership with the client.

**Owner:** Product owner, client operations and security.  
**Blocks:** F09–F18 and audit confidentiality acceptance.

### DEC-04 — Separation of duties and delegation

**Question:** Can one person create/capture, confirm, approve, reverse or correct the same transaction? What delegation is allowed?

**Proposed default:** Use maker-checker for approval and reversal: the originating actor cannot approve or reverse their own record. Require a reason for reversal/correction, retain immutable original evidence, and record actor, time and any delegation. If an emergency override is required, make it explicit, time-limited and independently auditable rather than silently bypassing the rule.

**Owner:** Client operations/payroll owner and product owner.  
**Blocks:** F13, F23 and end-to-end workflow acceptance.

### DEC-05 — Licensing, modules, seats and expiry

**Question:** Which modules/features are contracted, are seats named or concurrent, and what happens at expiry, grace and suspension?

**Proposed default:** Keep licensing separate from role permissions. Use named-user seats as the starting proposal because they provide clear actor accountability; choose concurrent or mixed seats only if the commercial agreement requires it. Enforce modules, features and seat capacity on the server. Never delete customer data on expiry. Agree the precise grace, read/export, write-suspension, renewal and restoration policy contractually before implementing it; do not invent a grace period.

**Owner:** Commercial/product owner and client contract owner.  
**Blocks:** F19–F22 and entitlement-related journey acceptance.

### DEC-06 — Checkroll, payroll and financial calculation rules

**Question:** What are the authoritative rates, UOM/precision, rounding, overtime, incentive, allowance, deduction, correction and reconciliation rules?

**Proposed default:** Do not infer payroll rules from the existing muster implementation. Obtain signed examples for normal, boundary and correction cases; use deterministic decimal calculations and effective-dated rule versions. Preserve the original transaction and use traceable adjustment/reversal records rather than rewriting financial history. Keep payroll, finance and GL posting disabled until the calculation and reconciliation rules are approved.

**Owner:** Client payroll/finance and operations owners.  
**Blocks:** Checkroll/payroll implementation, financial reconciliation and external posting.

### DEC-07 — SAP Business One and HR/payroll integration contracts

**Question:** Which systems are authoritative, which interfaces and mappings apply, and what are the acknowledgement, retry and correction rules?

**Proposed default:** Use a transactional outbox and idempotent dispatch with stable event keys, explicit acknowledgements, bounded retries, a visible failed-message queue and reconciliation. Define service identities and field-level data sharing per integration. Do not enable live partner posting until owners approve interface contracts, mappings, duplicate handling and correction semantics.

**Owner:** Client integration owners and finance/payroll owners.  
**Blocks:** Integration architecture, production cutover and no-double-posting acceptance.

### DEC-08 — Scale, retention, backup/restore and operations

**Question:** What load/SLO, data retention, backup frequency, RPO/RTO, monitoring and recovery targets are required?

**Proposed default:** Do not invent numeric targets. Record expected users, peak transactions, data growth and report windows; agree measurable SLO and load-test acceptance. Require encrypted backups, monitored jobs, documented incident/recovery steps and a successful restore rehearsal before production. Approve retention and RPO/RTO with the business owner and operations/security team.

**Owner:** Product owner, client operations and security.  
**Blocks:** F03–F05, performance validation and production readiness/cutover.

### DEC-09 — Hosted demo and repository requirement parity

**Question:** Does the ChatGPT-hosted rendered demo contain any required screen or interaction not represented by the source archive or screenshots?

**Proposed default:** Treat the repository plus supplied screenshots as the current inspectable implementation baseline. Do not assume an external deployment/export is required. If the hosted rendering contains a requirement that must be retained, identify the specific persona, screen, action and expected outcome so it can be added to the traceability matrix and tested in the repository build.

**Owner:** Product owner/requester.  
**Blocks:** F02 baseline acceptance only for any specifically identified missing journey.

## Review record

Review record: **DEC-01 — Accepted by the project owner on 16 October 2026** as the product-design default. Customer-specific legal-entity mapping, operating levels and scope assignments remain open for configuration. For DEC-02–DEC-09, record one of **Accepted**, **Changed**, **Deferred with owner/date**, or **Not applicable**, plus a short rationale. F02 remains in progress until the requirement baseline and relevant blockers are explicitly accepted or deferred. The unaccepted DEC-02–DEC-09 proposals are not client sign-off.
