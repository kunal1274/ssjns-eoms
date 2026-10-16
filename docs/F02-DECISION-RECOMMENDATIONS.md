# F02 — Recommended Decision Dispositions (Owner Review)

**Status:** Recommendations only; not client sign-off or accepted policy.  
**Review date:** 16 October 2026  
**Branch:** `planning/production-roadmap-data-security`  
**Related records:** [Owner decision register](F02-OWNER-DECISIONS.md) · [Requirement catalogue](F02-REQUIREMENT-CATALOGUE.md) · [Persona journey register](F02-PERSONA-JOURNEYS.md) · [Traceability matrix](TRACEABILITY-F02.md)

## Purpose

The project owner asked to proceed using common, defensible ERP and plantation-industry patterns. DEC-01's flexible tenant/legal/operating hierarchy is already selected as the product-design baseline. This document proposes a practical disposition for DEC-02–DEC-09 so F02 can move forward without disguising unresolved client, commercial, payroll or operations policy as fact.

**How to interpret the recommendations**
- **Recommend as product default** means it is a proposed baseline for the owner to accept/change; it is not yet approved.
- **Safe interim guard** means the implementation must remain conservative while a decision is open.
- No numeric commercial, payroll, SLO, retention or recovery value is invented.
- A recommendation does not authorize production access, payroll/GL posting, live integration posting or closure of F02.

## Decision-by-decision proposal

| Decision | Recommended product default | Safe interim guard while unresolved | Owner input still required |
|---|---|---|---|
| DEC-02 — Identity and sessions | Prefer the customer's approved OIDC identity provider where available; require MFA for privileged administrators and approvers; use secure, revocable server-side sessions and centralized provisioning/deprovisioning. Keep local-password production login disabled unless explicitly approved as an exception. | Keep production startup gated. Never weaken HTTPS, CSRF/origin checks, secure cookie attributes, rate limiting or session revocation to unblock a demo. | Client IT/security and product owner approve identity provider, MFA coverage, recovery, session lifetime/revocation and any local-login exception. |
| DEC-03 — Permissions and audit readership | Use stable, versioned resource/action permission keys, assigned through roles and separately bound to explicit data scope. Enforce decisions server-side and at the DB layer where applicable. Start sensitive audit-detail access with designated audit/compliance and specifically authorized management permissions; do not grant it to all operational users by default. | Retain deny-by-default access. UI hiding is never a security control. Do not expose sensitive audit detail or widen data scope just to make a screen work. | Product owner plus client operations/security approve the permission catalogue, standard role templates, audit readership and field-level restrictions. |
| DEC-04 — Separation of duties | Use maker-checker for approvals, reversals and other owner-designated high-risk transitions. A creator cannot approve their own transaction. Require reasoned, linked correction/reversal records; record delegation and make emergency overrides explicit, time-limited and auditable. | Keep high-risk approval/reversal gated until the transition matrix is approved. Do not silently allow self-approval or overwrite historical records. | Client operations/payroll owner approves which transaction types require independent approval, delegation rules, exception path and any legally required controls. |
| DEC-05 — Licensing and seats | Keep entitlements separate from roles and scope. Use named-user seats as the initial commercial proposal; support concurrent/mixed licensing only when a signed agreement requires it. Enforce licensed modules/features and seat limits on the server. | Do not invent grace periods. Never delete customer data on expiry. Do not permit users to self-enable features or exceed contracted capacity. Avoid implementing expiry-side read/export/write behavior until contract terms are confirmed. | Commercial/product owner and contract owner approve seat model, modules/features, limits, expiry, grace, suspension, renewal and restoration rules. |
| DEC-06 — Checkroll/payroll calculations | Use deterministic decimal arithmetic, explicit UOM/precision, effective-dated rule versions and signed worked examples for normal, boundary, rounding, overtime, incentive, allowance, deduction, correction and reconciliation cases. Preserve original financial history; use linked adjustments/reversals. | Do not infer wage or rounding rules from current muster code. Keep payroll calculations/posting and finance/GL export disabled until calculation and reconciliation examples are approved. | Client payroll/finance and operations approve source of truth, rates, UOM, rounding, OT/incentive/deduction rules, close/reopen and reconciliation expectations. |
| DEC-07 — SAP Business One and HR/payroll integrations | Use a transactional outbox, stable idempotency/event keys, bounded retry policy, explicit acknowledgements, visible failed-message handling and reconciliation. Define source-of-truth ownership per data domain and versioned contracts with narrow service identities and field-level scope. | No live external posting without signed mappings/contracts and duplicate/correction semantics. Never retry non-idempotent financial effects blindly; quarantine ambiguous outcomes for reconciliation. | Client integration, finance and payroll owners approve system authority, interface direction, mappings, error ownership, retry limits and correction/compensation behavior. |
| DEC-08 — Operations and production readiness | Require monitored backups, encrypted backup storage, documented incident/recovery procedures, restore rehearsals, environment separation, secrets management and measurable load/SLO tests. Define RPO/RTO and retention from business impact rather than choosing arbitrary numbers. | Keep production release gated until numeric targets, restore evidence, security review and support ownership are approved. Do not claim availability/capacity without test evidence. | Product owner, client operations and security approve expected load, growth, SLO, retention, backup frequency, RPO/RTO, monitoring and recovery acceptance. |
| DEC-09 — Hosted-demo/source parity | Treat the inspected repository and available screenshots/browser evidence as the implementation baseline. Add a hosted-demo-only requirement only when a specific persona, screen, action and expected result are identified. | Do not invent behavior from an inaccessible/uninspected rendering. Do not treat external hosting or deployment as required unless the owner explicitly asks for it. | Product owner confirms whether any particular demo-only journey is required but absent from repository evidence; otherwise record “none identified in reviewed material.” |

## Recommended disposition categories

For each DEC-02–DEC-09, the accountable owner should choose one of:
1. **Accept product default** — accept the recommendation as a product baseline, with client-specific contract/configuration still required where noted.
2. **Change** — record the replacement rule and its rationale.
3. **Defer with owner/date** — record the accountable person, due date, interim guard and downstream phase blocked.
4. **Not applicable** — explain why the decision does not apply to this product/customer.

## What can safely proceed before all decisions are closed?

- Requirement and journey traceability can continue, using these proposals as clearly labelled candidates.
- Repository evidence mapping and negative-test planning can continue without enabling missing capabilities.
- F03 architecture conventions can be drafted only after the owner accepts the F02 requirement baseline; implementation of production identity, payroll posting, contract-specific licensing behavior and live integrations remains gated by their respective decisions.
- Customer-specific hierarchy data can be collected later as configuration input without changing the selected flexible DEC-01 product baseline.

## F02 completion rule

This proposal improves decision readiness but **does not close F02**. F02 still requires the owner to accept/change the requirement catalogue and journeys, disposition DEC-02–DEC-09 (or explicitly defer with owner/date), confirm any required hosted-demo-only journeys, and accept the traceability baseline. F03 must not start before that acceptance.
