import type { Express } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
const uuid = z.string().uuid();
const intent = {
  customerId: uuid,
  reference: z.string().trim().min(5).max(200),
  reason: z.string().trim().min(10).max(500),
  reviewed: z.literal(true),
};
export function customerInvitationRoutes(app: Express, pool: Pool) {
  app.get("/api/auth/customer-invitations", async (req, res) => {
    const i = z
      .object({
        customerId: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(25).default(10),
        cursor: z.string().max(1000).optional(),
      })
      .strict()
      .parse(req.query);
    let after: string | null = null;
    if (i.cursor)
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(i.cursor)) throw Error();
        const c = z
          .object({
            actor: uuid,
            customer: uuid.nullable(),
            limit: z.number(),
            after: uuid,
          })
          .strict()
          .parse(JSON.parse(Buffer.from(i.cursor, "base64url").toString()));
        if (
          c.actor !== res.locals.user.id ||
          c.customer !== (i.customerId ?? null) ||
          c.limit !== i.limit
        )
          throw Error();
        after = c.after;
      } catch {
        throw new ApiError(
          422,
          "This invitation page is invalid. Refresh the invitation list.",
        );
      }
    const v = (
      await pool.query("SELECT eoms.customer_join_page($1,$2,$3,$4) AS value", [
        res.locals.sessionHash,
        i.customerId ?? null,
        after,
        i.limit,
      ])
    ).rows[0].value;
    const more = v.items.length > i.limit;
    v.items = v.items.slice(0, i.limit);
    v.nextCursor = more
      ? Buffer.from(
          JSON.stringify({
            actor: res.locals.user.id,
            customer: i.customerId ?? null,
            limit: i.limit,
            after: v.items.at(-1).id,
          }),
        ).toString("base64url")
      : null;
    res.json(v);
  });
  app.post("/api/auth/customer-invitations", async (req, res) => {
    const e = z
      .object({
        operation: z.enum(["prepare", "cancel", "accept", "decline"]),
        key: uuid,
        input: z.unknown(),
      })
      .strict()
      .parse(req.body);
    const input =
      e.operation === "prepare"
        ? z
            .object({
              ...intent,
              targetId: uuid,
              userCode: z.string().trim().min(1).max(50),
              employeeReference: z.string().trim().min(1).max(100),
              replaceId: uuid.nullable().default(null),
              estates: z
                .array(
                  z
                    .object({
                      estateId: uuid,
                      role: z.enum(["manager", "supervisor", "clerk"]),
                    })
                    .strict(),
                )
                .min(1)
                .max(100)
                .refine(
                  (v) => new Set(v.map((x) => x.estateId)).size === v.length,
                ),
            })
            .strict()
            .parse(e.input)
        : z
            .object({ ...intent, invitationId: uuid })
            .strict()
            .parse(e.input);
    res.json(
      (
        await pool.query(
          "SELECT eoms.customer_join_write($1,$2,$3,$4,$5,$6) AS value",
          [
            res.locals.sessionHash,
            req.get("X-CSRF-Token"),
            e.operation,
            JSON.stringify(input),
            e.key,
            res.locals.requestId,
          ],
        )
      ).rows[0].value,
    );
  });
}
