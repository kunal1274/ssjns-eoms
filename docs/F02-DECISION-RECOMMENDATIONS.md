# F02 — Accepted Decision Defaults and Implementation Guards

**Status:** DEC-02–DEC-09 defaults accepted by the project owner on 16 October 2026. Customer-specific policies and production evidence remain gated where noted.  
**Review date:** 16 October 2026  
**Branch:** `planning/production-roadmap-data-security`  
**Related records:** [Owner decision register](F02-OWNER-DECISIONS.md) · [Requirement catalogue](F02-REQUIREMENT-CATALOGUE.md) · [Persona journey register](F02-PERSONA-JOURNEYS.md) · [Traceability matrix](TRACEABILITY-F02.md)

## Purpose

The project owner has explicitly accepted the recommended defaults for DEC-02–DEC-09 as product baselines, in addition to DEC-01. This document records those defaults and their safe implementation guards. Acceptance establishes the product's default approach; it does not invent customer-specific contract terms, payroll values, integration mappings, retention periods or recovery/SLO numbers.

**How to interpret this register**
- The product owner has accepted the defaults below for DEC-02–DEC-09.
- **Accepted default** defines the product's baseline behavior and architecture.
- **Implementation/production guard** remains binding until the required customer configuration, signed examples/contracts, and verification evidence exist.
- No numeric commercial, payroll, SLO, retention or recovery value is invented.
- Acceptance does not authorize production access, payroll/GL posting, live integration posting or closure of F02.

## Accepted defaults by decision

| Decision | Accepted product default | Implementation/production guard | Customer-specific configuration or evidence still required |
|---|---|---|---|
| DEC-02 — Identity and sessions | Prefer the customer's approved OIDC identity provider where available; require MFA for privileged administrators and approvers; use secure, revocable server-side sessions and centralized provisioning/deprovisioning. Keep local-password production login disabled unless explicitly approved as an exception. | Keep production startup gated. Never weaken HTTPS, CSRF/origin checks, secure cookie attributes, rate limiting or session revocation to unblock a demo. | Client IT/security and product owner approve identity provider, MFA coverage, recovery, session lifetime/revocation and any local-login exception. |
| DEC-03 — Permissions and audit readership | Use stable, versioned resource/action permission keys, assigned through roles and separately bound to explicit data scope. Enforce decisions server-side and at the DB layer where applicable. Start sensitive audit-detail access with designated audit/compliance and specifically authorized management permissions; do not grant it to all operational users by default. | Retain deny-by-default access. UI hiding is never a security control. Do not expose sensitive audit detail or widen data scope just to make a screen work. | Product owner plus client operations/security approve the permission catalogue, standard role templates, audit readership and field-level restrictions. |
| DEC-04 — Separation of duties | Use maker-checker for approvals, reversals and other owner-designated high-risk transitions. A creator cannot approve their own transaction. Require reasoned, linked correction/reversal records; record delegation and make emergency overrides explicit, time-limited and auditable. | Keep high-risk approval/reversal gated until the transition matrix is approved. Do not silently allow self-approval or overwrite historical records. | Client operations/payroll owner approves which transaction types require independent approval, delegation rules, exception path and any legally required controls. |
| DEC-05 — Licensing and seats | Keep entitlements separate from roles and scope. Use named-user seats as the default; support concurrent/mixed licensing only when a signed agreement explicitly requires it. Enforce licensed modules/features and seat limits on the server. | Do not invent grace periods. Never delete customer data on expiry. Do not permit users to self-enable features or exceed contracted capacity. Avoid implementing expiry-side read/export/write behavior until contract terms are confirmed. | Commercial/product owner and contract owner approve seat model, modules/features, limits, expiry, grace, suspension, renewal and restoration rules. |
| DEC-06 — Checkroll/payroll calculations | Use deterministic decimal arithmetic, explicit UOM/precision, effective-dated rule versions and signed worked examples for normal, boundary, rounding, overtime, incentive, allowance, deduction, correction and reconciliation cases. Preserve original financial history; use linked adjustments/reversals. | Do not infer wage or rounding rules from current muster code. Keep payroll calculations/posting and finance/GL export disabled until calculation and reconciliation examples are approved. | Client payroll/finance and operations approve source of truth, rates, UOM, rounding, OT/incentive/deduction rules, close/reopen and reconciliation expectations. |
| DEC-07 — SAP Business One and HR/payroll integrations | Use a transactional outbox, stable idempotency/event keys, bounded retry policy, explicit acknowledgements, visible failed-message handling and reconciliation. Define source-of-truth ownership per data domain and versioned contracts with narrow service identities and field-level scope. | No live external posting without signed mappings/contracts and duplicate/correction semantics. Never retry non-idempotent financial effects blindly; quarantine ambiguous outcomes for reconciliation. | Client integration, finance and payroll owners approve system authority, interface direction, mappings, error ownership, retry limits and correction/compensation behavior. |
| DEC-08 — Operations and production readiness | Require monitored backups, encrypted backup storage, documented incident/recovery procedures, restore rehearsals, environment separation, secrets management and measurable load/SLO tests. Define RPO/RTO and retention from business impact rather than choosing arbitrary numbers. | Keep production release gated until numeric targets, restore evidence, security review and support ownership are approved. Do not claim availability/capacity without test evidence. | Product owner, client operations and security approve expected load, growth, SLO, retention, backup frequency, RPO/RTO, monitoring and recovery acceptance. |
| DEC-09 — Hosted-demo/source parity | Treat the inspected repository and available screenshots/browser evidence as the implementation baseline. Add a hosted-demo-only requirement only when a specific persona, screen, action and expected result are identified. | Do not invent behavior from an inaccessible/uninspected rendering. Do not treat external hosting or deployment as required unless the owner explicitly asks for it. | Product owner confirms whether any particular demo-only journey is required but absent from repository evidence; otherwise record “none identified in reviewed material.” |

## Decision record

**DEC-02–DEC-09: Accepted by the project owner on 16 October 2026.** The defaults above are now the product baseline. If a future customer contract or mandatory legal/operational requirement needs a different behavior, record a deliberate, scoped exception with an owner and rationale; do not silently weaken security or data-integrity controls.

## What can safely proceed before all decisions are closed?

- Requirement and journey traceability can continue, using these proposals as clearly labelled candidates.
- Repository evidence mapping and negative-test planning can continue without enabling missing capabilities.
- F03 architecture conventions can be drafted only after the owner accepts the F02 requirement baseline; production identity configuration, payroll calculations/posting, contract-specific licensing behavior and live integrations remain gated by customer configuration, signed rules/contracts and verification evidence.
- Customer-specific hierarchy data can be collected later as configuration input without changing the selected flexible DEC-01 product baseline.

## F02 completion rule

The defaults for DEC-02–DEC-09 are accepted, but this document **does not close F02**. F02 still requires review/acceptance of the draft requirement catalogue and journeys, mapping of approved requirements to exact implementation/test evidence, confirmation of any required hosted-demo-only journeys, and acceptance of the traceability baseline. F03 must not start before that acceptance.
