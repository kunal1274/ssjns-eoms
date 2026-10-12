# Verification · first PERN slice

- RED: domain allocation stub failed; API stub failed 10 functional tests before implementation.
- GREEN: 2 domain tests + 11 PostgreSQL/API integration tests passed.
- Browser: local Chrome verified real login, create, confirmation, persisted reload, audit visibility, cross-estate 403 and logout; no page JavaScript errors.
- Desktop (1440×1000) and mobile (390×844) captures visually reviewed; register uses horizontal scrolling on narrow screens.
- TypeScript check and Vite build passed.
- Dependency audit reported zero known vulnerabilities after patched tooling was installed. This is not a penetration test or a production security certification.
- No million-record benchmark, disaster recovery exercise, external partner contract validation or production deployment was performed.

Tests cover equal area conservation, invalid allocations, authentication/CSRF, estate boundaries at API and database layers, idempotent create, foreign-estate workers, clerk write denial, simultaneous task-cap confirmation, stale version, locked periods, audit privilege restrictions and bounded cursor pagination.

The browser run uses synthetic development records; integration fixtures are isolated in `eoms_test`.

## Maintenance milestone

Four new integration scenarios were observed failing with missing routes, then passed after implementation. Current total: 2 domain tests + 15 API integration tests. Added coverage includes manager-only changes, duplicate identity, stale worker/task/period versions, confirmed-capacity lower bound, period closure enforcement/reopening, audited reasons and catalog pagination/search/estate isolation. Manager browser testing verifies worker creation/deactivation, task creation/capacity editing, period locking/reopening and searchable capture selectors. Build and existing muster browser regression are rerun for the delivery.

## Gang/review milestone

Three new workflow integration scenarios first failed against missing routes, then passed. Current total: 2 domain tests + 18 API integration tests. Coverage includes gang registration/assignment, foreign-estate supervisor rejection, supervisor revocation, stale versions, manager-only review, draft review rejection, reason validation, locked periods, simultaneous reversal (one success), unchanged historical allocations, one reversal event and released task capacity. Browser coverage creates a gang/task, captures work, confirms, approves, reverses and reloads the retained record.

Final checks for this milestone: all three browser scripts passed; desktop/mobile workflow screenshots reviewed; TypeScript/Vite build passed. Browser regression also caught and verified the fix for selected-estate persistence across reload. Only the selected estate identifier is stored in sessionStorage; access is revalidated against the server-provided estate list.

## PWA and milestone closeout

Three sync-domain scenarios were first observed failing against a stub, then passed. Current total: 5 domain/sync tests + 18 PostgreSQL/API tests (23). Four browser workflows cover capture, maintenance, gang/review, and offline/sync. Offline checks include static-only cache contents, disconnected save, reload retention, a lost response after server commit, immutable-key retry without duplicate creation, session expiry, account isolation, locked-period conflict, retry after correction, and sign-out discard/cancel handling.

The combined browser runner starts its own temporary servers, refuses occupied ports, and stops its child processes afterward. Chrome manifest and installability diagnostics passed using a temporary non-incognito profile; evidence is in pwa-installability.json. Desktop/mobile screenshots were visually reviewed. A new high-severity source-map-js dependency advisory was found during the refreshed audit and addressed with a targeted transitive update.

GitHub Actions configuration performs the same build/tests/browser/audit checks. Hosted CI status is recorded separately after pushing; local passing checks do not by themselves establish a hosted CI result.

Hosted CI initially timed out in offline verification because job-wide NODE_ENV=development compiled out service-worker registration. Reproduced locally by inspecting the development-mode bundle. Removed the job-wide override, added a build-time registration assertion, bounded service-worker readiness to 15 seconds and each browser script to 120 seconds. The corrected hosted result is tracked on the corresponding GitHub Actions run.
