# Audit trails and user-friendly feedback

Owner addition: 16 October 2026. Applies to all accepted requirements and persona journeys in the F02 baseline. This adds cross-cutting acceptance criteria within the existing 25 phases; it does not declare unimplemented journeys complete.

## Three connected records

| View | Purpose | Required content | Access and safety |
|---|---|---|---|
| Short audit trail | Explain what happened at a glance | Plain-language action, actual actor, time with timezone, affected record, recorded outcome | Scope checked by server; no sensitive payload in summary |
| Detailed audit trail | Explain and investigate a recorded change | Event ID, record/link, reason, recorded version, request reference; authorized before/after values, workflow/correction links when captured | Explicit audit detail/field permissions; append-only evidence; no invented historical values |
| User feedback and diagnostic correlation | Help the user recover and support investigate | Severity, clear message, next action, valid support reference; protected diagnostic code/status | UI excludes stack, SQL, credentials and private payloads. Diagnostic access is separate from operational audit access |

An unsuccessful or denied request must not appear as a successful business change. Diagnostics can record a failed attempt without fabricating an audit mutation. A missing response does not prove a write failed: check current state/queue and use existing idempotency protections, never automatically repeat an unprotected mutation.

## Delivery matrix

| Item | Phase ownership | Status | Acceptance evidence / remaining work |
|---|---|---|---|
| Server-generated request reference and safe failure logs | F05 | Implemented; overall F05 blocked | Existing HTTP tests and CI evidence in F05 document; no raw exceptions, body, tokens or SQL |
| Readable short event summaries and expandable selected details | F05 continuation | Implemented, verification recorded in F05 document | Current estate audit window, keyboard-native disclosure, device timezone, no arbitrary payload dump; does not implement a new authorization boundary |
| Main UI recovery advice and support references | F05 continuation | Implemented, verification recorded in F05 document | Main API wrapper preserves safe 4xx messages, hides private 5xx bodies, explains conflicts/session/validation/rate limits and ambiguous connection failures |
| Device-sync recovery and support references | F05 continuation | Implemented; CI evidence recorded in F05 document | Safe server guidance for stopped/blocked submissions; pending payload/key retained, no raw storage/transport exception; browser verifies service-failure recovery |
| Permission-controlled summary/detail/export and sensitive-field masking | F09–F12 | Planned | Server permissions and scope enforcement on API and DB; deny unauthorized reads and cross-estate/customer access. Hiding fields in UI is insufficient |
| Audit role/permission publication, license and administrative changes | F17, F19–F22 | Planned | Record actor, effective version, reason and authorized changes; verify revocation and effective access after publication |
| Reusable workflow transitions and linked corrections | F23 | Planned | Capture change and audit atomically, immutable approval/reversal links, maker/checker, rejected/returned/reopened paths, configurable reason requirements |
| Task-oriented feedback across all screens | F24 | Planned | Required-field errors beside inputs, error summary/focus, success/info/warning/blocked states, next permitted action, permission and license explanations |
| Search, filtering, pagination and record navigation | F24 | Planned | Complete authorized history beyond latest 50; filter actor/action/date/record/outcome, explicit timezone; deep links checked by server; no misleading empty/loading/error state |
| Durable diagnostic delivery, retention, restricted support access | Security/operations follow-up; F25 release gate | Planned | Approved retention/access/export policy, monitoring and correlation, log-delivery failure handling; no invented retention duration or production readiness claim |
| Full journey and accessibility acceptance | F25 | Planned | Persona × permissions × scope × entitlement × state coverage, including mobile/keyboard/screen-reader, negative cases and no sensitive disclosure |

Current API limitation: all existing estate members can read the estate audit endpoint and its raw detail. Presentation filtering reduces what this component displays; it does **not** close the existing API authorization finding. Dedicated audit permissions and response-level field projection remain required in F09/F11/F12 before production acceptance.

## Journey alignment

Each row inherits the summary/detail, permissions, correlation and safe-feedback rules above. These are added acceptance checks, not claims that the whole journey is implemented.

