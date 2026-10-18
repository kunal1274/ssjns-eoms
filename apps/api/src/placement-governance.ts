import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import {
  administrator,
  context,
  estateContext,
  visibleCustomer,
} from "./hierarchy";
import type { Transaction } from "./organization";
const uuid = z.string().uuid(),
  reason = z.string().trim().min(3).max(500),
  version = z.number().int().positive();
export async function placementLock(c: PoolClient, customer: string) {
  await c.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text,610))",
    [customer],
  );
}
async function destination(c: PoolClient, customer: string, id: string | null) {
  if (
    id &&
    !(
      await c.query(
        "SELECT id FROM eoms.operating_areas WHERE id=$1 AND customer_id=$2 AND active",
        [id, customer],
      )
    ).rowCount
  )
    throw new ApiError(
      409,
      "Destination is unavailable or inactive. Refresh and choose an active operating area.",
    );
}
export function placementGovernanceRoutes(app: Express, tx: Transaction) {
  app.get("/api/customers/:customerId/placement-moves", async (req, res) => {
    const customer = uuid.parse(req.params.customerId);
    res.json(
      await tx(res, async (c) => {
        await visibleCustomer(c, customer);
        const rows = (
          await c.query(
            `SELECT q.id,q.estate_id,q.from_area_id,q.to_area_id,q.expected_version,q.reason,q.requester_id,q.request_id,q.created_at,u.display_name AS requester,
 d.id AS decision_id,d.decision,d.reason AS decision_reason,d.reviewer_id,d.request_id AS decision_request_id,d.created_at AS decided_at,r.display_name AS reviewer
 FROM eoms.placement_move_requests q LEFT JOIN eoms.users u ON u.id=q.requester_id LEFT JOIN eoms.placement_move_decisions d ON d.move_request_id=q.id LEFT JOIN eoms.users r ON r.id=d.reviewer_id WHERE q.customer_id=$1 ORDER BY q.created_at DESC,q.id DESC LIMIT 51`,
            [customer],
          )
        ).rows;
        return {
          hasReviewable: (
            await c.query(
              "SELECT EXISTS(SELECT 1 FROM eoms.placement_move_requests q JOIN eoms.memberships m ON m.estate_id=q.estate_id AND m.user_id=$2 WHERE q.customer_id=$1 AND q.requester_id<>$2 AND NOT EXISTS(SELECT 1 FROM eoms.placement_move_decisions d WHERE d.move_request_id=q.id)) AS allowed",
              [customer, res.locals.user.id],
            )
          ).rows[0].allowed,
          actorId: res.locals.user.id,
          items: rows.slice(0, 50),
          truncated: rows.length > 50,
        };
      }),
    );
  });
  app.post("/api/estates/:estateId/placement-moves", async (req, res) => {
    const estate = uuid.parse(req.params.estateId),
      input = z
        .object({ toAreaId: uuid.nullable(), version, reason })
        .strict()
        .parse(req.body);
    const row = await tx(res, async (c) => {
      const scope = await estateContext(c, estate);
      await administrator(c, scope.customer_id);
      await placementLock(c, scope.customer_id);
      await context(c, res, input.reason);
      const current = (
        await c.query(
          "SELECT area_id,placement_version FROM eoms.estates WHERE id=$1 FOR UPDATE",
          [estate],
        )
      ).rows[0];
      if (current.placement_version !== input.version)
        throw new ApiError(
          409,
          "Estate placement changed. Refresh and review the source and destination again.",
        );
      if (current.area_id === input.toAreaId)
        throw new ApiError(
          422,
          "Choose a different operating area or customer root.",
        );
      await destination(c, scope.customer_id, input.toAreaId);
      if (
        (
          await c.query(
            "SELECT q.id FROM eoms.placement_move_requests q WHERE q.estate_id=$1 AND NOT EXISTS(SELECT 1 FROM eoms.placement_move_decisions d WHERE d.move_request_id=q.id)",
            [estate],
          )
        ).rowCount
      )
        throw new ApiError(
          409,
          "A move is already pending. Ask an independent setup reviewer to decide it first.",
        );
      return (
        await c.query(
          "INSERT INTO eoms.placement_move_requests(estate_id,customer_id,to_area_id,expected_version,reason) VALUES($1,$2,$3,$4,$5) RETURNING id,from_area_id,to_area_id,expected_version,request_id",
          [
            estate,
            scope.customer_id,
            input.toAreaId,
            input.version,
            input.reason,
          ],
        )
      ).rows[0];
    });
    res.status(201).json(row);
  });
  app.post(
    "/api/estates/:estateId/placement-moves/:moveId/decision",
    async (req, res) => {
      const estate = uuid.parse(req.params.estateId),
        id = uuid.parse(req.params.moveId),
        input = z
          .object({
            decision: z.enum(["approved", "rejected"]),
            version,
            reason,
          })
          .strict()
          .parse(req.body);
      const row = await tx(res, async (c) => {
        const scope = await estateContext(c, estate);
        await administrator(c, scope.customer_id);
        await placementLock(c, scope.customer_id);
        await context(c, res, input.reason);
        const item = (
          await c.query(
            "SELECT * FROM eoms.placement_move_requests WHERE id=$1 AND estate_id=$2",
            [id, estate],
          )
        ).rows[0];
        if (!item)
          throw new ApiError(
            404,
            "Move request is not available in this estate.",
          );
        if (item.requester_id === res.locals.user.id)
          throw new ApiError(
            403,
            "An independent setup reviewer must decide this move. You cannot review your own request.",
          );
        if (
          (
            await c.query(
              "SELECT id FROM eoms.placement_move_decisions WHERE move_request_id=$1",
              [id],
            )
          ).rowCount
        )
          throw new ApiError(
            409,
            "This move already has a decision. Refresh the history.",
          );
        const current = (
          await c.query(
            "SELECT area_id,placement_version FROM eoms.estates WHERE id=$1 FOR UPDATE",
            [estate],
          )
        ).rows[0];
        if (current.placement_version !== input.version)
          throw new ApiError(
            409,
            "Placement changed. Refresh before reviewing this move.",
          );
        if (input.decision === "approved") {
          if (
            current.placement_version !== item.expected_version ||
            current.area_id !== item.from_area_id
          )
            throw new ApiError(
              409,
              "Placement changed after the request. Reject this stale request and prepare a new one.",
            );
          await destination(c, scope.customer_id, item.to_area_id);
        }
        return (
          await c.query(
            "INSERT INTO eoms.placement_move_decisions(move_request_id,estate_id,customer_id,decision,reason) VALUES($1,$2,$3,$4,$5) RETURNING id,decision,request_id",
            [id, estate, scope.customer_id, input.decision, input.reason],
          )
        ).rows[0];
      });
      res.status(201).json(row);
    },
  );
  app.post(
    "/api/customers/:customerId/areas/:areaId/lifecycle",
    async (req, res) => {
      const customer = uuid.parse(req.params.customerId),
        id = uuid.parse(req.params.areaId),
        input = z
          .object({ active: z.boolean(), version, reason })
          .strict()
          .parse(req.body);
      res.json(
        await tx(res, async (c) => {
          await administrator(c, customer);
          await visibleCustomer(c, customer);
          await placementLock(c, customer);
          await context(c, res, input.reason);
          const current = (
            await c.query(
              "SELECT * FROM eoms.operating_areas WHERE id=$1 AND customer_id=$2 FOR UPDATE",
              [id, customer],
            )
          ).rows[0];
          if (!current)
            throw new ApiError(
              404,
              "Operating area is not available in your scope.",
            );
          if (current.version !== input.version)
            throw new ApiError(
              409,
              "Operating area changed. Refresh and review its current status.",
            );
          if (current.active === input.active)
            throw new ApiError(
              409,
              "Area already has this status. Refresh the history.",
            );
          if (
            !input.active &&
            (
              await c.query(
                "SELECT eoms.area_has_dependencies($1,$2) AS blocked",
                [id, customer],
              )
            ).rows[0].blocked
          )
            throw new ApiError(
              409,
              "Move all assigned estates and deactivate active child areas first. Some dependencies may be outside your estate access; ask the customer administrator to coordinate.",
            );
          if (
            input.active &&
            current.parent_id &&
            !(
              await c.query(
                "SELECT id FROM eoms.operating_areas WHERE id=$1 AND active",
                [current.parent_id],
              )
            ).rowCount
          )
            throw new ApiError(
              409,
              "Reactivate the parent region before this business unit.",
            );
          return (
            await c.query(
              "UPDATE eoms.operating_areas SET active=$3,version=version+1 WHERE id=$1 AND customer_id=$2 RETURNING id,active,version",
              [id, customer, input.active],
            )
          ).rows[0];
        }),
      );
    },
  );
}
