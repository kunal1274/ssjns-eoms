import { mappingOverlayRoutes } from "./mapping-overlay";
import { mappingDecisionRoutes } from "./mapping-decision";
import { mappingPolicyRoutes, policyReviewSummary } from "./mapping-policy";
import {
  mappingPolicyProposal,
  readinessFindings,
} from "../../../packages/domain/mapping-readiness";
import { sourceReviewInput } from "../../../packages/domain/source-review";
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
  mappingPolicyRoutes(app, estateTx);
  mappingDecisionRoutes(app, estateTx);
  mappingOverlayRoutes(app, estateTx);
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
  const reviewPath = jobs + "/:jobId/evidence/:checkId/reviews";
  async function reviewContext(
    c: PoolClient,
    id: string,
    jobId: string,
    checkId: string,
  ) {
    await requireAccess(c, id);
    const evidence = (
      await c.query(
        "SELECT e.id,e.actor_id,e.matches_declared,e.file_name,e.computed_sha256,e.manifest_sha256,j.created_by,j.manifest->'source'->>'documentRef' AS document_ref FROM eoms.reconciliation_evidence_checks e JOIN eoms.reconciliation_jobs j ON j.id=e.job_id WHERE e.id=$1 AND e.job_id=$2 AND e.estate_id=$3",
        [checkId, jobId, id],
      )
    ).rows[0];
    if (!evidence)
      throw new ApiError(
        404,
        "Source check is not available in this review scope.",
      );
    return evidence;
  }
  app.get(reviewPath, async (req, res) => {
    const jobId = z.string().uuid().parse(req.params.jobId),
      checkId = z.string().uuid().parse(req.params.checkId),
      query = z
        .object({ limit: pageFields.limit, cursor: pageFields.cursor })
        .strict()
        .parse(req.query);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        const evidence = await reviewContext(c, id, jobId, checkId),
          actor = res.locals.user.id;
        const binding = {
            kind: "source-provenance-reviews",
            estate: id,
            job: jobId,
            check: checkId,
            actor,
            limit: query.limit,
          },
          page = readPage(query.cursor, binding);
        const rows = (
          await c.query(
            "SELECT r.*,r.revision=(SELECT max(v.revision) FROM eoms.source_provenance_reviews v WHERE v.evidence_id=r.evidence_id AND v.reviewer_id=r.reviewer_id) AS is_current FROM eoms.source_provenance_reviews r WHERE r.evidence_id=$1 AND r.estate_id=$2 AND ($3::uuid IS NULL OR r.id>$3) ORDER BY r.id LIMIT $4",
            [checkId, id, page?.key ?? null, query.limit + 1],
          )
        ).rows;
        const ownRevision = (
          await c.query(
            "SELECT coalesce(max(revision),0)::int AS revision FROM eoms.source_provenance_reviews WHERE evidence_id=$1 AND reviewer_id=$2",
            [checkId, actor],
          )
        ).rows[0].revision;
        const independent =
          actor !== evidence.actor_id && actor !== evidence.created_by;
        return {
          ...pageResult(rows, query.limit, binding, (r) => r.id),
          context: {
            actorId: actor,
            canRecord: independent,
            canCorroborate: independent && evidence.matches_declared,
            ownRevision,
            source: {
              checkId,
              jobId,
              fileName: evidence.file_name,
              sha256: evidence.computed_sha256,
              manifestSha256: evidence.manifest_sha256,
              documentRef: evidence.document_ref,
            },
            blockers: independent
              ? []
              : [
                  "The manifest preparer and source-file uploader cannot record an independent review. Continue with a separately authorized reviewer.",
                ],
          },
        };
      }),
    );
  });
  app.post(reviewPath, async (req, res) => {
    const jobId = z.string().uuid().parse(req.params.jobId),
      checkId = z.string().uuid().parse(req.params.checkId),
      input = sourceReviewInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await reviewContext(c, id, jobId, checkId);
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        try {
          return (
            await c.query(
              "SELECT eoms.record_source_review($1,$2,$3,$4,$5,$6,$7) AS result",
              [
                checkId,
                input.key,
                input.expectedRevision,
                input.outcome,
                input.originalExamined,
                input.sourceRef,
                input.reason,
              ],
            )
          ).rows[0].result;
        } catch (e) {
          if ((e as { code?: string }).code === "23505")
            throw new ApiError(
              409,
              "Your review revision changed or this save reference was reused. Refresh review history before recording a correction; retry an unchanged submission to recover it.",
            );
          throw e;
        }
      }),
    );
  });
  app.get(jobs + "/:jobId/evidence/:checkId/readiness", async (req, res) => {
    const jobId = z.string().uuid().parse(req.params.jobId),
      checkId = z.string().uuid().parse(req.params.checkId);
    z.object({}).strict().parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        await reviewContext(c, id, jobId, checkId);
        const startedAt = new Date().toISOString(),
          job = (
            await c.query(
              "SELECT * FROM eoms.reconciliation_jobs WHERE estate_id=$1 AND id=$2",
              [id, jobId],
            )
          ).rows[0];
        const manifest = reconciliationManifest.parse(job.manifest),
          current = await evaluate(
            c,
            id,
            manifest,
            res.locals.user.id,
            res.locals.requestId,
          );
        const evidence = (
          await c.query(
            "SELECT id,computed_sha256,declared_sha256,matches_declared FROM eoms.reconciliation_evidence_checks WHERE id=$1 AND estate_id=$2 AND job_id=$3",
            [checkId, id, jobId],
          )
        ).rows[0];
        const observations = (
          await c.query(
            "SELECT eoms.source_readiness_observations($1) AS report",
            [checkId],
          )
        ).rows[0].report;
        const estateActive = (await access(c, id))?.active === true;
        const changedRows = current.rows.flatMap((row, index) => {
          const saved = job.snapshot.rows[index]?.current;
          return saved?.version !== row.current?.version ||
            saved?.recorded_target !== row.current?.recorded_target ||
            saved?.recorded_code !== row.current?.recorded_code
            ? [{ index, sourceRow: row.sourceRow, recordId: row.recordId }]
            : [];
        });
        return {
          version: 1,
          kind: "mapping-readiness",
          startedAt,
          evaluatedAt: new Date().toISOString(),
          actorId: res.locals.user.id,
          requestId: res.locals.requestId,
          estateId: id,
          jobId,
          checkId,
          manifestSha256: job.manifest_sha256,
          sourceAuthenticityVerified: false,
          approvalEnabled: false,
          applicationEnabled: false,
          applied: false,
          transactionalRevalidationRequired: true,
          estateActive,
          policy: mappingPolicyProposal,
          policyReview: await policyReviewSummary(c, id),
          saved: { createdAt: job.created_at, summary: job.snapshot.summary },
          current,
          evidence,
          observations,
          changedRows,
          findings: readinessFindings({
            blocked: current.summary.blocked,
            matches: evidence.matches_declared,
            observations,
            drift: changedRows.length,
            estateActive,
          }),
        };
      }),
    );
  });
}
