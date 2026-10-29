# Typed-site core: verified engineering checkpoint

18 October 2026. Tested branch source: `9039e74a755e326074c2348c34f04e39657b8406`.
[GitHub Actions run 39127550259](https://github.com/kunal1274/ssjns-eoms/actions/runs/39127550259), attempt 1: verify and quality-gate succeeded.

| Check | Actual result |
| --- | --- |
| Unit / PostgreSQL API | 38 + 77 = 115 passed |
| Desktop/mobile journeys | All 36 executions passed |
| New E2E-JRN-02-014 | 4.0s desktop / 3.9s mobile |
| Existing E2E-JRN-02-013 | 10.6s desktop / 10.7s mobile |
| Assertion ledger | 172 passed / 40 untested viewport rows; 106 inventory items / 86 mappings / 20 gaps; not whole-product coverage |
| Upgrade / browser / PWA | Migration 016 legacy preservation, prior browser/workflow/offline/installability and ledger UI checks passed |
| Build / dependencies | Typecheck, formatting, build and dependency audit passed; zero known vulnerabilities |
| Docker | Container database/unit/API/upgrade checks, proxy/capture/idempotency and retained-volume persistence passed |

The core site-master implementation supports facility types, mandatory tenant/company, optional estate, stable identity, reasoned versioned name/availability changes, scoped search/pins, projected history and assigned-estate handoff. Linked-site reads require estate membership; writes also require explicit setup authority. Unlinked configuration is setup-admin-only. These masters do not implement downstream facility operations or create operational grants.

The new journey asserts required-field prevention, retained draft/search retry, concurrent edit rejection, committed-save/read-failure recovery without duplicate advancement, real history and persisted estate handoff. API/database tests cover tenant/authority boundaries, all types, code uniqueness, immutable scope, history protection, paging/cursor bindings and revoked access.

First candidate `3f3a05859742b59021c2b0fe19c9bbc7a16d7372` / run 39126396944 passed the new site cases but failed 17 existing viewport executions because new fixtures retained temporary customer authority and changed the default organization. Cleanup now revokes only fixture-added memberships/setup grants, preserving recorded rows. Header/responsibility bootstraps preserve explicit selections against late initial responses. No prior assertion or timeout was removed; the full replacement run above passed.

F06 remains In progress. Next: expand site UI acceptance for unlinked configuration, type/status filtering, longer history/navigation, revoked/forbidden setup and recovery, followed by remaining hierarchy/provisioning/attribution dependencies and manual acceptance. Broader security, permissions, business workflows and reusable visible-test work remain open. No merge or deployment occurred.

To replay locally after the existing host test setup: `npx playwright test jrn-02-sites --project=chrome-desktop --headed`, or select E2E-JRN-02-014 in `npm run test:e2e:ui`. The browser opens on the executing computer. Manual app path: local Docker app → Organization → Operational sites. The separate hosted prototype was not updated.

This note records public implementation/CI facts only. The expanded client-derived tracker/handoff upload was blocked by automatic approval review; those refreshed documents remain outside this commit. This documentation-only follow-up is not a new application test run.
