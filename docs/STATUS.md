# Implementation checkpoint · 2026-09-29

Approved direction: PERN, web first/PWA next, React Native later, millions of operational records, shared PostgreSQL with strict isolation subject to client approval. Approved demo remains a separate project.

Completed first slice: isolated development/test databases; migrations and seed tooling; restricted runtime/RLS; local password sessions and scoped roles; React muster creation/detail/confirmation; integer area allocation; task-cap concurrency control; closed-period checks; atomic audit and outbox; bounded register pagination; local Git handoff.

Next sequence:
1. Confirm Git remote and acceptance rules: occurrence/round definition, gang restrictions, role/approval matrix and operational calendars. Add searchable reference APIs and administrative maintenance flows with failing tests first.
2. Extend one activity at a time into field capture, allocation, approvals/reversals and payroll inputs, preserving transaction boundaries and traceability to the scope.
3. Add installable PWA and offline capture with stable request identities, replay/conflict policies and device/logout data protection. Test offline/reconnect and concurrent edits.
4. Add partner adapters once SAP/HR ownership/contracts are supplied. Test against stubs and contract fixtures, then partner sandbox. Add outbox worker, retries, dead-letter handling and reconciliation before live posting.
5. Benchmark representative million-record datasets, measure concurrent read/write latency, examine query plans, tune indexes and reporting strategy. Choose partitioning/replicas only from measured need. Retention/concurrency/SLOs still unknown.
6. Production readiness: SSO/MFA, secrets manager, TLS, distributed throttling/session lifecycle, tenant penetration tests, observability, backup/restore drill, migration rollback/roll-forward procedure, CI/CD, disaster recovery, UAT and approved hosting.

Unknown dependencies: Git URL/provider, hosting, identity provider, partner products/contracts, payroll owner/rules, retention, concurrency and service objectives. These do not block continued local implementation but do block claims of production readiness.
