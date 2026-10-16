# F05 — Automated quality and repository acceptance gates

**Status:** Blocked on repository-admin protection enforcement. Implementation and CI verification passed; F05 is not Complete while main remains unprotected.

F03/F04 are accepted. This phase keeps the production startup block and historical database migrations unchanged. It does not implement customer hierarchy, OIDC/MFA, configurable business roles, licensing or complete field-level RLS; those remain in F06–F25.

## Required verification sequence

`Verify EOMS milestones` runs on pull requests, main pushes and merge-queue requests, using read-only repository permissions. Its `verify` job must pass:

1. Clean lockfile installation on Node 24.x.
2. `npm run format:check` for application/domain/scripts/tests, workflow/configuration, package metadata and Compose.
3. PostgreSQL migration, synthetic seed and isolated test-database setup.
4. Unit/domain/sync, HTTP error/disclosure and repository-policy regression tests; actual PostgreSQL/API integration tests; TypeScript/web/PWA build.
5. Existing browser/workflow/offline/installability regression checks.
6. Dependency audit at the high/critical threshold. Do not suppress a failure or introduce a permanent blanket exception. Any proposed temporary exception requires an owner, scoped advisory, rationale, expiry and explicit review before being encoded.
7. Actual Docker build/start/migrations/health, isolated tests/build, proxy/login/capture/idempotency and retained-volume recreation.

The stable final job is **`quality-gate`**. It runs with `if: always()` and succeeds only if `verify` is `success`; failure, cancellation and skipped prerequisites fail the gate. Unit tests execute the actual shell condition from the workflow against those outcomes. No step uses `continue-on-error` to hide verification failure.

This workflow is not yet an enforced merge gate while main remains unprotected. A green check alone does not prevent a direct push or merge. The required repository settings below are part of F05 acceptance.

## Safe error and logging contract

All application-handled API errors return additive JSON fields:

```json
{"error":"Safe human-readable message","code":"CONFLICT","requestId":"server-generated-UUID"}
```

The existing `error` string and expected business status codes remain for clients. Added `code` and `requestId` support deterministic handling and support correlation. `X-Request-ID` matches the body; successful API responses also carry a fresh server ID. Inbound correlation headers are not trusted or reused. API responses remain `Cache-Control: no-store`, including malformed/oversized JSON.

`apps/api/src/http.ts` centralizes status/code classification. Origin/CSRF/auth, validation, rate-limit, missing route/reference, duplicate/conflict, permission, database availability and internal failures share the same contract. Zod validation uses a bounded generic message so arbitrary keys/enum values are not reflected. Trusted business `ApiError` messages are public by design; callers must never wrap raw exceptions, SQL or sensitive inputs in a public business message. Internal/availability errors remain generic even if an ApiError was constructed with private detail.

HTTP failure logs contain only event category, server request ID, status, allowlisted error code and normalized method. They exclude raw exceptions/stack, database metadata, bodies, headers/cookies/tokens, query strings, paths, user names and wage/bank/employee values. Logger failure does not cause an unsafe response. Failures after response headers destroy the response rather than passing the raw exception to Express's default logger. These are application HTTP failure-log guarantees, not a claim of durable centralized log delivery or redaction of all privileged database/tooling logs.

Operational audit events retain the originating request ID in transactionally committed detail. An idempotent replay keeps the original business/audit event and receives a new HTTP request ID. No new migration or mutable audit privilege is introduced.

### Evidence scope

- `tests/http-errors.test.ts`: server IDs, success/failure correlation, forged headers, malformed/oversized JSON, generic validation, database/internal non-disclosure, Origin/auth/CSRF/404/rate-limit contracts and logger failure.
- `tests/api.test.ts`: persisted audit/request correlation plus idempotent replay and existing database/authorization/concurrency coverage using the restricted runtime role.
- `tests/repository-gates.test.ts`: actual aggregate shell success/failure/cancel/skip behavior and fail-closed policy inspection.
- Existing database and browser journeys must still pass. Full customer/block/field isolation, runtime role-drift remediation and a dedicated audit-read permission remain assigned to security phases; this error-contract change does not certify them.

## Immutable image and dependency promotion

