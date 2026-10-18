import type { Express } from "express";
import type { PoolClient } from "pg";
import type { EstateTx } from "./maintenance";
import { ApiError } from "./http";
import {
  reconciliationManifest,
  duplicateMappings,
  manifestDigest,
} from "../../../packages/domain/reconciliation";
async function access(c: PoolClient, estate: string) {
  return (
    await c.query(
      "SELECT e.customer_id,e.active,m.role='manager' AND eoms.can_manage_customer(e.customer_id) AS can_preview FROM eoms.estates e JOIN eoms.memberships m ON m.estate_id=e.id AND m.user_id=eoms.actor_id() WHERE e.id=$1",
      [estate],
    )
  ).rows[0];
}
export function reconciliationRoutes(app: Express, estateTx: EstateTx) {
  app.get("/api/estates/:estateId/reconciliation/context", async (req, res) => {
    res.json(
      await estateTx(req, res, false, async (c, id) => ({
        canPreview: (await access(c, id))?.can_preview === true,
      })),
    );
  });
  app.post(
    "/api/estates/:estateId/reconciliation/preview",
    async (req, res) => {
      const manifest = reconciliationManifest.parse(req.body),
        duplicates = duplicateMappings(manifest.rows);
      res.json(
        await estateTx(req, res, false, async (c, id) => {
          const context = await access(c, id);
          if (!context?.can_preview)
            throw new ApiError(
              403,
              "Estate-manager and customer setup permissions are required to preview mappings.",
            );
          const rows = [];
          for (const [index, row] of manifest.rows.entries()) {
            const issues: { code: string; message: string }[] = [];
            const issue = (code: string, message: string) =>
              issues.push({ code, message });
            if (duplicates[index].source)
              issue(
                "DUPLICATE_SOURCE_ROW",
                "This source-row reference occurs more than once. Reconcile every duplicate before review.",
              );
            if (duplicates[index].record)
              issue(
                "DUPLICATE_RECORD",
                "This record has multiple mapping rows. Reconcile all proposals; no row is chosen automatically.",
              );
            const current =
              (
                await c.query(
                  row.kind === "task-block"
                    ? "SELECT id,version,block_code AS recorded_code,task_code AS label,block_unit_id AS recorded_target FROM eoms.occurrences WHERE estate_id=$1 AND id=$2"
                    : "SELECT id,version,business_date::text AS label,legal_company_id AS recorded_target FROM eoms.musters WHERE estate_id=$1 AND id=$2",
                  [id, row.recordId],
                )
              ).rows[0] ?? null;
            if (!current)
              issue(
                "RECORD_UNAVAILABLE",
                "The record is not available in this estate scope.",
              );
            else {
              if (current.version !== row.recordVersion)
                issue(
                  "STALE_VERSION",
                  "The recorded version has changed. Refresh the source proposal and preview again.",
                );
              if (current.recorded_target)
                issue(
                  "ALREADY_RECORDED",
                  row.kind === "task-block"
                    ? "This task already has an immutable block link."
                    : "This work already has recorded company attribution.",
                );
            }
            const target =
              (
                await c.query(
                  row.kind === "task-block"
                    ? "SELECT id,code,name,kind,eoms.task_is_available(estate_id,id) AS available FROM eoms.operating_units WHERE estate_id=$1 AND id=$2"
                    : "SELECT id,name FROM eoms.companies WHERE customer_id=$1 AND id=$2",
                  [
                    row.kind === "task-block" ? id : context.customer_id,
                    row.targetId,
                  ],
                )
              ).rows[0] ?? null;
            if (!target)
              issue(
                "TARGET_UNAVAILABLE",
                "The proposed target is not available in the permitted scope.",
              );
            else if (row.kind === "task-block") {
              if (target.kind !== "block")
                issue(
                  "BLOCK_REQUIRED",
                  "The target must be a configured block in this estate.",
                );
              if (current && current.recorded_code !== target.code)
                issue(
                  "CODE_MISMATCH",
                  "The configured block must exactly match the task recorded code.",
                );
              if (!target.available)
                issue(
                  "INACTIVE_PATH",
                  "The estate, block and its parent path must be active before a task can be linked.",
                );
            }
            rows.push({
              ...row,
              current,
              target,
              issues,
              status: issues.length ? "blocked" : "review-required",
              action:
                row.kind === "work-company"
                  ? "Historical attribution remains unchanged. Source verification and a governed correction decision are required."
                  : "Review the exact block and reason through the existing task-link workflow; preview is not write authorization.",
            });
          }
          return {
            version: 1,
            estateId: id,
            actorId: res.locals.user.id,
            evaluatedAt: new Date().toISOString(),
            requestId: res.locals.requestId,
            source: manifest.source,
            sourceEvidenceVerified: false,
            manifestSha256: manifestDigest(manifest),
            applied: false,
            summary: {
              total: rows.length,
              blocked: rows.filter((r) => r.status === "blocked").length,
              reviewRequired: rows.filter((r) => r.status === "review-required")
                .length,
            },
            rows,
          };
        }),
      );
    },
  );
}
