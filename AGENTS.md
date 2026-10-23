# EOMS project continuity

Before changing this project, read `docs/CURRENT-HANDOFF.md` and `docs/PROGRESS.md`. Use the accepted F01–F25 roadmap, requirement/journey crosswalk and audit/feedback/Playwright plans as the continuing delivery scope. Do not replace the full EOMS goal with the test-workbench subproject.

Work on the existing working branch/draft PR unless the owner directs otherwise. Recheck actual repository state and external gates before closing a phase. Keep planned/partial/implemented/verified statuses distinct; never fabricate test passes, business history or permission coverage.

For each meaningful increment, record changed behavior, actual tested source/CI evidence, remaining gaps and the next concrete action in the tracker/handoff. Keep Playwright journey IDs stable and include error/recovery, scoped authorization and audit evidence alongside UI actions. Existing regression checks stay active until equivalent replacement evidence exists.

The owner wants reusable visible testing, manual recording/review, one-click replay and field/action/form/navigation coverage across projects. These are a workstream inside the full delivery plan. Production identity, access control, full process flows and client acceptance remain required.

Owner update, 17 October 2026: the user explicitly instructed continuing with the existing ruleset. F05 is closed for development sequencing with the exception recorded in docs/F05-OWNER-EXCEPTION.md; F06 is in progress. Do not re-block ordinary development or re-request the same permission for deferred repository administration. Keep the policy risk visible for release readiness; no automatic merge/deploy is authorized.

Read docs/ENGINEERING-CHECKPOINT.md for the latest compact technical source/run evidence and next action. It supplements the roadmap and full tracker, and helps interpret older pending-status notes. Verified increments do not imply phase, manual/persona, production or whole-product acceptance.

Owner update, 23 October 2026: proceed autonomously through at least ten meaningful connected delivery steps in an active run, continuing after each task without repeated permission requests. Keep a concrete status matrix and test evidence; do not count planned or unverified capabilities as completed. This instruction does not authorize merge/deploy, fabricate client acceptance, or remove existing regression checks.
