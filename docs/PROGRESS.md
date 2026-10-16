# Estate Opera EOMS — Progress Tracker

**Last updated:** 16 October 2026  
**Repository:** [kunal1274/ssjns-eoms](https://github.com/kunal1274/ssjns-eoms)  
**Working branch:** `planning/production-roadmap-data-security`

This is the canonical top-level tracker and matches the 25 phases supplied by the project owner. Data-level security is explicitly included in F12 and is also a cross-cutting acceptance requirement for F02–F05 and all later modules.

## Status rules

- **Not started** — the phase has not entered implementation/acceptance.
- **In progress** — work has started, but the acceptance gate is not yet satisfied.
- **Blocked** — progress requires missing access, a dependency or an owner decision.
- **Ready for testing** — implementation is ready for acceptance verification.
- **Complete** — the acceptance criteria and evidence are recorded.

Existing code is evidence for an audit, but does not automatically mean a phase is complete. Each phase must be reviewed against its full scope and acceptance criteria.

## Progress

| ID | Workstream | Phase | Status | Current note |
|---|---|---|---|---|
| F01 | Foundation | Source code audit | **Complete** | Source/configuration/security review recorded and fresh CI run #3 passed dependency install, migrations, DB tests, 5 domain/sync tests, 18 integration tests, build, browser/PWA workflows and npm audit (0 vulnerabilities). Findings remain open for their assigned phases; production is still gated. See [F01 audit](AUDIT-F01.md). |
| F02 | Foundation | Requirements traceability | **Complete** | Owner accepted the 34 REQ-* acceptance statements and 16 JRN-* journey inventory as the planning/traceability baseline; [acceptance record](F02-OWNER-ACCEPTANCE.md). [CI run #38849671680](https://github.com/kunal1274/ssjns-eoms/actions/runs/38849671680) passed on the acceptance commit, including DB checks, unit/integration tests, build, browser verification and dependency audit. Implementation gaps and customer-specific/production gates remain open in their assigned phases. |
| F03 | Foundation | Architecture conventions | **Complete** | Owner accepted ADR-F03-01–09 on 16 October 2026; Node 24.x metadata/CI/image conventions aligned. API error/correlation/redaction deltas remain explicit F05/security implementation work. [Accepted baseline](F03-ARCHITECTURE-CONVENTIONS.md). |
| F04 | Foundation | Docker environment | **In progress** | PostgreSQL, migration, API/web and explicit seed/verify/smoke tooling implemented on the working branch. Local install/unit/build checks pass; real container execution and retained-volume restart CI remain pending. [F04 acceptance](F04-DOCKER-ENVIRONMENT.md). |
| F05 | Foundation | Automated quality checks | Not started | CI and test scripts exist; run #31 passed dependency install, DB checks, unit/integration tests, build, browser verification and dependency audit. F05 still requires a formal quality-gate/branch-protection review and acceptance. |
| F06 | Access control | Customer hierarchy | Not started | Current schema has companies and estates; customer/group/division/block hierarchy is incomplete. |
| F07 | Access control | Authentication and sessions | Not started | Basic local-development login/session/CSRF controls exist; production identity requirements remain open. |
| F08 | Access control | User lifecycle | Not started | Full invitation, recovery, provisioning, suspension and revocation lifecycle not accepted or complete. |
| F09 | Access control | Permission catalogue | Not started | Fixed role strings exist; a stable resource/action permission catalogue is not present. |
| F10 | Access control | Role data model | Not started | Current estate membership roles are manager/supervisor/clerk; extensible custom roles/scopes are not implemented. |
| F11 | Access control | Authorization engine | Not started | API role checks exist for current routes; centralized permission-based authorization is not implemented. |
| F12 | Access control | Record-level access | Not started | Estate-level RLS/membership checks exist for current tables. Division/block/record/field scopes and full security verification remain required. |
| F13 | Access control | Separation of duties | Not started | Current same-manager confirmation/review is explicitly provisional; configurable conflict rules and delegation are absent. |
| F14 | Role administration | Role templates | Not started | No accepted template catalogue. |
| F15 | Role administration | Custom role creation | Not started | No customer-admin custom role lifecycle. |
| F16 | Role administration | Permission editor | Not started | No permission matrix/editor. |
| F17 | Role administration | Publishing and audit | Not started | Existing operational audit is not a versioned role publication system. |
| F18 | Role administration | Role preview and testing | Not started | No role simulation/preview against API and data-scope rules. |
| F19 | Licensing | License model | Not started | Commercial plan/entitlement model not implemented. |
| F20 | Licensing | User seats | Not started | Named vs concurrent vs mixed seat model needs a decision. |
| F21 | Licensing | Entitlement enforcement | Not started | Server-side module/feature entitlement enforcement not implemented. |
| F22 | Licensing | Expiry and renewal | Not started | Contract-driven expiry, grace, renewal and suspension behavior not implemented. |
| F23 | User journeys | Workflow engine | Not started | Muster-specific state transitions exist; a reusable, configurable workflow engine is not implemented. |
| F24 | User journeys | Dashboards and task queues | Not started | Current UI is focused on a limited muster workflow; role-specific work queues remain. |
| F25 | User journeys | End-to-end journey test | Not started | Existing browser tests cover limited current journeys; the complete persona × permission × data-scope matrix is not covered. |

## F01 acceptance gate

F01 can be marked **Complete** only after all of these are evidenced:

- [x] Uploaded repository ZIP, application source, migrations, tests and project documentation inspected.
- [x] Existing implementation, documented boundaries and source-level security findings recorded in `AUDIT-F01.md`.
- [x] CI workflow reviewed and a fresh run completed on the working branch.
- [x] Clean dependency installation and TypeScript/build commands passed in CI.
- [x] PostgreSQL migrations, seed and integration/security tests passed against the restricted runtime role in CI.
- [x] Browser regression/PWA workflows and dependency audit passed in CI.
- [x] Audit findings and follow-up phases documented; F01 is closed as an audit, not as a claim of production readiness.

F01 closure does not imply that recorded security findings are fixed or that production readiness or exact hosted-demo/repository UI parity has been established.
