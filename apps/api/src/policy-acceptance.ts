import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { EstateTx } from "./maintenance";
import { ApiError } from "./http";
import {
  pageFields,
  readPage,
  pageResult,
  literalPattern,
} from "./navigation-page";
import {
  policyAuthorityInput,
  policyAcceptanceInput,
} from "../../../packages/domain/policy-acceptance";
export async function currentPolicyAcceptance(c: PoolClient, policyId: string) {
  return (
    await c.query("SELECT eoms.policy_acceptance_state($1) AS state", [
      policyId,
    ])
  ).rows[0].state;
}
export function policyAcceptanceRoutes(app: Express, estateTx: EstateTx) {
  const base = "/api/estates/:estateId/reconciliation/policy-authority",
    policies = "/api/estates/:estateId/reconciliation/policies";
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
        "Estate-manager and customer setup access is required to inspect policy authority and external decisions.",
      );
  }
  const pages = z
    .object({ limit: pageFields.limit, cursor: pageFields.cursor })
    .strict();
  function failure(e: unknown): never {
    if ((e as { code?: string }).code === "23505")
      throw new ApiError(
        409,
        "The policy, appointment or decision revision changed, or this retry reference was reused. Refresh current authority and history before a new submission; retry unchanged content to recover the original receipt.",
      );
    throw e;
  }
  app.get(base + "/candidates", async (req, res) => {
    const query = z
      .object({
        q: pageFields.q,
        limit: pageFields.limit,
        cursor: pageFields.cursor,
      })
      .strict()
      .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        await gate(c, id);
        const binding = {
            kind: "policy-authority-candidates",
            estate: id,
            actor: res.locals.user.id,
            ...query,
            cursor: undefined,
          },
          page = readPage(query.cursor, binding);
        const rows = (
          await c.query(
            "SELECT id,name FROM eoms.policy_authority_candidates($1) WHERE (name ILIKE $2 ESCAPE '\\' OR id::text ILIKE $2 ESCAPE '\\') AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
            [id, literalPattern(query.q), page?.key ?? null, query.limit + 1],
          )
        ).rows;
        return {
          ...pageResult(rows, query.limit, binding, (r) => r.id),
          actorId: res.locals.user.id,
        };
      }),
    );
  });
  app.get(base, async (req, res) => {
    const query = pages
      .extend({ subjectId: z.string().uuid().optional() })
      .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        await gate(c, id);
        const subject = query.subjectId ?? null,
          binding = {
            kind: "policy-authority-history",
            estate: id,
            subject,
            actor: res.locals.user.id,
            limit: query.limit,
          },
          page = readPage(query.cursor, binding);
        const rows = (
          await c.query(
            "SELECT * FROM eoms.mapping_policy_authority WHERE estate_id=$1 AND ($2::uuid IS NULL OR subject_id=$2) AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
            [id, subject, page?.key ?? null, query.limit + 1],
          )
        ).rows;
        const state = subject
          ? (
              await c.query(
                "SELECT eoms.policy_authority_state($1,$2) AS state",
                [id, subject],
              )
            ).rows[0].state
          : null;
        return {
          ...pageResult(rows, query.limit, binding, (r) => r.id),
          state,
          actorId: res.locals.user.id,
        };
      }),
    );
  });
  app.post(base, async (req, res) => {
    const input = policyAuthorityInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await gate(c, id);
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        try {
          return (
            await c.query(
              "SELECT eoms.record_policy_authority($1,$2,$3,$4,$5,$6,$7) AS result",
              [
                id,
                input.subjectId,
                input.key,
                input.expectedRevision,
                input.action,
                input.authorityRef,
                input.reason,
              ],
            )
          ).rows[0].result;
        } catch (e) {
          return failure(e);
        }
      }),
    );
  });
  async function context(
    c: PoolClient,
    id: string,
    policyId: string,
    actor: string,
  ) {
    await gate(c, id);
    const policy = (
      await c.query(
        "SELECT * FROM eoms.mapping_policy_versions WHERE id=$1 AND estate_id=$2",
        [policyId, id],
      )
    ).rows[0];
    if (!policy)
      throw new ApiError(404, "Policy is not available in this estate scope.");
    const state = await currentPolicyAcceptance(c, policyId),
      authority = (
        await c.query("SELECT eoms.policy_authority_state($1,$2) AS state", [
          id,
          actor,
        ])
      ).rows[0].state;
    return {
      policy,
      state,
      authority,
      canRecord: authority.effective && actor !== policy.actor_id,
      independent: actor !== policy.actor_id,
    };
  }
  app.get(policies + "/:policyId/acceptance", async (req, res) => {
    const policyId = z.string().uuid().parse(req.params.policyId),
      query = pages.parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, id) => {
        const ctx = await context(c, id, policyId, res.locals.user.id),
          binding = {
            kind: "policy-external-decisions",
            estate: id,
            policy: policyId,
            actor: res.locals.user.id,
            limit: query.limit,
          },
          page = readPage(query.cursor, binding);
        const rows = (
          await c.query(
            "SELECT * FROM eoms.mapping_policy_acceptance WHERE policy_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
            [policyId, page?.key ?? null, query.limit + 1],
          )
        ).rows;
        return {
          ...pageResult(rows, query.limit, binding, (r) => r.id),
          ...ctx,
        };
      }),
    );
  });
  app.post(policies + "/:policyId/acceptance", async (req, res) => {
    const policyId = z.string().uuid().parse(req.params.policyId),
      input = policyAcceptanceInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, id) => {
        await context(c, id, policyId, res.locals.user.id);
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        try {
          return (
            await c.query(
              "SELECT eoms.record_policy_acceptance($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result",
              [
                policyId,
                input.key,
                input.expectedRevision,
                input.policySha256,
                input.authorityId,
                input.outcome,
                input.externalRef,
                input.reason,
                input.attested,
              ],
            )
          ).rows[0].result;
        } catch (e) {
          return failure(e);
        }
      }),
    );
  });
}
