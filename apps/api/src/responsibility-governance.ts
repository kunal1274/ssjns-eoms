import type { Express, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import { administrator, estateContext } from "./hierarchy";
import type { Transaction } from "./organization";
const uuid = z.string().uuid(),
  reason = z.string().trim().min(3).max(500),
  revision = z.number().int().min(0);
export async function responsibilityRevision(c: PoolClient, estate: string) {
  return (
    await c.query(
      "SELECT coalesce(max(revision),0)::int AS revision FROM eoms.estate_responsibilities WHERE estate_id=$1",
      [estate],
    )
  ).rows[0].revision;
}
async function lock(c: PoolClient, estate: string, res: Response) {
  await c.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text,609)),set_config('app.request_id',$2,true)",
    [estate, res.locals.requestId],
  );
}
async function cancellable(
  c: PoolClient,
  estate: string,
  target: string,
  expected: number,
) {
  if ((await responsibilityRevision(c, estate)) !== expected)
    throw new ApiError(
      409,
      "Responsibility history changed. Refresh and review a new cancellation request.",
    );
  const row = (
    await c.query(
      "SELECT id,effective_from::text AS effective_from FROM eoms.active_estate_responsibilities WHERE estate_id=$1 ORDER BY effective_from DESC LIMIT 1",
      [estate],
    )
  ).rows[0];
  if (!row || row.id !== target)
    throw new ApiError(
      409,
      "Only the latest active responsibility change can be cancelled. Refresh the timeline.",
    );
  const today = (await c.query("SELECT CURRENT_DATE::text AS day")).rows[0].day;
  if (row.effective_from <= today)
    throw new ApiError(
      409,
      "Only a strictly future change can be cancelled. Effective history needs the planned governed correction process.",
    );
  if (
    (
      await c.query(
        "SELECT id FROM eoms.musters WHERE estate_id=$1 AND business_date>=$2::date LIMIT 1",
        [estate, row.effective_from],
      )
    ).rowCount
  )
    throw new ApiError(
      409,
      "Work already exists on or after the effective date. Cancellation cannot change recorded attribution.",
    );
}
export function responsibilityGovernanceRoutes(app: Express, tx: Transaction) {
  app.post(
    "/api/estates/:estateId/responsibility/:assignmentId/cancellation",
    async (req, res) => {
      const estate = uuid.parse(req.params.estateId),
        target = uuid.parse(req.params.assignmentId),
        input = z.object({ revision, reason }).strict().parse(req.body);
      const row = await tx(res, async (c) => {
        const scope = await estateContext(c, estate);
        await administrator(c, scope.customer_id);
        await lock(c, estate, res);
        if (
          !(
            await c.query(
              "SELECT id FROM eoms.estate_responsibilities WHERE id=$1 AND estate_id=$2",
              [target, estate],
            )
          ).rowCount
        )
          throw new ApiError(
            404,
            "Responsibility change is not available in this estate.",
          );
        await cancellable(c, estate, target, input.revision);
        if (
          (
            await c.query(
              "SELECT q.id FROM eoms.responsibility_cancel_requests q WHERE q.responsibility_id=$1 AND NOT EXISTS(SELECT 1 FROM eoms.responsibility_cancel_decisions d WHERE d.cancel_request_id=q.id)",
              [target],
            )
          ).rowCount
        )
          throw new ApiError(
            409,
            "A cancellation request is already pending. Ask an independent setup reviewer to review it.",
          );
        return (
          await c.query(
            "INSERT INTO eoms.responsibility_cancel_requests(responsibility_id,estate_id,customer_id,expected_revision,reason) VALUES($1,$2,$3,$4,$5) RETURNING id,responsibility_id,expected_revision,request_id",
            [target, estate, scope.customer_id, input.revision, input.reason],
          )
        ).rows[0];
      });
      res.status(201).json(row);
    },
  );
  app.post(
    "/api/estates/:estateId/responsibility/requests/:requestId/decision",
    async (req, res) => {
      const estate = uuid.parse(req.params.estateId),
        request = uuid.parse(req.params.requestId),
        input = z
          .object({
            decision: z.enum(["approved", "rejected"]),
            revision,
            reason,
          })
          .strict()
          .parse(req.body);
      const row = await tx(res, async (c) => {
        const scope = await estateContext(c, estate);
        await administrator(c, scope.customer_id);
        await lock(c, estate, res);
        const item = (
          await c.query(
            "SELECT * FROM eoms.responsibility_cancel_requests WHERE id=$1 AND estate_id=$2",
            [request, estate],
          )
        ).rows[0];
        if (!item)
          throw new ApiError(
            404,
            "Cancellation request is not available in this estate.",
          );
        if (item.requester_id === res.locals.user.id)
          throw new ApiError(
            403,
            "An independent setup reviewer must decide this request. You cannot review your own request.",
          );
        if (
          (
            await c.query(
              "SELECT id FROM eoms.responsibility_cancel_decisions WHERE cancel_request_id=$1",
              [request],
            )
          ).rowCount
        )
          throw new ApiError(
            409,
            "This request already has a recorded decision. Refresh the history.",
          );
        if ((await responsibilityRevision(c, estate)) !== input.revision)
          throw new ApiError(
            409,
            "Responsibility history changed. Refresh before reviewing.",
          );
        if (input.decision === "approved")
          await cancellable(
            c,
            estate,
            item.responsibility_id,
            item.expected_revision,
          );
        return (
          await c.query(
            "INSERT INTO eoms.responsibility_cancel_decisions(cancel_request_id,estate_id,customer_id,decision,reason) VALUES($1,$2,$3,$4,$5) RETURNING id,decision,reason,request_id",
            [request, estate, scope.customer_id, input.decision, input.reason],
          )
        ).rows[0];
      });
      res.status(201).json(row);
    },
  );
}
