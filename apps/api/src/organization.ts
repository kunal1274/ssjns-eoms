import type { Express, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
export type Transaction = <T>(
  res: Response,
  fn: (client: PoolClient) => Promise<T>,
) => Promise<T>;
export function organizationRoutes(app: Express, tx: Transaction) {
  app.get("/api/organization", async (_req, res) => {
    const rows = await tx(
      res,
      async (client) =>
        (
          await client.query(
            `SELECT t.id AS customer_id,t.code AS customer_code,t.name AS customer_name,
       c.id AS company_id,c.name AS company_name,e.id AS estate_id,e.code AS estate_code,e.name AS estate_name
       FROM eoms.estates e JOIN eoms.companies c ON c.id=e.company_id AND c.customer_id=e.customer_id
       JOIN eoms.customers t ON t.id=c.customer_id ORDER BY t.name,c.name,e.name,e.id LIMIT 201`,
          )
        ).rows,
    );
    res.json({ items: rows.slice(0, 200), truncated: rows.length > 200 });
  });
  app.get("/api/customers/:customerId/history", async (req, res) => {
    const id = z.string().uuid().parse(req.params.customerId);
    res.json(
      await tx(res, async (client) => {
        if (
          !(
            await client.query("SELECT id FROM eoms.customers WHERE id=$1", [
              id,
            ])
          ).rowCount
        )
          throw new ApiError(404, "Customer is not available in your scope");
        const rows = (
          await client.query(
            `SELECT h.id,h.action,h.created_at,coalesce(u.display_name,'System / migration') AS actor,
        h.detail#>>'{before,code}' AS before_code,h.detail#>>'{before,name}' AS before_name,
        h.detail#>>'{after,code}' AS after_code,h.detail#>>'{after,name}' AS after_name,
        h.detail->>'requestId' AS request_id FROM eoms.customer_history h
        LEFT JOIN eoms.users u ON u.id=h.actor_id WHERE h.customer_id=$1 ORDER BY h.id DESC LIMIT 51`,
            [id],
          )
        ).rows;
        return {
          items: rows.slice(0, 50).map((row) => ({
            ...row,
            request_id: z.string().uuid().safeParse(row.request_id).success
              ? row.request_id
              : null,
          })),
          truncated: rows.length > 50,
        };
      }),
    );
  });
}
