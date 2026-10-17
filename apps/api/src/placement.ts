import type { Express } from "express";
import { placementLock } from "./placement-governance";
import { z } from "zod";
import { ApiError } from "./http";
import type { Transaction } from "./organization";
import {
  administrator,
  context,
  estateContext,
  visibleCustomer,
} from "./hierarchy";
const uuid = z.string().uuid(),
  reason = z.string().trim().min(3).max(500),
  code = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/),
  name = z.string().trim().min(1).max(160);
export function placementRoutes(app: Express, tx: Transaction) {
  app.get("/api/customers/:customerId/placements", async (req, res) => {
    const customer = uuid.parse(req.params.customerId);
    res.json(
      await tx(res, async (c) => {
        await visibleCustomer(c, customer);
        const areas = (
          await c.query(
            "SELECT id,kind,code,name,parent_id,version,active FROM eoms.operating_areas WHERE customer_id=$1 ORDER BY kind,code,id LIMIT 201",
            [customer],
          )
        ).rows;
        const estates = (
          await c.query(
            "SELECT id,code,name,company_id,area_id,placement_version FROM eoms.estates WHERE customer_id=$1 ORDER BY name,id LIMIT 201",
            [customer],
          )
        ).rows;
        return {
          areas: areas.slice(0, 200),
          estates: estates.slice(0, 200),
          canConfigure: (
            await c.query("SELECT eoms.can_manage_customer($1) AS allowed", [
              customer,
            ])
          ).rows[0].allowed,
          truncated: areas.length > 200 || estates.length > 200,
        };
      }),
    );
  });
  app.post("/api/customers/:customerId/areas", async (req, res) => {
    const customer = uuid.parse(req.params.customerId),
      input = z
        .object({
          kind: z.enum(["region", "business-unit"]),
          code,
          name,
          parentId: uuid.nullable(),
          reason,
        })
        .strict()
        .parse(req.body);
    const row = await tx(res, async (c) => {
      await administrator(c, customer);
      await visibleCustomer(c, customer);
      await placementLock(c, customer);
      await context(c, res, input.reason);
      return (
        await c.query(
          "INSERT INTO eoms.operating_areas(customer_id,kind,code,name,parent_id) VALUES($1,$2,$3,$4,$5) RETURNING id,kind,code,name,parent_id,version",
          [customer, input.kind, input.code, input.name, input.parentId],
        )
      ).rows[0];
    });
    res.status(201).json(row);
  });
  app.post("/api/customers/:customerId/areas/:areaId", async (req, res) => {
    const customer = uuid.parse(req.params.customerId),
      area = uuid.parse(req.params.areaId),
      input = z
        .object({ code, name, version: z.number().int().positive(), reason })
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
            "SELECT id FROM eoms.operating_areas WHERE id=$1 AND customer_id=$2",
            [area, customer],
          )
        ).rows[0];
        if (!current)
          throw new ApiError(
            404,
            "Operating area is not available in your scope",
          );
        const row = (
          await c.query(
            "UPDATE eoms.operating_areas SET code=$3,name=$4,version=version+1 WHERE id=$1 AND customer_id=$2 AND version=$5 RETURNING id,kind,code,name,parent_id,version",
            [area, customer, input.code, input.name, input.version],
          )
        ).rows[0];
        if (!row)
          throw new ApiError(
            409,
            "Operating area changed. Refresh and choose Edit again.",
          );
        return row;
      }),
    );
  });
  app.post("/api/estates/:estateId/placement", async (req, res) => {
    const id = uuid.parse(req.params.estateId),
      input = z
        .object({ areaId: uuid, version: z.number().int().positive(), reason })
        .strict()
        .parse(req.body);
    res.json(
      await tx(res, async (c) => {
        const estate = await estateContext(c, id);
        await administrator(c, estate.customer_id);
        await placementLock(c, estate.customer_id);
        await context(c, res, input.reason);
        const before = (
          await c.query(
            "SELECT area_id,placement_version FROM eoms.estates WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (before.placement_version !== input.version)
          throw new ApiError(
            409,
            "Estate placement changed. Refresh and review again.",
          );
        if (before.area_id || before.placement_version !== 1)
          throw new ApiError(
            409,
            "This estate already has a placement. Reassignment requires the planned governed move workflow.",
          );
        if (
          !(
            await c.query(
              "SELECT id FROM eoms.operating_areas WHERE id=$1 AND customer_id=$2 AND active FOR SHARE",
              [input.areaId, estate.customer_id],
            )
          ).rowCount
        )
          throw new ApiError(
            422,
            "Choose an active region or business unit in this customer.",
          );
        return (
          await c.query(
            "UPDATE eoms.estates SET area_id=$2,placement_version=placement_version+1 WHERE id=$1 RETURNING id,company_id,area_id,placement_version",
            [id, input.areaId],
          )
        ).rows[0];
      }),
    );
  });
}
