# Next governed mapping decision flow

24 October implementation candidate: the row1 external-decision recording capability and a narrow policy-recorder appointment are implemented in F06-POLICY-ACCEPTANCE.md, with full CI pending. Actual authoritative sign-off remains a human action; the row2 production mapping-decision grant and rows3–10 request/application/compensation/acceptance gates remain open. No planned flow is activated by design-support votes or ordinary manager access.

23 October 2026. Engineering preparation only, not an implemented endpoint or accepted production policy. Continue the full F01–F25 roadmap. The versioned policy design-review increment is separate from the future business authority described here. No production approver role, acceptance threshold or custody certification is inferred from a design statement.

## Delivery sequence and acceptance matrix

| Sequence | User action / system behavior to implement | Required proof before calling it complete |
| --- | --- | --- |
| 1 | Record authoritative acceptance or requested changes against an exact policy version, explicit authority reference and source/role/custody criteria | Actual actor and scope; exact immutable content/digest; no design vote promoted to sign-off; withdrawal/supersession lineage |
| 2 | Provision an explicit estate/customer mapping decision grant and staffing/conflict rules using accepted authority | No inferred manager/admin equivalence; revoked/inactive/delegated cases; future production role catalogue dependencies remain explicit |
| 3 | Prepare a decision request from a saved job and explicitly selected matching source check | Bind manifest digest, job/check IDs, policy version/digest, custody references, exact observation IDs/revisions and proposed row versions/targets |
| 4 | Show a guided pre-submission inspection, row findings and exact evidence selected | Explain every blocked row; record drift/current access; all current adverse observations counted even beyond displayed detail bounds; read-only inspection is not a permit |
| 5 | Persist an immutable submitted request and request audit with bounded row totals and an exact payload retry identity | One request on concurrent/unknown-result retries; actor/key/payload scoping; changed retry rejected; no business mutation |
| 6 | Independently return for correction, reject or approve against exact request/policy/evidence identities | Explicit conflict exclusions from accepted criteria; source uploader/preparer/relied-on reviewers cannot become approver by inference; reason and audit; no overwriting adverse evidence |
| 7 | Revalidate policy, grants, lifecycle, source/custody/observation identities and versions inside the application transaction | Concurrent record/policy/evidence/role changes reject safely; deterministic lock order and bounded atomic work; no stale readiness reuse |
| 8 | Apply only accepted work-company attribution overlays with immutable receipts | Original muster attribution, quantities, shares, state and audit unchanged; exact retry recovers one receipt; all-or-nothing batch totals; no payroll/finance dispatch |
| 9 | Present original versus adjusted reconciliation and a separate authorized compensating withdrawal/supersession | Preserve initial application and decision history; exact totals and receipt lineage; denied scope and recovery; no deletion/backfill masquerading as compensation |
| 10 | Verify connected positive/negative journeys and operational volume, client-data and persona/manual acceptance | Real PostgreSQL and API, desktop/mobile Playwright with stable IDs, Docker proxy/recreation/persistence, transactional failure/rollback and agreed volume evidence; human acceptance remains distinct |

These ten items are the next queue, not ten additional completed capabilities. Existing guarded exact-code task linking remains separate; no automatic task unlink/bulk rewrite enters this flow. High-volume staging and external-system compensation require accepted additional runbooks. Do not invent numerical retention/expiry, approver counts, timeout/SLO, payroll multipliers or financial tolerances.

## Guided states to make reviewable

The proposed request lifecycle is prepared → submitted → returned/rejected/approved → applied, with a separately linked compensation after application. Final state names and authority must be accepted before activation. Returned work produces a new linked submission; a rejected or applied request is never edited into a different history. Policy/evidence/version drift pauses progression and requires renewed review. A retry recovers the existing event/receipt rather than silently taking another decision.

Every screen needs an understandable current state, why the next action is blocked, a concrete recovery action, a short reasoned history and expandable actor/time/support-reference/identity detail. Authorization denial clears scoped private data. Temporary read failure removes the current report and permits refresh; uncertain writes retain exact frozen submissions for retry. Full process acceptance must include manual navigation by a person unfamiliar with the workflow, not only headless assertions.

Dependencies still open: authoritative policy/source-custody/role acceptance, production identity/provisioning and setup-grant inheritance, broader F07–F25 access/licensing/process delivery, client data and agreed volume/rollback acceptance. See ENGINEERING-CHECKPOINT.md for actual implementation and test evidence; no planned state above is a phase completion claim.
