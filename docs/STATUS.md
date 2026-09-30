# Implementation checkpoint · 2026-09-29

Approved direction: PERN, web first/PWA next, React Native later, millions of operational records, shared PostgreSQL with strict isolation subject to client approval. Approved demo remains a separate project.

Completed first slice: isolated development/test databases; migrations and seed tooling; restricted runtime/RLS; local password sessions and scoped roles; React muster creation/detail/confirmation; integer area allocation; task-cap concurrency control; closed-period checks; atomic audit and outbox; bounded register pagination; local Git handoff.

Next sequence:
1. Confirm acceptance rules: occurrence/round definition, gang restrictions, role/approval matrix and operational calendars. Searchable reference APIs and worker/task/period maintenance are now implemented; validate them with the client before expanding the approval matrix.
2. Extend one activity at a time into field capture, allocation, approvals/reversals and payroll inputs, preserving transaction boundaries and traceability to the scope.
3. Add installable PWA and offline capture with stable request identities, replay/conflict policies and device/logout data protection. Test offline/reconnect and concurrent edits.
4. Add partner adapters once SAP/HR ownership/contracts are supplied. Test against stubs and contract fixtures, then partner sandbox. Add outbox worker, retries, dead-letter handling and reconciliation before live posting.
5. Benchmark representative million-record datasets, measure concurrent read/write latency, examine query plans, tune indexes and reporting strategy. Choose partitioning/replicas only from measured need. Retention/concurrency/SLOs still unknown.
6. Production readiness: SSO/MFA, secrets manager, TLS, distributed throttling/session lifecycle, tenant penetration tests, observability, backup/restore drill, migration rollback/roll-forward procedure, CI/CD, disaster recovery, UAT and approved hosting.

Unknown dependencies: hosting, identity provider, partner products/contracts, payroll owner/rules, retention, concurrency and service objectives. These do not block continued local implementation but do block claims of production readiness.

Completed maintenance milestone: manager-only worker creation/name/status updates, task occurrence creation/capacity updates, reasoned period creation/lock/reopen, version conflicts, audit events and searchable cursor catalogs integrated into muster capture. Remote is connected to kunal1274/ssjns-eoms.

Gang/review milestone: registered gang master, supervisor assignments with versioned audit, capture/confirmation authorization, separate manager review, terminal reasoned reversal with conserved historical evidence and atomic events. Provisional manager-only approval/reversal selected for development; client sign-off remains open. Current estate read scope is unchanged. Effective dates, gang worker rosters, borrowing, block authorization, multi-stage separation of duties and formal correction/replacement lineage are not complete.
