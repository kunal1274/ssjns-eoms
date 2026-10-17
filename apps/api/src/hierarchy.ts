import type { Express, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import type { Transaction } from "./organization";
const uuid = z.string().uuid(),
  reason = z.string().trim().min(3).max(500),
  code = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/),
  name = z.string().trim().min(1).max(160);
const unit = z
  .object({
    kind: z.enum(["division", "field", "block"]),
    code,
    name,
    parentId: uuid.nullable(),
    reason,
  })
  .strict();
const updateUnit = unit.extend({ version: z.number().int().positive() });
export async function visibleCustomer(c: PoolClient, id: string) {
  if (
    !(await c.query("SELECT id FROM eoms.customers WHERE id=$1", [id])).rowCount
  )
    throw new ApiError(404, "Customer is not available in your scope");
}
export async function administrator(c: PoolClient, id: string) {
  if (
    !(await c.query("SELECT eoms.can_manage_customer($1) AS allowed", [id]))
      .rows[0].allowed
  )
    throw new ApiError(
      403,
      "Hierarchy setup permission is required for this customer",
    );
}
export async function context(c: PoolClient, res: Response, text: string) {
  await c.query(
    "SELECT set_config('app.change_reason',$1,true),set_config('app.request_id',$2,true)",
    [text, res.locals.requestId],
  );
}
export async function estateContext(c: PoolClient, id: string) {
  const row = (
    await c.query("SELECT id,customer_id FROM eoms.estates WHERE id=$1", [id])
  ).rows[0];
  if (!row) throw new ApiError(404, "Estate is not available in your scope");
  return row;
}
export function hierarchyRoutes(app: Express, tx: Transaction) {
  app.get("/api/customers/:customerId/hierarchy", async (req, res) => {
    const id = uuid.parse(req.params.customerId);
    res.json(
      await tx(res, async (c) => {
        await visibleCustomer(c, id);
        const groups = (
          await c.query(
            "SELECT id,code,name,version FROM eoms.customer_groups WHERE customer_id=$1 ORDER BY code,id LIMIT 201",
            [id],
          )
        ).rows;
        const companies = (
          await c.query(
            "SELECT id,name,group_id,hierarchy_version FROM eoms.companies WHERE customer_id=$1 ORDER BY name,id LIMIT 201",
            [id],
          )
        ).rows;
        const estates = (
          await c.query(
            "SELECT id,code,name,active,lifecycle_version FROM eoms.estates WHERE customer_id=$1 ORDER BY name,id LIMIT 201",
            [id],
          )
        ).rows;
        const canConfigure = (
          await c.query("SELECT eoms.can_manage_customer($1) AS allowed", [id])
        ).rows[0].allowed;
        return {
          groups: groups.slice(0, 200),
          companies: companies.slice(0, 200),
          estates: estates.slice(0, 200),
          canConfigure,
          truncated: [groups, companies, estates].some(
            (rows) => rows.length > 200,
          ),
        };
      }),
    );
  });
  app.get("/api/estates/:estateId/units", async (req, res) => {
    const id = uuid.parse(req.params.estateId);
    res.json(
      await tx(res, async (c) => {
        await estateContext(c, id);
        const rows = (
          await c.query(
            "SELECT id,kind,code,name,parent_id,version,active FROM eoms.operating_units WHERE estate_id=$1 ORDER BY kind,code,id LIMIT 501",
            [id],
          )
        ).rows;
        return { items: rows.slice(0, 500), truncated: rows.length > 500 };
      }),
    );
  });
  app.post("/api/customers/:customerId/groups", async (req, res) => {
    const id = uuid.parse(req.params.customerId);
    res.status(201).json(
      await tx(res, async (c) => {
        await administrator(c, id);
        await visibleCustomer(c, id);
        const input = z.object({ code, name, reason }).strict().parse(req.body);
        await context(c, res, input.reason);
        return (
          await c.query(
            "INSERT INTO eoms.customer_groups(customer_id,code,name) VALUES($1,$2,$3) RETURNING id,code,name,version",
            [id, input.code, input.name],
          )
        ).rows[0];
      }),
    );
  });
  app.post(
    "/api/customers/:customerId/companies/:companyId/group",
    async (req, res) => {
      const id = uuid.parse(req.params.customerId),
        company = uuid.parse(req.params.companyId);
      res.json(
        await tx(res, async (c) => {
          await administrator(c, id);
          await visibleCustomer(c, id);
          const input = z
            .object({
              groupId: uuid.nullable(),
              version: z.number().int().positive(),
              reason,
            })
            .strict()
            .parse(req.body);
          if (
            !(
              await c.query(
                "SELECT id FROM eoms.companies WHERE id=$1 AND customer_id=$2",
                [company, id],
              )
            ).rowCount
          )
            throw new ApiError(404, "Company is not available in your scope");
          await context(c, res, input.reason);
          const row = (
            await c.query(
              "UPDATE eoms.companies SET group_id=$3,hierarchy_version=hierarchy_version+1 WHERE id=$1 AND customer_id=$2 AND hierarchy_version=$4 RETURNING id,name,group_id,hierarchy_version",
              [company, id, input.groupId, input.version],
            )
          ).rows[0];
          if (!row)
            throw new ApiError(
              409,
              "Company hierarchy changed. Refresh the list before editing again.",
            );
          return row;
        }),
      );
    },
  );
  app.post("/api/estates/:estateId/units", async (req, res) => {
    const id = uuid.parse(req.params.estateId);
    res.status(201).json(
      await tx(res, async (c) => {
        const estate = await estateContext(c, id);
        await administrator(c, estate.customer_id);
        const input = unit.parse(req.body);
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text,601))",
          [id],
        );
        await context(c, res, input.reason);
        return (
          await c.query(
            "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,kind,code,name,parent_id,version",
            [
              estate.customer_id,
              id,
              input.kind,
              input.code,
              input.name,
              input.parentId,
            ],
          )
        ).rows[0];
      }),
    );
  });
  app.post("/api/estates/:estateId/units/:unitId", async (req, res) => {
    const id = uuid.parse(req.params.estateId),
      record = uuid.parse(req.params.unitId);
    res.json(
      await tx(res, async (c) => {
        const estate = await estateContext(c, id);
        await administrator(c, estate.customer_id);
        const input = updateUnit.parse(req.body);
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text,601))",
          [id],
        );
        const current = (
          await c.query(
            "SELECT kind FROM eoms.operating_units WHERE id=$1 AND estate_id=$2",
            [record, id],
          )
        ).rows[0];
        if (!current)
          throw new ApiError(404, "Unit is not available in your scope");
        if (current.kind !== input.kind)
          throw new ApiError(
            409,
            "Unit type cannot be changed. Create the correct unit instead.",
          );
        await context(c, res, input.reason);
        const row = (
          await c.query(
            "UPDATE eoms.operating_units SET code=$3,name=$4,parent_id=$5,version=version+1 WHERE id=$1 AND estate_id=$2 AND version=$6 RETURNING id,kind,code,name,parent_id,version",
            [record, id, input.code, input.name, input.parentId, input.version],
          )
        ).rows[0];
        if (!row)
          throw new ApiError(
            409,
            "Unit changed. Refresh the list and choose Edit again.",
          );
        return row;
      }),
    );
  });
  app.get("/api/customers/:customerId/hierarchy/history", async (req, res) => {
    const id = uuid.parse(req.params.customerId);
    res.json(
      await tx(res, async (c) => {
        await visibleCustomer(c, id);
        const rows = (
          await c.query(
            `SELECT h.id,h.record_id,h.record_type,h.action,h.reason,h.request_id,h.created_at,coalesce(u.display_name,'System / migration') AS actor,
 jsonb_build_object('code',h.before_state->'code','name',h.before_state->'name','kind',h.before_state->'kind','parentId',h.before_state->'parentId','groupId',h.before_state->'groupId','version',h.before_state->'version','active',h.before_state->'active','moveDecisionId',h.before_state->'moveDecisionId') AS before,
 jsonb_build_object('code',h.after_state->'code','name',h.after_state->'name','kind',h.after_state->'kind','parentId',h.after_state->'parentId','groupId',h.after_state->'groupId','version',h.after_state->'version','active',h.after_state->'active','moveDecisionId',h.after_state->'moveDecisionId') AS after
 FROM eoms.hierarchy_history h LEFT JOIN eoms.users u ON u.id=h.actor_id WHERE h.customer_id=$1 ORDER BY h.id DESC LIMIT 51`,
            [id],
          )
        ).rows;
        return { items: rows.slice(0, 50), truncated: rows.length > 50 };
      }),
    );
  });
}
