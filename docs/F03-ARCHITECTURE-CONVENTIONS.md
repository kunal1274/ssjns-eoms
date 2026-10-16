# F03 — Architecture Conventions and Decision Register

**Phase:** F03 — Architecture conventions  
**Status:** In progress; conventions below are the proposed technical baseline for owner review.  
**Started:** 16 October 2026, after F02 owner acceptance and CI pass  
**F02 acceptance:** [Owner acceptance record](F02-OWNER-ACCEPTANCE.md) · [verification run #38849671680](https://github.com/kunal1274/ssjns-eoms/actions/runs/38849671680)  
**Repository:** [kunal1274/ssjns-eoms](https://github.com/kunal1274/ssjns-eoms)

## Purpose and guardrails

F03 defines shared engineering rules for the existing PERN codebase before broad implementation. It is a modular-monolith convention set, not a proposal to split the product into microservices. F03 changes are documentation/architecture decisions only; implementation refactors belong in their assigned phases and must carry tests.

The accepted product defaults DEC-01–DEC-09 remain authoritative. This document proposes technical mechanisms for implementing them; it does not replace customer-specific configuration, signed commercial/payroll/integration decisions, or production acceptance.

## 1. Repository and module boundaries

Keep one shared repository and one deployable application boundary until an evidence-based decision justifies otherwise:

- `apps/web`: React + TypeScript + Vite PWA; presentation, interaction state and client-side usability validation.
- `apps/api`: Express + TypeScript HTTP boundary; authentication, request parsing, authorization orchestration and response mapping.
- `packages/domain`: deterministic business rules that can be tested without HTTP, PostgreSQL or browser state.
- `db/migrations`: versioned PostgreSQL schema, constraints, indexes, RLS policies and grants.
- `scripts`: explicit developer/CI/maintenance commands; scripts must state whether they mutate data.
- `tests`: domain/unit tests, PostgreSQL/API integration tests and browser end-to-end journeys.

Target dependency direction: web → API contract; API → application/use-case logic → domain and scoped persistence adapters. Domain logic must not import Express, React, PostgreSQL clients or environment variables. Keep route handlers thin and avoid circular dependencies. Existing code can be migrated incrementally; do not combine architectural refactors with unrelated business-rule changes.

## 2. Runtime, dependencies and configuration

- Align the Node runtime in `package.json`, README, CI and future Docker images. The current package engine and README state different minimum versions; resolve this before F04. Proposed baseline: a supported Node LTS version, pinned consistently in CI and containers.
- Use TypeScript strictness, ESM and the existing React/Express/PostgreSQL stack. Do not add a new framework or runtime dependency without recording its purpose, maintenance/security posture and alternative considered.
- Validate environment configuration once at startup with a schema. Missing required production settings must fail closed; never silently fall back to development credentials or permissive security settings.
- Keep secrets out of source, browser bundles, logs, test fixtures and committed environment files. Local development credentials must remain generated/ignored.
- Pin dependencies with the lockfile. CI must use a clean install and a documented audit policy; dependency exceptions need an owner, rationale and expiry/review date.

## 3. API contracts and request handling

- Keep the existing `/api` namespace while the current product is evolving. Document any breaking contract change and update the frontend client, integration tests and browser journeys together.
- Validate every untrusted path, query, header and JSON body at the API boundary using strict schemas (Zod is already present). Reject unknown fields for write operations unless the contract explicitly allows extension fields.
- Treat browser validation as usability only; repeat all required validation on the server and enforce critical invariants in PostgreSQL constraints as a separate layer.
- Use stable machine-readable error codes, safe human-readable messages and a correlation/request ID. Never expose SQL text, schema names, stack traces, constraint names, secrets or raw internal exception messages to clients.
- Map predictable outcomes consistently: malformed input, unauthenticated, unauthorized/out-of-scope, not found, conflict/stale version, rate limited, and unexpected internal failure. Preserve backward compatibility for existing clients while migrating the current flat error shape through explicit contract tests.
- Use bounded pagination and deterministic ordering for lists. Cap request/body size, export size and batch size. Avoid unbounded result sets.
- Represent dates explicitly: date-only business values as `YYYY-MM-DD`; timestamps as UTC ISO-8601. Do not convert date-only business values through a local timezone. Document units and precision for every numeric API field.

## 4. Identity, authorization and data scope

Evaluate every protected operation on the server in a fail-closed manner:

1. Validate the authenticated principal and session state.
2. Resolve the selected customer tenant from verified membership; never trust a tenant or estate ID merely because the client supplied it.
3. Evaluate the stable resource/action permission.
4. Evaluate explicit record/data scope and any required field-level restriction.
5. Evaluate module/feature entitlement separately from permission and scope.
6. Enforce workflow state, separation-of-duties and approval rules for the requested transition.
7. Re-check applicable constraints inside the write transaction to prevent time-of-check/time-of-use gaps.

A role label, hidden UI control, client-side route guard or successful prior read is not authorization. List, detail, search, export, report, attachment, offline sync, background job and integration paths must apply equivalent scope rules.

Customer tenant is the hard isolation boundary. Legal/financial hierarchy and plantation operating hierarchy remain separate and configurable. Scope inheritance is explicit and downward only; parent roll-up does not automatically grant access to child or sibling records. Missing or invalid security context denies access.

## 5. PostgreSQL, transactions and migrations

- Use the restricted application database role at runtime; never use the schema owner, superuser or a role with `BYPASSRLS`. Verify the complete role attribute set, including `CREATEDB` and `CREATEROLE`, rather than relying only on `NOSUPERUSER`.
- Use PostgreSQL constraints, composite tenant/scope-aware foreign keys, indexes and forced RLS as defense in depth. API authorization and RLS are separate mandatory controls, not alternatives.
- Tenant-owned reads and writes must execute inside an explicit transaction that establishes transaction-local actor/tenant/scope context. Use `SET LOCAL` or `set_config(..., true)`; never leave request context as a session-level pooled connection setting. Roll back on failure and always release the connection.
- Never run a tenant-owned query outside the scoped transaction helper unless a documented platform-level operation has a separate privileged access design and audit trail.
- Add regression tests for missing/invalid context, alternating actors, concurrent requests, rollback and reused pooled connections.
- Treat applied migrations as immutable. Add a new numbered migration for changes; use expand/backfill/validate/contract sequencing for risky production changes. Do not perform destructive data changes without a reviewed recovery/rollback plan.
- Use `NUMERIC` or integer fixed-scale representations for exact quantities and money. Do not use binary floating-point arithmetic for wages, payroll, money, rates or allocation totals. Specify UOM, precision, rounding mode and effective date in the domain rule.
- Keep transaction boundaries explicit. Do not make network calls to external systems while holding a database transaction open.

## 6. Business transactions, audit and outbox

- A high-value state transition must atomically persist the business change and its audit event. When an external event is required, write the outbox record in the same transaction.
- Use idempotency keys for retryable commands and stable payload identity. Reusing a key with a different payload must be rejected, not silently treated as a retry.
- Use optimistic version checks and row-level locking where concurrent edits or period/approval state require it. Conflicts must be visible and recoverable, not silently overwritten.
- Audit records identify actor, tenant/scope, action, target record, timestamp, correlation ID and reason where required. Store only the minimum necessary before/after detail; never record passwords, session/CSRF tokens, secrets or unnecessary sensitive payloads.
- Audit history must not be mutable by the normal application role. Read access is separately authorized and retention follows an approved policy.
- Outbox dispatch is asynchronous and idempotent, with bounded retry, explicit acknowledgement, failure visibility and reconciliation. No live ERP/payroll posting without signed system-of-record rules, versioned mappings and correction/reversal semantics.

## 7. Errors, logs and observability

- Use structured logs with a correlation/request ID and safe event categories. Log enough to diagnose a failure without dumping arbitrary request bodies or raw database/application error messages.
- Redact credentials, tokens, personal identifiers, wage/bank/payroll data and secrets by default. Add tests that assert sensitive values never appear in logs or API error responses.
- Distinguish liveness from readiness. Readiness may verify required dependencies; liveness should not trigger cascading restarts for a transient downstream issue.
- Implement graceful shutdown: stop accepting new work, finish/abort bounded in-flight work, then close database pools and background workers.
- Define metrics and alerts for API errors/latency, database pool saturation, failed outbox delivery, sync failures, auth denials and backup/restore jobs. Numeric SLO, retention, backup frequency, RPO and RTO remain owner/customer decisions; do not invent them.

## 8. Frontend and offline behavior

- Use React function components and hooks; keep UI state separate from authoritative domain state. Use typed API contracts and explicit loading, empty, error, conflict and permission-denied states.
- Do not store session bearer tokens or secrets in localStorage or IndexedDB. Session cookies remain HttpOnly; writes continue to use the approved CSRF/origin protections.
- The service worker may cache the static shell, not authenticated API responses. Offline drafts contain only the minimum required data and remain untrusted until the server revalidates identity, scope, workflow state and idempotency on sync.
- Account switching, logout, session expiry and scope revocation must not leak or submit another user's pending drafts. Local-storage encryption and cold-start offline identity remain explicit design/acceptance decisions rather than assumed guarantees.

## 9. Testing and change control

Every feature change must include the applicable layers:

- **Domain/unit:** deterministic rules, precision/rounding, invariants and edge cases without network/database dependencies.
- **Database/API integration:** real PostgreSQL migrations, constraints, RLS and restricted runtime role; positive and negative authorization cases.
- **Browser end-to-end:** critical persona journeys including errors, empty states, retry/conflict and persistence across reload.
- **Security regression:** tenant/estate/block boundaries, IDOR, privilege escalation, field disclosure, session/CSRF, pooled context leakage, audit access and entitlement bypass.
- **Concurrency/recovery:** duplicate submissions, lost responses, stale versions, locked periods, rollback and outbox reconciliation.
- **Migration/operations:** clean setup, upgrade path, health/readiness, backup/restore and rollback where the change affects operations.

Tests must use synthetic data and deterministic fixtures. Do not weaken or skip a failing security test to make a feature pass. CI should run clean install, migration/seed/DB checks, unit/integration tests, build, browser checks and dependency audit. Formal branch protection and required-check policy are assigned to F05.

## 10. Proposed decision register

| ID | Decision | Status / follow-up |
|---|---|---|
| ADR-F03-01 | Keep a modular monolith in the existing PERN repository; separate modules by dependency boundaries, not deployment units. | Proposed technical default; revisit only with measured operational or ownership need. |
| ADR-F03-02 | Keep tenant identity, business scope, permission and license entitlement as distinct authorization inputs. | Derived from accepted DEC-01/03/05; implementation remains in F06–F22. |
| ADR-F03-03 | Use strict Zod request schemas, centralized safe error mapping and correlation IDs. | Proposed; preserve current API compatibility with contract tests. |
| ADR-F03-04 | Use transaction-local actor/scope context, forced RLS and a restricted runtime role. | Required security convention; hardening/tests remain in F07/F11/F12. |
| ADR-F03-05 | Commit business state, audit and outbox intent atomically; dispatch integrations after commit. | Derived from accepted DEC-04/07; dispatcher and adapters remain future work. |
| ADR-F03-06 | Use exact fixed-scale arithmetic and effective-dated rules for payroll/financial calculations. | Derived from accepted DEC-06; customer examples and rates remain gated. |
| ADR-F03-07 | Use layered tests from pure domain to PostgreSQL/API and browser journeys. | Proposed; F05 formalizes required CI and branch protection. |
| ADR-F03-08 | Treat production identity, secrets, monitoring, backup/restore and numeric recovery targets as release gates. | Derived from accepted DEC-02/08; numeric values require owner/customer approval. |
| ADR-F03-09 | Resolve Node runtime-version mismatch before containerizing. | Open: package engine says Node >=22.13 while README requires Node 24+. Confirm and align in F04. |

## F03 acceptance checklist

- [x] F02 requirement/journey baseline accepted and verified by CI.
- [x] Existing repository structure and major security/data boundaries reviewed.
- [ ] Owner accepts or changes these technical conventions/ADRs.
- [ ] API error/logging policy and migration/versioning policy are reconciled with current code and tests.
- [ ] Runtime version is aligned across package metadata, README, CI and Docker image.
- [ ] Conventions are linked from the canonical progress tracker and roadmap.

F03 does not authorize production startup. After the technical conventions are accepted, close F03 and begin F04 Docker environment work.