Node and PostgreSQL base images are now pinned to immutable digests. Their provenance is the successful F04 execution [run 38891371564](https://github.com/kunal1274/ssjns-eoms/actions/runs/38891371564), tested on 16 October 2026. Node's Dockerfile identity and PostgreSQL's Compose/CI identity are explicit; tests check the digest requirement and PostgreSQL consistency.

Updating the runtime line, image digest or dependency lockfile requires a reviewed PR and the complete gate. Do not update a mutable tag behind a published release. Node remains the accepted 24.x line and PostgreSQL remains 18. Pinning is reproducibility, not a vulnerability scan: OS-image CVE review, signed release provenance, production artifact promotion, rollback and deployment approvals remain release-readiness obligations before production use.

## Repository administration — remaining external gate

Observed on 16 October 2026: GitHub's main branch metadata reports `protected: false`. The connected GitHub capability can write source and PR metadata but does not expose repository administration mutation. No protection setting has been changed by this phase.

The exact proposed payload is `.github/branch-protection.main.json`:

- Require `quality-gate` and an up-to-date branch.
- Require a PR and at least one independent approving review; dismiss stale approval and require approval of the last push.
- Enforce the rules for administrators, require resolved discussions and linear history.
- Disable force pushes and branch deletion.

An authorized repository administrator can apply the prepared payload from the same checkout, using an already authorized GitHub CLI session:

```sh
gh api --method PUT repos/kunal1274/ssjns-eoms/branches/main/protection --input .github/branch-protection.main.json
```

Alternatively, configure the same settings in GitHub → repository Settings → Branches → main. Designate an independent reviewer rather than assuming the author can approve their own changes. This is repository change control, separate from EOMS application roles/licensing.

`npm run check:repository-gates` is a **read-only** verification command. It needs `GITHUB_TOKEN` supplied securely with repository Administration read access. It exits nonzero when settings are missing, weaker than required, inaccessible or unverifiable, without printing the token or raw API response. Do not commit that token or include it in logs. Record the actual returned policy evidence before closing this gate. If organization rulesets are adopted instead, verify their effective equivalent controls explicitly rather than treating the existence of a ruleset as proof.

## Acceptance checklist

- [x] Current F04 closeout source and passing CI reconciled.
- [x] Backward-compatible safe error codes and server correlation contract implemented.
- [x] Disclosure/JSON/origin/auth/CSRF/rate-limit/logger tests added; the CI integration suite includes the real-PostgreSQL audit correlation assertion.
- [x] Formatting check, immutable image references and stable fail-closed aggregate job implemented.
- [x] Local 20 unit/security/configuration tests, formatting and TypeScript/web/PWA build passed.
- [x] [CI run 38892916203](https://github.com/kunal1274/ssjns-eoms/actions/runs/38892916203) passed all PostgreSQL/browser/Docker stages and the aggregate quality-gate on source commit `26b500041178f212edc0e6d108d931a603debc3a`.
- [ ] An authorized administrator enables and independently verifies the prepared main protection/review policy.

Keep F05 open while either unchecked condition remains. Do not merge the draft PR or begin F06 as though F05 were accepted. Production release remains gated regardless of F05's eventual closure.


## Executed evidence — 16 October 2026

The exact source commit above passed twenty unit/security/configuration tests and eighteen PostgreSQL/API tests, both through the host CI harness and the isolated Docker verification path. The PostgreSQL test asserts that the first creation audit retains its HTTP request ID while an idempotent replay produces no duplicate event and receives a new request ID. Formatting, TypeScript/web/PWA build, browser/offline/installability regressions, dependency audit (zero known vulnerabilities in this run), pinned-image startup, proxy/login/capture/replay and retained-volume recreation also passed. The separate `quality-gate` job completed successfully.

The remaining condition is actual protection enforcement on main, rechecked as `protected: false` after this run. Neither the passing gate nor this documentation activates repository settings. Keep F05 Blocked and F06 Not started until an administrator applies and verifies the prepared policy. This documentation-only evidence update does not claim that a later source revision was the commit tested in the referenced run.

## Owner-requested audit and feedback continuation

The [cross-phase matrix](AUDIT-AND-USER-FEEDBACK.md) records short/detailed audit and user-facing error/info requirements. This increment adds an allowlisted audit presentation with expandable recorded metadata and main API error recovery/support references. It deliberately does not claim to fix the existing raw-audit API authorization finding. Local verification: 23 unit/security/configuration/presentation tests and TypeScript/web/PWA build passed. Full CI evidence is recorded below when verified. Overall F05 remains blocked by repository enforcement.


### Verified continuation

[CI run 38918867500](https://github.com/kunal1274/ssjns-eoms/actions/runs/38918867500) passed on source commit `712c587ade8edd56dcffb62a23d43e5945d77eb3`: 23 unit/security/configuration/presentation tests plus 18 real PostgreSQL/API tests (41 unique tests), formatting, TypeScript/web/PWA build, browser recovery/audit/workflow/offline/installability checks, dependency audit, actual Docker startup and container verification, proxy/idempotency and retained-volume recreation. Both `verify` and `quality-gate` succeeded. The earlier run on `53f8977` caught an obsolete browser assertion expecting the now-collapsed event type; the corrected test opens the details and verifies both the readable summary and original event type.

This later documentation-only evidence commit does not change the tested application source. The main branch was still unprotected during this continuation. F05 remains Blocked and F06 remains Not started.


## Device-sync feedback continuation

Sync failures now preserve safe server guidance and valid request references. Pending drafts retain the original payload/idempotency key; blocked conflicts retain recovery guidance for review. Session expiry is distinguished from service failure. Storage/transport/queue-refresh exceptions are replaced with safe recovery messages, and discard/retry errors are handled. Local verification passed 25 unit/security/configuration/presentation tests, TypeScript/web/PWA build and formatting. Fresh full CI evidence follows after verification. This is a continuation of F05 feedback work; the external branch-policy gate and F06 status are unchanged.


### Verified device-sync continuation

[CI run 38925295750](https://github.com/kunal1274/ssjns-eoms/actions/runs/38925295750) passed on `d3b61c3bc9e9ff4ab4085d7d40ccaf062352c36d`: 25 unit/security/configuration/presentation tests plus 18 real PostgreSQL/API tests (43 unique tests), formatting, TypeScript/web/PWA build, browser/workflow/offline/installability checks, dependency audit, actual Docker build/start/container verification and proxy/idempotency/persistence. Both verify and quality-gate succeeded. The PWA browser check now injects a 503 with a private error body and valid support reference, verifies safe display and unchanged pending draft/key, then verifies lost-response recovery without duplicate server creation. Session expiry, retained locked-period guidance, retry, account isolation and logout remain covered.

This follow-up evidence edit is documentation-only. F05 remains Blocked by main protection; F06 has not started.


## Latest ruleset and test-plan review

At the latest 16 October 2026 review, main reports protected. Active ruleset 25257228 now includes `~DEFAULT_BRANCH`, no exclusions/bypass actors, and deletion/non-fast-forward restrictions. It still lacks required PR/reviews, required quality-gate/up-to-date status checks, conversation resolution and linear history. Protection existence is partial progress, not completion of the accepted policy. F05 remains Blocked. The connected GitHub tools can read this ruleset but cannot administer it.

The owner-requested [Playwright journey/regression plan](PLAYWRIGHT-JOURNEY-TEST-PLAN.md) records the next test infrastructure increment and full F25 coverage obligations. This documentation-only update does not change the previously tested application source or install the proposed runner.


## Visible Playwright replay continuation

Shared browser launch settings now support visible Chrome with bounded action delay while preserving headless defaults. A local wrapper runs the existing browser suite visibly; a codegen command records ignored manual-test drafts for later runner/assertion review. Unit checks cover launch defaults and invalid delay settings. Local unit/build checks passed; CI evidence is recorded after execution. Local desktop observation is still required for headed-mode acceptance. The one-click workbench and reusable cross-project kit are planned separately, not claimed as implemented.


### Verified visible-launch infrastructure

[CI run 38945388469](https://github.com/kunal1274/ssjns-eoms/actions/runs/38945388469) passed on `712da585601306a77f9e4de472da12bcdf708e4d`: 27 unit/security/configuration/presentation/launch-policy tests plus 18 PostgreSQL/API tests (45 unique tests), formatting, TypeScript/web/PWA build, all existing browser/PWA/installability checks, dependency audit and actual Docker build/start/container/proxy/idempotency/persistence verification. Verify and quality-gate both succeeded. CI used headless defaults; launch-policy tests verify the headed options, but the visible desktop experience and interactive recording have not been observed here. The recorder CLI syntax was checked against installed Playwright help. The later evidence commit changes documentation only.


## Interactive test runner continuation

Matched Playwright Test dependency/config, reusable isolated eoms_test fixtures/page object, one named capture/confirm/audit/logout scenario in desktop/mobile viewport projects, HTML/JUnit reports and UI/headed/headless/report commands now exist. CI adds runner execution while retaining every legacy script. Trace/video capture is off; no automatic artifact upload is introduced. Local TypeScript checks, scenario discovery and formatting passed. Record actual full CI execution below; local interactive observation and full journey coverage remain separate. [Quickstart](PLAYWRIGHT-WORKBENCH-QUICKSTART.md).


### Verified interactive-runner infrastructure

[CI run 38946761298](https://github.com/kunal1274/ssjns-eoms/actions/runs/38946761298) passed on `179aae4dde45d834e28cf8644fc48187b11b12e0`: 27 unit/configuration/security/presentation/launch tests and 18 PostgreSQL/API tests, plus both E2E-JRN-07-001 runner projects (desktop 1.9s, mobile viewport 1.8s). Existing browser/PWA/installability checks, formatting, build, dependency audit (zero known vulnerabilities), actual Docker/container/proxy/idempotency/persistence and final quality-gate passed. Local runner discovery listed both cases and config/types passed. Headless execution does not certify manual UI-mode observation. The evidence follow-up changes documentation only; F05 policy gate and F06 status remain unchanged.
