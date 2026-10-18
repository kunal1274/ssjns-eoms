# Check EOMS on your computer

## Which application contains the current work?

Checked 18 October 2026: `https://eoms-estate-operations-demo.devratxen.chatgpt.site/` is the separately hosted Estate Opera prototype. Sites reports latest saved version 8 with source `e0803a43c8e443c71819f9f69c154cd7c75baf3e`; its description identifies synthetic data/simulated integrations. That deployment is separate from this PostgreSQL/Docker repository. Recent GitHub branch changes do not automatically publish to that URL. The latest verified source/run is recorded in CURRENT-HANDOFF.md; do not use the prototype as evidence that these API/database changes are deployed.

Use the local Docker app below to inspect the current implementation. A shared hosted PERN staging environment remains a separate deployment task; production startup is gated. No hosting audience or live prototype is changed by these instructions.

## First-time manual app setup

Install Git, Node **24.x**, and Docker with Compose (Docker Desktop must be running on Windows/macOS). In Terminal or PowerShell, use a new working directory:

```sh
git clone --branch planning/production-roadmap-data-security --single-branch https://github.com/kunal1274/ssjns-eoms.git
cd ssjns-eoms
node --version
node scripts/setup-env.mjs
docker compose up --build -d --wait api web
docker compose --profile tools run --rm seed
```

Open **http://localhost:5174** on the same computer. Use `localhost` exactly to match the accepted Origin setting. The database is PostgreSQL in Docker; API/web use the same source/image. This first image build needs network access for dependencies/images.

Read your generated development login credentials in your own terminal:

```sh
docker compose --profile tools run --rm --no-deps seed cat .local/dev-accounts.json
```

Use the generated **manager@eoms.local** account for configuration. The supervisor account has narrower permissions; reviewer credentials support explicitly independent development review. Keep generated passwords and session data private. A Docker account-volume file is separate from host-run/test account files; a repeated seed preserves existing accounts rather than promising a new password file.

If you already cloned this branch, commit/stash your own changes as appropriate before updating. From that checkout:

```sh
git switch planning/production-roadmap-data-security
git pull --ff-only
node scripts/setup-env.mjs
docker compose up --build -d --wait api web
```

The environment generator preserves an existing `.env`. Rebuild is necessary: this Compose setup does not bind-mount source. `docker compose ps` shows container health. `docker compose logs --tail=80 api web` helps diagnose startup; remove private data before sharing logs. Do not delete volumes to update the app: they contain your local records.

## Manual checklist and expected results

Use synthetic demonstration data and unique codes, for example `MAN-D01`, `MAN-B01`, `MAN-T01`; change the suffix if a code already exists. Record observed results rather than treating a clicked button as a pass.

| Journey | Actions | Expected result |
| --- | --- | --- |
| Customer/company/group | Sign in as manager → Organization → Search Customer → Find Customer → choose it. Search/select Hierarchy company and Group assignment, enter Assignment reason, Save company group. | The intended company/group IDs remain selected. A reasoned event appears; expand View hierarchy change details for before/after references and support reference. Searching the same customer retains the current setup draft. |
| Field structure → task | Hierarchy setup: choose Hierarchy estate. Create a Division with code/name/reason, then a Block under it (Field is optional). In the header choose the same estate → Task capacity → Add task → search/select Configured block → enter Block link reason, task code/activity/round/capacity → Save changes. | Task shows Linked block. It keeps a stable block ID, separately from the recorded code. Legacy code creation is an explicit compatibility path, not a verified link. |
| Capture → confirm → audit | Same estate → Muster register → New muster → choose an open-period work date, find the task, enter a small available area, choose G-01 and a worker → Save draft → View → Confirm muster → Audit trail. | A persisted server draft becomes confirmed once, with retained task/block/worker/company attribution and audit details. Reload and inspect the same record. Seeded operational months are September/October 2026; add another period explicitly if required. |
| Operating placement | Organization → Operating placement. Create a region/business unit if required, using search for Area parent. Search Placement estate and Estate operating area, enter Placement reason, Save estate placement. | Initial placement applies to that estate without changing its legal company or membership. Existing placement history requires a move request/review instead. |
| Independent movement | Movement and area lifecycle: search Move estate and Move destination, enter Move reason, Request estate move. Sign out and sign in with the separately authorized reviewer; choose Move request, Move decision and Move review reason → Record move decision. | Requester cannot approve their own request. A valid independent approval changes placement and records both actors/references; historical work stays with the same estate. Root removal is an explicit destination when placement exists. |
| Dated responsibility | Estate responsibility: search Responsibility estate and Next responsible company, choose a future effective date and enter reason → Save responsibility change. View that date, inspect the detailed event, then capture a new draft on/after that date in an open period. | New work records the date-effective company; earlier work is not rewritten. Existing work on/after a proposed date blocks scheduling. The company must already be accessible in this customer. |
| Errors/conflicts | Leave a required field empty, try a duplicate code, or edit the same version in two browser contexts. | Validation prevents unsafe submission or returns understandable guidance/support reference. Draft inputs remain. For a conflict, refresh and explicitly reload the selected record before reviewing and resubmitting. Do not repeat a save after an acknowledged-write/refresh failure until refresh succeeds. |

Browser-test fixtures deliberately create hundreds of records to check old list limits. A fresh manual seed is smaller; it need not display 201 records to be working. Manual success is recorded separately from automated CI and does not close all client acceptance gaps.

## Watch Playwright run in front of you

This uses **host Node/Chrome**, with Docker providing local PostgreSQL. The test runner starts its own API/web at **http://localhost:5284** against isolated **eoms_test**; it does not test the hosted prototype or alter the manual app's `eoms` business records. Keep ports 4210/5284 free. Test scripts create synthetic records and use test account files.

From the same checkout and existing `.env` (after Docker/PostgreSQL is healthy):

```sh
npm ci
npx playwright install chrome
npm run db:test
npm run test:e2e:ui
```

In Playwright UI select **chrome-desktop**, choose a case such as **E2E-JRN-02-010** (customer/company/group), and press **Run**. Inspect named steps, field actions, assertions and results; rerun from that UI. For a normal visible app window executing one selected journey:

```sh
npx playwright test jrn-02-context-selectors --project=chrome-desktop --headed
```

Use `jrn-02-selectors` for hierarchy → task → capture, or `jrn-02-paged-placement` for the new placement/responsibility slice once verified. `npm run test:e2e:report` opens the latest runner report. After the complete suite, `npm run test:coverage` builds the field/action/journey ledger; partial runs keep unselected items non-green. Remote headless GitHub CI does not open a browser on your computer.

## Record your own manual interactions

With the Docker manual app running at http://localhost:5174:

```sh
npm run test:journeys:record
```

Playwright Codegen opens Chrome and its inspector, recording actions to ignored `.local/recorded-journey.spec.ts`. Recorded actions still need review, synthetic fixtures, assertions and cleanup/scope rules before becoming a regression test. Do not record real passwords or personal/client data. Raw recording is not automatically certified as tested. The project-aware, one-click recording/replay dashboard and a packaged kit validated on another project remain planned; the currently available Run button is Playwright UI's runner.
