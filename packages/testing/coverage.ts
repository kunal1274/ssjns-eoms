import { z } from "zod";
const caseId = z.string().regex(/^E2E-JRN-\d{2}-\d{3}$/);
const stepName = z.string().min(1).max(250);
export const inventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.string(),
    projects: z.array(z.string().min(1)).min(1),
    items: z.array(
      z.object({
        id: z.string().regex(/^COV-[A-Z0-9-]+$/),
        journey: z.string().regex(/^JRN-\d{2}$/),
        screen: z.string().min(1),
        category: z.enum([
          "field",
          "action",
          "form",
          "navigation",
          "audit",
          "journey",
        ]),
        control: z.string().min(1),
        assertion: z.string().min(1),
        binding: z.object({ caseId, step: stepName }).optional(),
      }),
    ),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.items.map((i) => i.id)).size !== value.items.length ||
      new Set(value.projects).size !== value.projects.length
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate inventory IDs/projects",
      });
    for (const item of value.items)
      if (
        item.binding &&
        !item.binding.caseId.startsWith("E2E-" + item.journey + "-")
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Journey/case mismatch",
        });
  });
export const runSchema = z
  .object({
    schemaVersion: z.literal(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sourceCommit: z.string(),
    runId: z.string(),
    environment: z.string(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
    status: z.enum(["running", "passed", "failed", "timedout", "interrupted"]),
    selected: z.array(z.object({ caseId, project: z.string() })),
    errors: z.number().int().nonnegative(),
    cases: z.array(
      z.object({
        caseId,
        project: z.string(),
        expectedStatus: z.string(),
        attempts: z
          .array(
            z.object({
              status: z.enum([
                "passed",
                "failed",
                "timedOut",
                "skipped",
                "interrupted",
              ]),
              assertionSteps: z.array(stepName),
            }),
          )
          .min(1),
      }),
    ),
  })
  .superRefine((value, context) => {
    const key = (c: { caseId: string; project: string }) =>
      c.project + ":" + c.caseId;
    const selected = new Set(value.selected.map(key));
    if (
      selected.size !== value.selected.length ||
      new Set(value.cases.map(key)).size !== value.cases.length ||
      value.cases.some((c) => !selected.has(key(c)))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate or unselected evidence",
      });
  });
export type Inventory = z.infer<typeof inventorySchema>;
export type RunEvidence = z.infer<typeof runSchema>;
export type CoverageStatus =
  | "untested"
  | "not-run"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "flaky"
  | "blocked"
  | "mapping-error"
  | "stale";
export function buildLedger(
  inventory: Inventory,
  run: RunEvidence | undefined,
  fingerprint: string,
) {
  const rows = inventory.items.flatMap((item) =>
    inventory.projects.map((project) => {
      let status: CoverageStatus = item.binding ? "not-run" : "untested";
      if (item.binding && run) {
        const selected = run.selected.some(
          (c) => c.caseId === item.binding!.caseId && c.project === project,
        );
        const result = run.cases.find(
          (c) => c.caseId === item.binding!.caseId && c.project === project,
        );
        if (run.status === "interrupted" && selected) status = "cancelled";
        else if (run.status === "running" && selected) status = "running";
        else if (result) {
          const last = result.attempts.at(-1)!;
          if (last.status === "skipped") status = "skipped";
          else if (last.status === "interrupted") status = "cancelled";
          else if (
            last.status !== "passed" ||
            result.expectedStatus !== "passed"
          )
            status = "failed";
          else if (result.attempts.some((a) => a.status !== "passed"))
            status = "flaky";
          else if (!last.assertionSteps.includes(item.binding.step))
            status = "mapping-error";
          else if (run.status !== "passed" || run.errors) status = "blocked";
          else status = "passed";
        }
      }
      const previousStatus = status;
      if (item.binding && run && run.fingerprint !== fingerprint)
        status = "stale";
      return { ...item, project, status, previousStatus };
    }),
  );
  const counts = Object.fromEntries(
    [...new Set(rows.map((r) => r.status))]
      .sort()
      .map((status) => [
        status,
        rows.filter((r) => r.status === status).length,
      ]),
  );
  return {
    schemaVersion: 1,
    scope: inventory.scope,
    fingerprint,
    run: run
      ? {
          sourceCommit: run.sourceCommit,
          runId: run.runId,
          environment: run.environment,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          errors: run.errors,
        }
      : null,
    counts,
    rows,
  };
}
export type Ledger = ReturnType<typeof buildLedger>;
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderLedger(ledger: Ledger) {
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EOMS assertion coverage ledger</title>
<style>body{font:15px system-ui;margin:24px;color:#213b31;background:#f7f9f6}h1{font-size:25px}p{max-width:1000px;line-height:1.5}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;border-bottom:1px solid #d9e1da;padding:10px;vertical-align:top;overflow-wrap:anywhere}th{background:#e9efe9}label{display:inline-block;margin:12px 18px 16px 0}select{padding:8px}strong{white-space:nowrap}.wrap{overflow:auto}.passed{color:#176437}.failed,.mapping-error{color:#9d2525}.stale,.blocked,.flaky{color:#74500b}small{display:block;color:#58685e}:focus-visible{outline:3px solid #a57317}</style>
<h1>Assertion coverage ledger</h1><p>${e(ledger.scope)}</p><p>Run: <b>${e(ledger.run?.status || "not run")}</b> · Source: ${e(ledger.run?.sourceCommit || "no executed evidence")} · Run ID: ${e(ledger.run?.runId || "—")} · ${e(ledger.run?.finishedAt || ledger.run?.startedAt || "")}</p>
<p>Counts are inventory items × viewport projects, not product coverage percentages. Passing evidence requires a completed assertion step and successful case/run. Failed means the mapped case failed, not necessarily that this individual control is defective. Stale rows retain their prior outcome. Legacy scripts and manual acceptance are separate evidence.</p>
<p>${Object.entries(ledger.counts)
    .map(([s, n]) => `${e(s)}: ${n}`)
    .join(" · ")}</p>
<label>Status <select id="status"><option value="">All statuses</option>${Object.keys(
    ledger.counts,
  )
    .map((s) => `<option>${e(s)}</option>`)
    .join(
      "",
    )}</select></label><label>Screen <select id="screen"><option value="">All screens</option>${[
    ...new Set(ledger.rows.map((r) => r.screen)),
  ]
    .sort()
    .map((s) => `<option>${e(s)}</option>`)
    .join("")}</select></label>
<p id="visible" role="status"></p><div class="wrap"><table><thead><tr><th scope="col">Item / scope</th><th scope="col">Control and required assertion</th><th scope="col">Status</th><th scope="col">Mapped evidence</th></tr></thead><tbody>${ledger.rows.map((r) => `<tr data-status="${e(r.status)}" data-screen="${e(r.screen)}"><td>${e(r.id)}<small>${e(r.journey)} · ${e(r.screen)} · ${e(r.category)} · ${e(r.project)}</small></td><td>${e(r.control)}<small>${e(r.assertion)}</small></td><td><strong class="${e(r.status)}">${e(r.status)}</strong>${r.status === "stale" ? `<small>Previous: ${e(r.previousStatus)}</small>` : ""}</td><td>${e(r.binding?.caseId || "No runner assertion mapped")}<small>${e(r.binding?.step || "Requires implementation/mapping; never inferred from clicks")}</small></td></tr>`).join("")}</tbody></table></div>
<script>const filters=['status','screen'].map(id=>document.getElementById(id));function filter(){let n=0;for(const row of document.querySelectorAll('tbody tr')){row.hidden=filters.some(f=>f.value&&row.dataset[f.id]!==f.value);if(!row.hidden)n++}document.getElementById('visible').textContent=n+' inventory/project rows shown'}filters.forEach(f=>f.addEventListener('change',filter));filter();</script></html>`;
}
