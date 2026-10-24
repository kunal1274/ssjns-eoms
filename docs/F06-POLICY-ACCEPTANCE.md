# Explicit policy recording authority and external decisions

24 October 2026. Implementation candidate; full PostgreSQL/browser/Docker gate pending. Local53 unit/contract tests, type/build and formatting checks passed. F06 remains In progress, F07+ not started; full F01–F25 and reusable visible recording/review/one-click testing remain delivery scope. No merge/deployment or hosted-prototype change.

This increment delivers a workflow to record referenced external owner/client policy decisions under explicit scoped appointments. It does not fabricate a client decision, authenticate a signature/custody chain, grant production mapping approval or enable application. Actual authority/delegation and decision references must come from the responsible people. Seeded verification references are synthetic only.

| Step | Capability | Status |
| --- | --- | --- |
| 1 | Strict appointment contract with named subject, delegation reference, reason, revision and actor-bound retry key | Implemented; full gate pending |
| 2 | Immutable estate-scoped appointment/revocation lineage with actual actor/time/support reference; self appointment denied | Implemented; full gate pending |
| 3 | Scoped searchable/paged eligible-recorder selection and current appointment inspection without exposing raw setup grants | Implemented; full gate pending |
| 4 | Exact policy/digest/appointment-bound external acceptance, changes requested, rejection and required human attestation | Implemented; full gate pending |
| 5 | Current adverse design concerns block acceptance; policy author cannot record independent external decisions | Implemented; full gate pending |
| 6 | Real scope-change events invalidate appointments after membership/setup/active-user changes; restoration alone cannot revive old authority | Implemented; full gate pending |
| 7 | Transactional scope-row locks, serialized versions/authority/decisions, exact receipt recovery and stale/conflicting retry handling | Implemented; full gate pending |
| 8 | Linked withdrawal/renewal/rejection history, superseded-policy handling and independently recomputed current acceptance | Implemented; full gate pending |
| 9 | Guided appointment/decision forms, frozen uncertain submissions, short/detailed audit, temporary-read recovery, denied-scope clearing and readiness context | Implemented; full gate pending |
| 10 | Real PostgreSQL/API, desktop/mobile E2E-JRN-06-010, coverage bindings, Docker proxy/retry/retained-volume proof and manual replay guide | Added; full gate pending |

Appointment grants only external-policy-decision recording in that estate, in addition to existing active estate-manager and customer setup access. Existing setup administrators may register a different eligible person against an external delegation reference; no ordinary manager is automatically an acceptance recorder. This is a narrow current application capability, not completion of F09–F17 production role administration or the separate future mapping-approver appointment. Appointments and attestations do not establish the external person's legal authority by themselves.

Underlying scope rows are locked through each write transaction. New proposal, design review, appointment and decision writes share the estate policy lock. Scope-change metadata records real changes after migration023, with actual actor/support reference when supplied and null when not known; it does not invent older grant history. Raw scope events remain unavailable to runtime callers. The scoped authority state exposes only the derived current marker/eligibility, not unrelated memberships or setup grants.

A current acceptance requires the latest recorded outcome to be accepted-externally, the same current appointment identity, unchanged underlying scope marker, the latest policy and no current adverse design observations. This is a metadata/current-state check, not a reusable write permit or source authenticity certificate. A later concern, policy revision, revocation, deactivation or scope change removes current acceptance without deleting its original event. Reappointment does not revive earlier acceptance: a new exact-bound decision is required. Revoking a reviewer does not erase their concern.

Exact retries recover the original receipt even after policy supersession or recording-appointment revocation if the caller still has base read scope; they do not reinstate authority or create another decision. Base scope revocation denies access. A superseded policy permits only withdrawal of previously recorded acceptance, not a new acceptance/rejection/changes decision. Withdrawal is a new event, never deletion. No number of design-support votes becomes sign-off, and no minimum vote count or production staffing rule is invented.

## Manual and visible journey

Use the working PERN/Docker branch with separately assigned synthetic development managers; production provisioning is not implied. Open Task capacity → Open legacy attribution review → Open source mapping preview → Mapping policy design review.

1. Save or inspect the exact policy criteria/version. In Policy authority and external decisions, search for the separate eligible recorder, select the person, provide the actual appointment reference/reason and record the appointment. Self appointment stays disabled/denied.
2. Sign in separately as that appointed person and inspect the same version. Check its digest, criteria, current design concerns and own appointment. Record the external outcome/reference/reason and explicit attestation. Acceptance requires resolution of all current adverse design reviews through their linked corrections; a positive statement alone does not cancel concerns.
3. Open detailed audit to inspect exact policy, appointment, actor, prior event and support references. Withdraw an acceptance through a separate referenced event, then record a renewed external decision when appropriate. Original business records remain unchanged.
4. As a setup manager, revoke/reappoint the recorder. Confirm earlier acceptance is retained but is no longer current. A new decision must reference the new appointment. Loss/restoration of underlying membership/setup/active-user access likewise requires renewed appointment and decision.
5. Refresh mapping readiness for a saved source check to see current external-policy-decision metadata. Mapping approval/application remain disabled and source authenticity remains unverified. Refresh governance after transient read failure; permission denial clears private history.

Watch the automated journey locally with `npm run test:e2e:headed -- --grep E2E-JRN-06-010`, or use `npm run test:e2e:ui -- --grep E2E-JRN-06-010` for interactive replay. The existing documented local synthetic database/Chrome setup is required. CI headless execution does not substitute for owner/client manual observation.

Next: actual owner/client acceptance and production authority/staffing/custody evidence, then exact-bound mapping requests and independent mapping decisions, transactional attribution overlays, compensation and original/adjusted reconciliation, volume/client-data/manual UAT and provisioning/inheritance. F06-MAPPING-DECISION-NEXT.md remains the broader next-flow queue; row1 now has this recording capability, while actual sign-off is still a separate human action. Its production mapping-approver grant and request/application rows are not delivered here. See ENGINEERING-CHECKPOINT.md for exact verified source/run once the full gate passes.
