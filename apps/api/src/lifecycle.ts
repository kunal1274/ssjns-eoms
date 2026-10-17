import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import { administrator, context, estateContext } from "./hierarchy";
import type { Transaction } from "./organization";
export async function lifecycleLock(c: PoolClient, estate: string) {
  await c.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text,601))",
    [estate],
  );
}
export async function assertTaskAvailable(
  c: PoolClient,
  estate: string,
  block: string | null,
) {
  if (
    !(
      await c.query("SELECT eoms.task_is_available($1,$2) AS available", [
        estate,
        block,
      ])
    ).rows[0].available
  )
    throw new ApiError(
      409,
      "Work is paused: this estate or configured block is inactive. Ask a setup administrator to reactivate it in Organization → Estate and unit availability, then refresh tasks. Recorded work remains available.",
    );
}
export function lifecycleRoutes(app: Express, tx: Transaction) {
  const uuid = z.string().uuid(),
    input = z
      .object({
        active: z.boolean(),
        version: z.number().int().positive(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict();
  app.get("/api/estates/:estateId/lifecycle", async (req, res) => {
    const id = uuid.parse(req.params.estateId);
    res.json(
      await tx(res, async (c) => {
        const scope = await estateContext(c, id);
        const estate = (
          await c.query(
            "SELECT id,name,active,lifecycle_version FROM eoms.estates WHERE id=$1",
            [id],
          )
        ).rows[0];
        const units = (
          await c.query(
            "SELECT id,kind,code,name,parent_id,active,version FROM eoms.operating_units WHERE estate_id=$1 ORDER BY kind,code,id LIMIT 501",
            [id],
          )
        ).rows;
        const history = (
          await c.query(
            "SELECT h.id,h.record_id,h.record_type,h.reason,h.request_id,h.created_at,h.before_state AS before,h.after_state AS after,u.display_name AS actor FROM eoms.hierarchy_history h LEFT JOIN eoms.users u ON u.id=h.actor_id WHERE h.estate_id=$1 AND h.record_type IN ('estate-lifecycle','unit-lifecycle') ORDER BY h.id DESC LIMIT 51",
            [id],
          )
        ).rows;
        const counts = (
          await c.query(
            "SELECT count(*) FILTER(WHERE status='draft')::int AS drafts FROM eoms.musters WHERE estate_id=$1",
            [id],
          )
        ).rows[0];
        return {
          estate,
          units: units.slice(0, 500),
          history: history.slice(0, 50),
          drafts: counts.drafts,
          canConfigure: (
            await c.query("SELECT eoms.can_manage_customer($1) AS allowed", [
              scope.customer_id,
            ])
          ).rows[0].allowed,
          truncated: units.length > 500 || history.length > 50,
        };
      }),
    );
  });
  for (const target of ["estate", "unit"] as const) {
    const route =
      target === "estate"
        ? "/api/estates/:estateId/lifecycle"
        : "/api/estates/:estateId/units/:unitId/lifecycle";
    app.post(route, async (req, res) => {
      const id = uuid.parse(req.params.estateId),
        record =
          target === "estate"
            ? id
            : uuid.parse((req.params as Record<string, string>).unitId),
        body = input.parse(req.body);
      res.json(
        await tx(res, async (c) => {
          const scope = await estateContext(c, id);
          await administrator(c, scope.customer_id);
          await lifecycleLock(c, id);
          await context(c, res, body.reason);
          const current = (
            await c.query(
              target === "estate"
                ? "SELECT id,active,lifecycle_version AS version FROM eoms.estates WHERE id=$1 FOR UPDATE"
                : "SELECT id,active,version,parent_id FROM eoms.operating_units WHERE id=$1 AND estate_id=$2 FOR UPDATE",
              target === "estate" ? [id] : [record, id],
            )
          ).rows[0];
          if (!current)
            throw new ApiError(
              404,
              "Operating unit is not available in this estate.",
            );
          if (current.version !== body.version)
            throw new ApiError(
              409,
              "Availability changed. Refresh and review the latest status and version.",
            );
          if (current.active === body.active)
            throw new ApiError(
              409,
              "This status is already saved. Refresh the history.",
            );
          if (!body.active) {
            if (
              target === "unit" &&
              (
                await c.query(
                  "SELECT id FROM eoms.operating_units WHERE estate_id=$1 AND parent_id=$2 AND active LIMIT 1",
                  [id, record],
                )
              ).rowCount
            )
              throw new ApiError(
                409,
                "Deactivate active child units first: block → field → division.",
              );
            const pending =
              target === "estate"
                ? await c.query(
                    "SELECT id FROM eoms.musters WHERE estate_id=$1 AND status='draft' LIMIT 1",
                    [id],
                  )
                : await c.query(
                    "SELECT m.id FROM eoms.musters m JOIN eoms.occurrences o ON o.id=m.occurrence_id AND o.estate_id=m.estate_id WHERE m.estate_id=$1 AND o.block_unit_id=$2 AND m.status='draft' LIMIT 1",
                    [id, record],
                  );
            if (pending.rowCount)
              throw new ApiError(
                409,
                "Resolve draft work in the Muster register before deactivation. Confirm valid drafts under the existing period/capacity rules; no draft is deleted or silently cancelled.",
              );
          } else if (target === "unit") {
            await assertTaskAvailable(c, id, current.parent_id);
          }
          return (
            await c.query(
              target === "estate"
                ? "UPDATE eoms.estates SET active=$2,lifecycle_version=lifecycle_version+1 WHERE id=$1 RETURNING id,active,lifecycle_version"
                : "UPDATE eoms.operating_units SET active=$3,version=version+1 WHERE id=$1 AND estate_id=$2 RETURNING id,active,version",
              target === "estate"
                ? [id, body.active]
                : [record, id, body.active],
            )
          ).rows[0];
        }),
      );
    });
  }
}
