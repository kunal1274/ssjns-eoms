# EOMS project continuity

Before changing this project, read `docs/CURRENT-HANDOFF.md` and `docs/PROGRESS.md`. Use the accepted F01–F25 roadmap, requirement/journey crosswalk and audit/feedback/Playwright plans as the continuing delivery scope. Do not replace the full EOMS goal with the test-workbench subproject.

Work on the existing working branch/draft PR unless the owner directs otherwise. Recheck actual repository state and external gates before closing a phase. Keep planned/partial/implemented/verified statuses distinct; never fabricate test passes, business history or permission coverage.

For each meaningful increment, record changed behavior, actual tested source/CI evidence, remaining gaps and the next concrete action in the tracker/handoff. Keep Playwright journey IDs stable and include error/recovery, scoped authorization and audit evidence alongside UI actions. Existing regression checks stay active until equivalent replacement evidence exists.

The owner wants reusable visible testing, manual recording/review, one-click replay and field/action/form/navigation coverage across projects. These are a workstream inside the full delivery plan. Production identity, access control, full process flows and client acceptance remain required.
