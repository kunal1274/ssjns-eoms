import type { Express } from "express";
import type { Transaction } from "./organization";
import { ApiError } from "./http";
import {
  customerProvisionInput,
  companyProvisionInput,
  estateProvisionInput,
} from "../../../packages/domain/provisioning";
import { z } from "zod";
import { pageFields, readPage, pageResult } from "./navigation-page";
export function provisioningRoutes(app: Express, tx: Transaction) {
  app.get("/api/provisioning/capabilities", async (req, res) => {
    const q = z
      .object({ customerId: z.string().uuid().optional() })
      .strict()
      .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await tx(res, async (c) => ({
        canManageCustomer: q.customerId
          ? (
              await c.query("SELECT eoms.can_manage_customer($1) AS ok", [
                q.customerId,
              ])
            ).rows[0].ok
          : false,
        canBootstrap: (
          await c.query("SELECT eoms.can_bootstrap_customer() AS ok")
        ).rows[0].ok,
        actorId: res.locals.user.id,
      })),
    );
  });
  app.get("/api/customers/:customerId/provisioning", async (req, res) => {
    const customer = z.string().uuid().parse(req.params.customerId),
      q = z
        .object({ limit: pageFields.limit, cursor: pageFields.cursor })
        .strict()
        .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await tx(res, async (c) => {
        const allowed = (
          await c.query("SELECT eoms.can_manage_customer($1) AS ok", [customer])
        ).rows[0].ok;
        if (!allowed)
          throw new ApiError(
            403,
            "Explicit customer setup authority is required for provisioning.",
          );
        const binding = {
            kind: "provision-history",
            customer,
            actor: res.locals.user.id,
            limit: q.limit,
          },
          p = readPage(q.cursor, binding),
          rows = (
            await c.query(
              "SELECT * FROM eoms.hierarchy_provision_receipts WHERE customer_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
              [customer, p?.key ?? null, q.limit + 1],
            )
          ).rows;
        return {
          ...pageResult(rows, q.limit, binding, (r) => r.id),
          actorId: res.locals.user.id,
        };
      }),
    );
  });
  for (const [operation, schema] of [
    ["customer", customerProvisionInput],
    ["company", companyProvisionInput],
    ["estate", estateProvisionInput],
  ] as const)
    app.post("/api/provisioning/" + operation, async (req, res) => {
      const { key, ...input } = schema.parse(req.body);
      res.json(
        await tx(res, async (c) => {
          await c.query("SELECT set_config('app.request_id',$1,true)", [
            res.locals.requestId,
          ]);
          try {
            return (
              await c.query(
                "SELECT eoms.provision_hierarchy($1,$2::jsonb,$3) AS value",
                [operation, JSON.stringify(input), key],
              )
            ).rows[0].value;
          } catch (e) {
            if ((e as { code?: string }).code === "23505")
              throw new ApiError(
                409,
                "This business code or retry reference already exists. Refresh the current organization and inspect the receipt; retry only the unchanged uncertain submission.",
              );
            throw e;
          }
        }),
      );
    });
}
