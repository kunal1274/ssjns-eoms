import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { EstateTx } from "./maintenance";
import { ApiError } from "./http";
import { pageFields, readPage, pageResult } from "./navigation-page";
import {
  mappingAppointmentInput,
  mappingRequestInput,
  mappingDecisionInput,
} from "../../../packages/domain/mapping-decision";
export function mappingDecisionRoutes(app: Express, estateTx: EstateTx) {
  const base = "/api/estates/:estateId/reconciliation",
    source = base + "/jobs/:jobId/evidence/:checkId/mapping-requests",
    requests = base + "/mapping-requests",
    authority = base + "/mapping-authority";
  const pages = z
    .object({ limit: pageFields.limit, cursor: pageFields.cursor })
    .strict();
  async function gate(c: PoolClient, id: string) {
    if (
      !(
        await c.query("SELECT eoms.can_review_reconciliation($1) AS allowed", [
          id,
        ])
      ).rows[0].allowed
    )
      throw new ApiError(
        403,
        "Estate-manager and customer setup access is required for mapping requests and decisions.",
      );
  }
  function conflict(e: unknown): never {
    if ((e as { code?: string }).code === "23505")
      throw new ApiError(
        409,
        "The bound policy, records, observations, appointment or decision changed, or this retry reference was reused. Refresh and inspect current evidence; return for a linked correction when needed. An unchanged retry recovers its original receipt.",
      );
    throw e;
  }
  async function scopedSource(
    c: PoolClient,
    id: string,
    job: string,
    check: string,
  ) {
    await gate(c, id);
    if (
      !(
        await c.query(
          "SELECT id FROM eoms.reconciliation_evidence_checks WHERE id=$1 AND job_id=$2 AND estate_id=$3",
          [check, job, id],
        )
      ).rowCount
    )
      throw new ApiError(
        404,
        "Selected source check is not available in this estate and review scope.",
      );
  }
  async function scopedRequest(c: PoolClient, id: string, requestId: string) {
    await gate(c, id);
    const r = (
      await c.query(
        "SELECT * FROM eoms.mapping_requests WHERE id=$1 AND estate_id=$2",
        [requestId, id],
      )
    ).rows[0];
    if (!r)
      throw new ApiError(
        404,
        "Mapping request is not available in this estate scope.",
      );
    return r;
  }
  async function mark(c: PoolClient, requestId: string) {
    await c.query("SELECT set_config('app.request_id',$1,true)", [requestId]);
  }
  app.get(authority, async (req, res) => {
    const q = pages
      .extend({ subjectId: z.string().uuid().optional() })
      .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        await gate(c, id);
        const subject = q.subjectId ?? null,
          binding = {
            kind: "mapping-authority",
            estate: id,
            subject,
            actor: res.locals.user.id,
            limit: q.limit,
          },
          p = readPage(q.cursor, binding);
        const rows = (
          await c.query(
            "SELECT * FROM eoms.mapping_decision_authority WHERE estate_id=$1 AND ($2::uuid IS NULL OR subject_id=$2) AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
            [id, subject, p?.key ?? null, q.limit + 1],
          )
        ).rows;
        const state = subject
          ? (
              await c.query(
                "SELECT eoms.mapping_authority_state($1,$2) AS value",
                [id, subject],
              )
            ).rows[0].value
          : null;
        if (state)
          state.eligible = (
            await c.query(
              "SELECT eoms.policy_authority_state($1,$2) AS value",
              [id, subject],
            )
          ).rows[0].value.eligible;
        return {
          ...pageResult(rows, q.limit, binding, (r) => r.id),
          state,
          actorId: res.locals.user.id,
        };
      }),
    );
  });
  app.post(authority, async (req, res) => {
    const v = mappingAppointmentInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await gate(c, id);
        await mark(c, res.locals.requestId);
        try {
          return (
            await c.query(
              "SELECT eoms.appoint_mapping_recorder($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value",
              [
                id,
                v.subjectId,
                v.policyId,
                v.acceptanceId,
                v.key,
                v.expectedRevision,
                v.action,
                v.reference,
                v.reason,
              ],
            )
          ).rows[0].value;
        } catch (e) {
          return conflict(e);
        }
      }),
    );
  });
  app.get(source + "/context", async (req, res) => {
    const job = z.string().uuid().parse(req.params.jobId),
      check = z.string().uuid().parse(req.params.checkId);
    z.object({}).strict().parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        await scopedSource(c, id, job, check);
        const policy =
          (
            await c.query(
              "SELECT id,revision,sha256 FROM eoms.mapping_policy_versions WHERE estate_id=$1 ORDER BY revision DESC LIMIT 1",
              [id],
            )
          ).rows[0] ?? null;
        const acceptance = policy
          ? (
              await c.query(
                "SELECT eoms.policy_acceptance_state($1) AS value",
                [policy.id],
              )
            ).rows[0].value
          : null;
        const binding =
          policy && acceptance?.head
            ? (
                await c.query(
                  "SELECT eoms.inspect_mapping_binding($1,$2,$3) AS value",
                  [check, policy.id, acceptance.head.id],
                )
              ).rows[0].value
            : null;
        const ownAuthority = (
          await c.query("SELECT eoms.mapping_authority_state($1,$2) AS value", [
            id,
            res.locals.user.id,
          ])
        ).rows[0].value;
        return {
          policy,
          acceptance,
          binding,
          ownAuthority,
          actorId: res.locals.user.id,
          applicationEnabled: false,
        };
      }),
    );
  });
  app.get(source, async (req, res) => {
    const job = z.string().uuid().parse(req.params.jobId),
      check = z.string().uuid().parse(req.params.checkId),
      q = pages.parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        await scopedSource(c, id, job, check);
        const binding = {
            kind: "mapping-requests",
            estate: id,
            job,
            check,
            actor: res.locals.user.id,
            limit: q.limit,
          },
          p = readPage(q.cursor, binding);
        const rows = (
          await c.query(
            "SELECT id,created_by,previous_id,reason,custody_ref,created_at,snapshot_sha256 FROM eoms.mapping_requests WHERE estate_id=$1 AND check_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
            [id, check, p?.key ?? null, q.limit + 1],
          )
        ).rows;
        return pageResult(rows, q.limit, binding, (r) => r.id);
      }),
    );
  });
  app.post(source, async (req, res) => {
    const job = z.string().uuid().parse(req.params.jobId),
      check = z.string().uuid().parse(req.params.checkId),
      v = mappingRequestInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await scopedSource(c, id, job, check);
        await mark(c, res.locals.requestId);
        try {
          return (
            await c.query(
              "SELECT eoms.submit_mapping_request($1,$2,$3,$4,$5,$6,$7) AS value",
              [
                check,
                v.policyId,
                v.acceptanceId,
                v.key,
                v.previousId,
                v.custodyRef,
                v.reason,
              ],
            )
          ).rows[0].value;
        } catch (e) {
          return conflict(e);
        }
      }),
    );
  });
  app.get(requests + "/:requestId", async (req, res) => {
    const requestId = z.string().uuid().parse(req.params.requestId);
    z.object({}).strict().parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        const mappingRequest = await scopedRequest(c, id, requestId),
          state = (
            await c.query("SELECT eoms.mapping_request_state($1) AS value", [
              requestId,
            ])
          ).rows[0].value,
          ownAuthority = (
            await c.query(
              "SELECT eoms.mapping_authority_state($1,$2) AS value",
              [id, res.locals.user.id],
            )
          ).rows[0].value;
        return {
          mappingRequest,
          state,
          ownAuthority,
          actorId: res.locals.user.id,
          applicationEnabled: false,
        };
      }),
    );
  });
  app.get(requests + "/:requestId/decisions", async (req, res) => {
    const requestId = z.string().uuid().parse(req.params.requestId),
      q = pages.parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        await scopedRequest(c, id, requestId);
        const binding = {
            kind: "mapping-decisions",
            estate: id,
            request: requestId,
            actor: res.locals.user.id,
            limit: q.limit,
          },
          p = readPage(q.cursor, binding);
        const rows = (
          await c.query(
            "SELECT * FROM eoms.mapping_decisions WHERE mapping_request_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
            [requestId, p?.key ?? null, q.limit + 1],
          )
        ).rows;
        return pageResult(rows, q.limit, binding, (r) => r.id);
      }),
    );
  });
  app.post(requests + "/:requestId/decisions", async (req, res) => {
    const requestId = z.string().uuid().parse(req.params.requestId),
      v = mappingDecisionInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await scopedRequest(c, id, requestId);
        await mark(c, res.locals.requestId);
        try {
          return (
            await c.query(
              "SELECT eoms.record_mapping_decision($1,$2,$3,$4,$5,$6,$7,$8) AS value",
              [
                requestId,
                v.key,
                v.expectedRevision,
                v.appointmentId,
                v.outcome,
                v.reference,
                v.reason,
                v.examined,
              ],
            )
          ).rows[0].value;
        } catch (e) {
          return conflict(e);
        }
      }),
    );
  });
}
