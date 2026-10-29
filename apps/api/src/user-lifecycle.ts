import type { Express } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
const revision = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(19)
  .refine(
    (v) =>
      /^[0-9]+$/.test(v) && v.length <= 19 && BigInt(v) <= 9223372036854775807n,
  );
export function userLifecycleRoutes(app: Express, pool: Pool) {
  app.get("/api/auth/lifecycle/context", async (req, res) => {
    const input = z
      .object({
        targetId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(25).default(10),
        cursor: z.string().max(1000).optional(),
      })
      .strict()
      .parse(req.query);
    let after: string | null = null;
    if (input.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw Error();
        const c = z
          .object({
            actor: z.string().uuid(),
            target: z.string().uuid(),
            limit: z.number(),
            after: revision,
          })
          .strict()
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
        if (
          c.actor !== res.locals.user.id ||
          c.target !== input.targetId ||
          c.limit !== input.limit ||
          c.after === "0"
        )
          throw Error();
        after = c.after;
      } catch {
        throw new ApiError(
          422,
          "This history page is invalid. Preview the account again.",
        );
      }
    }
    const v = (
      await pool.query("SELECT eoms.lifecycle_context($1,$2,$3,$4) AS value", [
        res.locals.sessionHash,
        input.targetId ?? null,
        after,
        input.limit,
      ])
    ).rows[0].value;
    if (!v.items) {
      res.json(v);
      return;
    }
    const more = v.items.length > input.limit,
      items = v.items.slice(0, input.limit);
    res.json({
      ...v,
      items,
      nextCursor: more
        ? Buffer.from(
            JSON.stringify({
              actor: res.locals.user.id,
              target: input.targetId,
              limit: input.limit,
              after: items.at(-1).id,
            }),
          ).toString("base64url")
        : null,
    });
  });
  app.post("/api/auth/lifecycle/change", async (req, res) => {
    const i = z
      .object({
        targetId: z.string().uuid(),
        revision,
        state: z.enum(["active", "suspended", "deactivated"]),
        key: z.string().uuid(),
        reference: z.string().trim().min(5).max(200),
        reason: z.string().trim().min(10).max(500),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    const r = await pool.query(
      "SELECT eoms.change_user_lifecycle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value",
      [
        res.locals.sessionHash,
        req.get("X-CSRF-Token"),
        i.targetId,
        i.revision,
        i.state,
        i.key,
        i.reference,
        i.reason,
        i.reviewed,
        res.locals.requestId,
      ],
    );
    res.json(r.rows[0].value);
  });
}