| Journey | Audit evidence | Feedback and guided next action |
|---|---|---|
| JRN-01 Tenant provisioning | Customer creation and initial grant, isolated scope | Setup progress, duplicate/invalid setup guidance, initial-admin next step |
| JRN-02 Hierarchy setup | Effective parent/entity changes and version | Invalid parent/cycle guidance and current hierarchy navigation |
| JRN-03 User lifecycle | Invitation, activation, suspension and revocation | Delivery/activation state, recovery and session-expiry guidance |
| JRN-04 Role publishing | Draft/published version, permission/scope difference, rollback link | Preview effective access and explain forbidden grants before publication |
| JRN-05 Licensing | Seat/module assignment and effective/expiry changes | Capacity, entitlement, renewal and contract-driven grace explanations |
| JRN-06 Master maintenance | Create/update/deactivation and recorded versions | Saved record, duplicate/stale data/locked-period guidance |
| JRN-07 Work capture | One committed muster event per idempotent action | Draft versus submitted state, valid references, next permitted confirmation |
| JRN-08 Review/reversal | Confirmation, approval/reversal reason, version, linked record | Current state, conflict/self-approval denial, next permitted action |
| JRN-09 Correction | Original evidence and linked correction/resubmission | Returned reason, editable fields and correct review queue |
| JRN-10 Offline sync | Committed server event correlated to immutable submission | Device-only/pending/saved/blocked distinction and safe reconnect/review |
| JRN-11 Audit review | Scoped summary/detail and authorized export evidence | Search/filter, timezone, pagination, empty/failure distinction |
| JRN-12 Consolidated reporting | Report/export scope, parameters and source references | Loading/empty/no-access, reconciliation and permitted drill-down |
| JRN-13 Integration reconciliation | Dispatch attempts, receipt, retry and reconciliation links | Pending/acknowledged/failed status and authorized exception resolution |
| JRN-14 Task queues | Assignment and exception-resolution events | Current owner, deadline/state, blocking reason and next permitted task |
| JRN-15 Payroll/finance | Approved calculation/input version, posting and linked adjustment | Reconciliation errors, approval gates, posting acknowledgement and duplicate prevention |
| JRN-16 Field operations | Planning/operation/safety evidence at correct scope | Required evidence/PPE, overdue exceptions and permitted corrective actions |

## Feedback acceptance by journey state

| Trigger | User-facing behavior | Audit/diagnostic expectation |
|---|---|---|
| Successful create/update/submit/approve/reverse | Confirm completed action and identify saved record; show next permitted step | One committed event, actor/time/version/reason as relevant; idempotent replay adds no duplicate change |
| Invalid input | Explain fields to fix, retain safe entered values, focus error summary/field | Safe validation code and reference; no successful business event |
| Session expired / no access / feature unavailable | Explain sign-in or access/entitlement next step without revealing hidden records | Correlated denial, scoped responses; never infer unseen record existence |
| Concurrent update / closed period / duplicate | Explain current state and refresh/review action; avoid blind retry | No partial write; correct conflict and version evidence |
| Offline / pending sync / ambiguous response | Distinguish browser-only draft, pending, saved and blocked; explain reconnect/review; preserve immutable retry key | Server audit only on acknowledged/committed server write, recover without duplicate writes |
| Loading / no results / storage or service failure | Separate loading, empty and failure states; explain safe recovery; support reference where available | Safe diagnostics; no false success or fabricated history |

The first increment covers the main API wrapper and current audit component. Device-sync recovery now uses safe guidance/support references and sanitized storage/transport messages. Maintenance/gang local status messages, form focus/field-level validation, persistent notification history and all later journeys still need consistent adoption and acceptance under F24/F25. Existing messages remain, but are not counted as comprehensive coverage.

## Verification

`tests/user-feedback.test.tsx` verifies safe guidance/correlation, private 5xx body suppression, selected audit fields and empty state. `scripts/workflow-browser.mjs` verifies a failed sign-in recovery message, successful subsequent sign-in, completed work/reversal, expandable reversal evidence and mobile overflow. Existing API tests verify audit request correlation, scope, transaction and replay behavior. See F05 for actual CI status and tested commit; planned items above are not acceptance claims.

## Next sequence

1. Finish F05 repository enforcement: administrator applies prepared main protection; run the read-only policy check and record proof.
2. Proceed F06–F13 in order to establish customer hierarchy, identity, custom permission/scope engine and separation of duties. Add audit access regression cases with each layer.
3. Deliver role publication/licensing audit coverage in the corresponding phases, then F23/F24 shared workflow and feedback components.
4. Close F25 only with complete journey evidence and the remaining production security/operations gates satisfied.
