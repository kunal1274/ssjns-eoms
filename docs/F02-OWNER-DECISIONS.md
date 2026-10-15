# F02 — Owner decision register and proposed defaults

**Status:** Proposal for review only; none of these defaults is accepted until the accountable owner confirms it.  
**Purpose:** Make F02 decisions explicit so later architecture and implementation do not encode unapproved assumptions.

## Decision protocol

- The F01–F25 phase list remains canonical. This register supports F02 and does not authorize starting F03.
- Proposed defaults are recommendations to accelerate review, not approved product requirements.
- If an item cannot be decided now, record the owner, rationale, interim constraint and the phase it blocks.
- Production access, payroll/financial posting and customer data exposure must remain gated until their applicable decisions and tests are accepted.

## Decisions

### DEC-01 — Customer and operational hierarchy

**Question:** What is the authoritative customer/group/company/estate/division/block structure, and how does access inherit?

**Proposed default:** Model the conceptual path as **Customer → Group → Company → Estate → Division → Block**, allowing Group, Division or Block to be optional only where the customer's operating model requires it. Every record must have an unambiguous tenant/parent relationship. Parent-level access should flow downward only when the assignment explicitly grants inheritance; no implicit access to siblings, other customers or parent records. Deny by default.

**Owner:** Product owner and client data/security owner.  
**Blocks:** F06, F12, F11 and hierarchy-dependent reports/exports.

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

For each decision, record one of: **Accepted**, **Changed**, **Deferred with owner/date**, or **Not applicable**, plus a short rationale. F02 remains in progress until the requirement baseline and relevant blockers are explicitly accepted or deferred. No proposed default in this document should be treated as client sign-off.
