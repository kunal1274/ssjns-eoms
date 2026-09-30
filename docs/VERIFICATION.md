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
