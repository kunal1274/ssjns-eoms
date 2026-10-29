import type { Express } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
export function accountSecurityRoutes(app: Express, pool: Pool) {
  app.get("/api/auth/admin/context", async (req, res) => {
    const input = z
      .object({ targetId: z.string().uuid().optional() })
      .strict()
      .parse(req.query);
    const result = await pool.query(
      "SELECT eoms.security_operator_context($1,$2) AS value",
      [res.locals.sessionHash, input.targetId ?? null],
    );
    res.json(result.rows[0].value);
  });
  app.post("/api/auth/admin/revoke", async (req, res) => {
    const input = z
      .object({
        targetId: z.string().uuid(),
        revision: z
          .string()
          .regex(/^(0|[1-9][0-9]*)$/)
          .max(19)
          .refine(
            (v) =>
              v.length <= 19 &&
              /^[0-9]+$/.test(v) &&
              BigInt(v) <= 9223372036854775807n,
          ),
        key: z.string().uuid(),
        reference: z.string().trim().min(5).max(200),
        reason: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(req.body);
    const result = await pool.query(
      "SELECT eoms.security_operator_revoke($1,$2,$3,$4,$5,$6,$7,$8) AS value",
      [
        res.locals.sessionHash,
        req.get("X-CSRF-Token"),
        input.targetId,
        input.revision,
        input.key,
        input.reference,
        input.reason,
        res.locals.requestId,
      ],
    );
    res.json(result.rows[0].value);
  });
  for (const view of ["sessions", "events"] as const) {
    app.get("/api/auth/" + view, async (req, res) => {
      const input = z
        .object({
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
              view: z.enum(["sessions", "events"]),
              limit: z.number(),
              after: z.string().max(50),
            })
            .strict()
            .parse(
              JSON.parse(Buffer.from(input.cursor, "base64url").toString()),
            );
          if (
            c.actor !== res.locals.user.id ||
            c.view !== view ||
            c.limit !== input.limit ||
            !(view === "sessions"
              ? z.string().uuid().safeParse(c.after).success
              : /^[1-9][0-9]*$/.test(c.after) &&
                c.after.length <= 19 &&
                BigInt(c.after) <= 9223372036854775807n)
          )
            throw Error();
          after = c.after;
        } catch {
          throw new ApiError(
            422,
            "This page link is invalid. Refresh the list.",
          );
        }
      }
      const result = (
        await pool.query("SELECT eoms.account_security($1,$2,$3,$4) AS value", [
          res.locals.sessionHash,
          view,
          after,
          input.limit,
        ])
      ).rows[0].value;
      const more = result.items.length > input.limit,
        items = result.items.slice(0, input.limit);
      res.json({
        items,
        nextCursor: more
          ? Buffer.from(
              JSON.stringify({
                actor: res.locals.user.id,
                view,
                limit: input.limit,
                after: items.at(-1).id,
              }),
            ).toString("base64url")
          : null,
        currentSessionId: result.currentSessionId,
      });
    });
  }
  app.post("/api/auth/sessions/revoke", async (req, res) => {
    const input = z
      .object({
        key: z.string().uuid(),
        targetId: z.string().uuid().nullable(),
        allOthers: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const result = await pool.query(
      "SELECT eoms.revoke_account_sessions($1,$2,$3,$4,$5,$6) AS value",
      [
        res.locals.sessionHash,
        req.get("X-CSRF-Token"),
        input.key,
        input.targetId,
        input.allOthers,
        res.locals.requestId,
      ],
    );
    res.json(result.rows[0].value);
  });
}
