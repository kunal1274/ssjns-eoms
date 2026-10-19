import { sourceEvidenceInput } from "../../../packages/domain/source-evidence";
import { z } from "zod";
import { pageFields, readPage, pageResult } from "./navigation-page";
import type { Express } from "express";
import type { PoolClient } from "pg";
import type { EstateTx } from "./maintenance";
import { ApiError } from "./http";
import {
  type ReconciliationManifest,
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
async function evaluate(
  c: PoolClient,
  id: string,
  manifest: ReconciliationManifest,
  actorId: string,
  requestId: string,
) {
  const duplicates = duplicateMappings(manifest.rows);
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
          [row.kind === "task-block" ? id : context.customer_id, row.targetId],
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
    actorId: actorId,
    evaluatedAt: new Date().toISOString(),
    requestId: requestId,
    source: manifest.source,
    sourceEvidenceVerified: false,
    manifestSha256: manifestDigest(manifest),
    applied: false,
    summary: {
      total: rows.length,
      blocked: rows.filter((r) => r.status === "blocked").length,
      reviewRequired: rows.filter((r) => r.status === "review-required").length,
    },
    rows,
  };
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
      const manifest = reconciliationManifest.parse(req.body);
      res.json(
        await estateTx(req, res, false, async (c, id) => {
          return evaluate(
            c,
            id,
            manifest,
            res.locals.user.id,
            res.locals.requestId,
          );
        }),
      );
    },
  );
  const jobs = "/api/estates/:estateId/reconciliation/jobs";
  async function requireAccess(c: PoolClient, id: string) {
    if (!(await access(c, id))?.can_preview)
      throw new ApiError(
        403,
        "Estate-manager and customer setup permissions are required to review saved mappings.",
      );
  }
  app.post(jobs, async (req, res) => {
    const input = z
      .object({
        key: z
          .string()
          .uuid()
          .transform((v) => v.toLowerCase()),
        reason: z.string().trim().min(3).max(500),
        manifest: reconciliationManifest,
      })
      .strict()
      .parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await requireAccess(c, id);
        const actor = res.locals.user.id,
          digest = manifestDigest(input.manifest);
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,618))",
          [id.toLowerCase() + actor + input.key],
        );
        const previous = (
          await c.query(
            "SELECT * FROM eoms.reconciliation_jobs WHERE estate_id=$1 AND created_by=$2 AND retry_key=$3",
            [id, actor, input.key],
          )
        ).rows[0];
        if (previous) {
          if (
            previous.manifest_sha256 !== digest ||
            previous.reason !== input.reason
          )
            throw new ApiError(
              409,
              "This save reference was already used for different content. Start a new review save.",
            );
          return { job: previous, replayed: true };
        }
        const snapshot = await evaluate(
          c,
          id,
          input.manifest,
          actor,
          res.locals.requestId,
        );
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        const job = (
          await c.query(
            "INSERT INTO eoms.reconciliation_jobs(estate_id,created_by,retry_key,reason,manifest,manifest_sha256,snapshot,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
            [
              id,
              actor,
              input.key,
              input.reason,
              JSON.stringify(input.manifest),
              digest,
              JSON.stringify(snapshot),
              res.locals.requestId,
            ],
          )
        ).rows[0];
        return { job, replayed: false };
      }),
    );
  });
  app.get(jobs, async (req, res) => {
    const query = z
      .object({ limit: pageFields.limit, cursor: pageFields.cursor })
      .strict()
      .parse(req.query);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await requireAccess(c, id);
        const binding = {
            kind: "reconciliation-jobs",
            estate: id,
            actor: res.locals.user.id,
            limit: query.limit,
          },
          page = readPage(query.cursor, binding);
        const rows = (
          await c.query(
            "SELECT id,created_by,reason,created_at,manifest_sha256,snapshot->'summary' AS summary,manifest->'source' AS source FROM eoms.reconciliation_jobs WHERE estate_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
            [id, page?.key ?? null, query.limit + 1],
          )
        ).rows;
        return pageResult(rows, query.limit, binding, (r) => r.id);
      }),
    );
  });
  app.get(jobs + "/:jobId", async (req, res) => {
    const jobId = z.string().uuid().parse(req.params.jobId);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await requireAccess(c, id);
        const job = (
          await c.query(
            "SELECT * FROM eoms.reconciliation_jobs WHERE estate_id=$1 AND id=$2",
            [id, jobId],
          )
        ).rows[0];
        if (!job)
          throw new ApiError(
            404,
            "Saved review is not available in this estate scope.",
          );
        const audit = (
          await c.query(
            "SELECT id,action,actor_id,request_id,reason,created_at,manifest_sha256 FROM eoms.reconciliation_job_history WHERE job_id=$1 ORDER BY id",
            [jobId],
          )
        ).rows;
        return { job, audit };
      }),
    );
  });
  app.post(jobs + "/:jobId/evidence", async (req, res) => {
    const jobId = z.string().uuid().parse(req.params.jobId),
      input = sourceEvidenceInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await requireAccess(c, id);
        if (
          !(
            await c.query(
              "SELECT id FROM eoms.reconciliation_jobs WHERE estate_id=$1 AND id=$2",
              [id, jobId],
            )
          ).rowCount
        )
          throw new ApiError(
            404,
            "Saved review is not available in this estate scope.",
          );
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        return (
          await c.query(
            "SELECT eoms.check_reconciliation_source($1,$2,$3,$4,$5) AS result",
            [
              jobId,
              input.key,
              input.fileName,
              input.reason,
              Buffer.from(input.contentBase64, "base64"),
            ],
          )
        ).rows[0].result;
      }),
    );
  });
  app.get(jobs + "/:jobId/evidence", async (req, res) => {
    const jobId = z.string().uuid().parse(req.params.jobId),
      query = z
        .object({ limit: pageFields.limit, cursor: pageFields.cursor })
        .strict()
        .parse(req.query);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await requireAccess(c, id);
        if (
          !(
            await c.query(
              "SELECT id FROM eoms.reconciliation_jobs WHERE estate_id=$1 AND id=$2",
              [id, jobId],
            )
          ).rowCount
        )
          throw new ApiError(
            404,
            "Saved review is not available in this estate scope.",
          );
        const binding = {
            kind: "reconciliation-evidence",
            estate: id,
            job: jobId,
            actor: res.locals.user.id,
            limit: query.limit,
          },
          page = readPage(query.cursor, binding);
        const rows = (
          await c.query(
            "SELECT * FROM eoms.reconciliation_evidence_checks WHERE estate_id=$1 AND job_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
            [id, jobId, page?.key ?? null, query.limit + 1],
          )
        ).rows;
        return pageResult(rows, query.limit, binding, (r) => r.id);
      }),
    );
  });
}
