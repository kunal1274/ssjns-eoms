import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { EstateTx } from "./maintenance";
import { ApiError } from "./http";
import { pageFields, readPage, pageResult } from "./navigation-page";
import {
  policyDocument,
  policyGuardrails,
  policyProposalInput,
  policyReviewInput,
} from "../../../packages/domain/mapping-policy";
export async function policyReviewSummary(c: PoolClient, estate: string) {
  const latest =
    (
      await c.query(
        "SELECT id,revision,sha256,created_at FROM eoms.mapping_policy_versions WHERE estate_id=$1 ORDER BY revision DESC LIMIT 1",
        [estate],
      )
    ).rows[0] ?? null;
  return {
    latest,
    approvalEnabled: false,
    applicationEnabled: false,
    status: "design-review-only",
  };
}
export function mappingPolicyRoutes(app: Express, estateTx: EstateTx) {
  const base = "/api/estates/:estateId/reconciliation/policies";
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
        "Estate-manager and customer setup permissions are required to review mapping policy proposals.",
      );
  }
  async function scoped(c: PoolClient, estate: string, policyId: string) {
    await gate(c, estate);
    const p = (
      await c.query(
        "SELECT * FROM eoms.mapping_policy_versions WHERE estate_id=$1 AND id=$2",
        [estate, policyId],
      )
    ).rows[0];
    if (!p)
      throw new ApiError(
        404,
        "Policy proposal is not available in this estate scope.",
      );
    return p;
  }
  const querySchema = z
    .object({ limit: pageFields.limit, cursor: pageFields.cursor })
    .strict();
  app.get(base, async (req, res) => {
    const query = querySchema.parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        await gate(c, id);
        const binding = {
            kind: "mapping-policy",
            estate: id,
            actor: res.locals.user.id,
            limit: query.limit,
          },
          page = readPage(query.cursor, binding);
        const rows = (
          await c.query(
            "SELECT id,revision,previous_id,actor_id,reason,sha256,created_at FROM eoms.mapping_policy_versions WHERE estate_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
            [id, page?.key ?? null, query.limit + 1],
          )
        ).rows;
        return {
          ...pageResult(rows, query.limit, binding, (r) => r.id),
          ...(await policyReviewSummary(c, id)),
          guardrails: policyGuardrails,
        };
      }),
    );
  });
  const conflict = (e: unknown) => {
    if ((e as { code?: string }).code === "23505")
      throw new ApiError(
        409,
        "The policy or your review revision changed, or this save reference was reused. Refresh history and inspect the latest proposal before a new submission. Retry unchanged content to recover a committed receipt.",
      );
    throw e;
  };
  app.post(base, async (req, res) => {
    const input = policyProposalInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await gate(c, id);
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        try {
          return (
            await c.query(
              "SELECT eoms.propose_mapping_policy($1,$2,$3,$4,$5) AS result",
              [
                id,
                input.key,
                input.expectedRevision,
                JSON.stringify(policyDocument(input.content)),
                input.reason,
              ],
            )
          ).rows[0].result;
        } catch (e) {
          return conflict(e);
        }
      }),
    );
  });
  app.get(base + "/:policyId", async (req, res) => {
    const policyId = z.string().uuid().parse(req.params.policyId);
    z.object({}).strict().parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        const policy = await scoped(c, id, policyId),
          summary = await policyReviewSummary(c, id);
        return {
          policy,
          ...summary,
          isLatest: summary.latest?.id === policyId,
          canReview: policy.actor_id !== res.locals.user.id,
        };
      }),
    );
  });
  app.get(base + "/:policyId/reviews", async (req, res) => {
    const policyId = z.string().uuid().parse(req.params.policyId),
      query = querySchema.parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        const policy = await scoped(c, id, policyId),
          summary = await policyReviewSummary(c, id),
          actor = res.locals.user.id;
        const binding = {
            kind: "mapping-policy-reviews",
            estate: id,
            policy: policyId,
            actor,
            limit: query.limit,
          },
          page = readPage(query.cursor, binding);
        const rows = (
          await c.query(
            "SELECT r.*,r.revision=(SELECT max(v.revision) FROM eoms.mapping_policy_reviews v WHERE v.policy_id=r.policy_id AND v.actor_id=r.actor_id) AS is_current FROM eoms.mapping_policy_reviews r WHERE policy_id=$1 AND ($2::uuid IS NULL OR r.id>$2) ORDER BY id LIMIT $3",
            [policyId, page?.key ?? null, query.limit + 1],
          )
        ).rows;
        const own = (
          await c.query(
            "SELECT coalesce(max(revision),0)::int AS revision FROM eoms.mapping_policy_reviews WHERE policy_id=$1 AND actor_id=$2",
            [policyId, actor],
          )
        ).rows[0].revision;
        const totals = (
          await c.query(
            "SELECT outcome,count(*)::int AS count FROM (SELECT DISTINCT ON(actor_id) actor_id,outcome FROM eoms.mapping_policy_reviews WHERE policy_id=$1 ORDER BY actor_id,revision DESC) current_reviews GROUP BY outcome",
            [policyId],
          )
        ).rows;
        return {
          ...pageResult(rows, query.limit, binding, (r) => r.id),
          ownRevision: own,
          canReview:
            actor !== policy.actor_id && summary.latest?.id === policyId,
          totals,
          status: "design-review-only",
        };
      }),
    );
  });
  app.post(base + "/:policyId/reviews", async (req, res) => {
    const policyId = z.string().uuid().parse(req.params.policyId),
      input = policyReviewInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await scoped(c, id, policyId);
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        try {
          return (
            await c.query(
              "SELECT eoms.review_mapping_policy($1,$2,$3,$4,$5,$6,$7) AS result",
              [
                policyId,
                input.key,
                input.expectedRevision,
                input.policySha256,
                input.outcome,
                input.reference,
                input.reason,
              ],
            )
          ).rows[0].result;
        } catch (e) {
          return conflict(e);
        }
      }),
    );
  });
}
