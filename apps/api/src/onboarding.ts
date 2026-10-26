import type { Express } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import { hash, passwordHash } from "./security";
const reference = z.string().trim().min(5).max(200),
  reason = z.string().trim().min(10).max(500),
  customerId = z.string().uuid().nullable(),
  targetId = z.string().uuid(),
  revision = z.number().int().min(0).max(2147483646);
const shared = { customerId, reference, reason };
export function publicOnboardingRoutes(app: Express, pool: Pool) {
  app.post("/api/auth/enrollment/accept", async (req, res) => {
    if (process.env.NODE_ENV === "production")
      throw new ApiError(
        403,
        "Use your approved organization invitation sign-in.",
      );
    const i = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password: z
          .string()
          .min(12)
          .max(128)
          .refine(
            (v) =>
              !["password1234", "123456789012", "qwerty123456"].includes(
                v.toLowerCase(),
              ),
          ),
      })
      .strict()
      .parse(req.body);
    const allowed = (
      await pool.query("SELECT eoms.auth_attempt_allowed($1,20) AS allowed", [
        hash("enrollment:" + req.ip),
      ])
    ).rows[0].allowed;
    if (!allowed)
      throw new ApiError(429, "Too many invitation attempts. Try again later.");
    let r;
    try {
      r = await pool.query(
        "SELECT eoms.accept_user_invitation($1,'local',$2,NULL,NULL,$3) AS value",
        [hash(i.token), await passwordHash(i.password), res.locals.requestId],
      );
    } catch (e) {
      if ((e as any).code === "22023")
        throw new ApiError(
          422,
          "This invitation is unavailable, expired or already used. Try signing in if you already accepted it; otherwise ask your administrator for a new invitation.",
        );
      if ((e as any).code === "40001")
        throw new ApiError(
          409,
          "The registration or an assigned estate changed. Ask your administrator to review the registration and prepare a new invitation.",
        );
      throw e;
    }
    res.json({
      ...r.rows[0].value,
      message:
        "Invitation accepted. Sign in with your email and the password you chose. If a previous response was lost, try signing in before requesting another invitation.",
    });
  });
}
export function onboardingRoutes(app: Express, pool: Pool, issuer?: string) {
  app.get("/api/auth/access-manifest", async (_req, res) =>
    res.json({
      ...(
        await pool.query("SELECT eoms.user_access_manifest($1) AS value", [
          res.locals.sessionHash,
        ])
      ).rows[0].value,
      requestId: res.locals.requestId,
    }),
  );
  app.get("/api/auth/onboarding/users", async (req, res) => {
    const i = z
      .object({
        customerId: targetId.optional(),
        q: z.string().trim().max(100).default(""),
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
            actor: targetId,
            customer: customerId,
            q: z.string(),
            limit: z.number(),
            after: targetId,
          })
          .strict()
          .parse(JSON.parse(Buffer.from(i.cursor, "base64url").toString()));
        if (
          c.actor !== res.locals.user.id ||
          c.customer !== (i.customerId ?? null) ||
          c.q !== i.q ||
          c.limit !== i.limit
        )
          throw Error();
        after = c.after;
      } catch {
        throw new ApiError(
          422,
          "This user search page is invalid. Search again.",
        );
      }
    const rows = (
        await pool.query(
          "SELECT * FROM eoms.onboarding_users($1,$2,$3,$4,$5)",
          [res.locals.sessionHash, i.customerId ?? null, i.q, after, i.limit],
        )
      ).rows,
      more = rows.length > i.limit,
      items = rows.slice(0, i.limit);
    res.json({
      items,
      nextCursor: more
        ? Buffer.from(
            JSON.stringify({
              actor: res.locals.user.id,
              customer: i.customerId ?? null,
              q: i.q,
              limit: i.limit,
              after: items.at(-1).id,
            }),
          ).toString("base64url")
        : null,
    });
  });
  app.get("/api/auth/onboarding/context", async (req, res) => {
    const i = z
      .object({
        customerId: z.string().uuid().optional(),
        targetId: targetId.optional(),
        cursor: z.string().max(1000).optional(),
      })
      .strict()
      .parse(req.query);
    let before: string | null = null;
    if (i.cursor)
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(i.cursor)) throw Error();
        const c = z
          .object({
            actor: targetId,
            customer: customerId,
            target: targetId,
            before: z
              .string()
              .regex(/^[1-9][0-9]*$/)
              .max(19)
              .refine(
                (v) =>
                  /^[1-9][0-9]*$/.test(v) &&
                  v.length <= 19 &&
                  BigInt(v) <= 9223372036854775807n,
              ),
          })
          .strict()
          .parse(JSON.parse(Buffer.from(i.cursor, "base64url").toString()));
        if (
          c.actor !== res.locals.user.id ||
          c.customer !== (i.customerId ?? null) ||
          c.target !== i.targetId
        )
          throw Error();
        before = c.before;
      } catch {
        throw new ApiError(
          422,
          "This registration history page is invalid. Preview the account again.",
        );
      }
    const v = (
      await pool.query("SELECT eoms.onboarding_context($1,$2,$3,$4) AS value", [
        res.locals.sessionHash,
        i.customerId ?? null,
        i.targetId ?? null,
        before,
      ])
    ).rows[0].value;
    if (i.targetId && v) {
      v.reopenAllowed = (
        await pool.query(
          "SELECT eoms.registration_reopen_context($1,$2,$3) AS allowed",
          [res.locals.sessionHash, i.customerId ?? null, i.targetId],
        )
      ).rows[0].allowed;
    }
    if (v?.history) {
      const more = v.history.length > 25;
      v.history = v.history.slice(0, 25);
      v.historyNextCursor = more
        ? Buffer.from(
            JSON.stringify({
              actor: res.locals.user.id,
              customer: i.customerId ?? null,
              target: i.targetId,
              before: v.history.at(-1).id,
            }),
          ).toString("base64url")
        : null;
    }
    res.json(v);
  });
  app.get("/api/auth/onboarding/estates", async (req, res) => {
    const i = z
      .object({
        customerId: targetId,
        after: targetId.optional(),
        limit: z.coerce.number().int().min(1).max(25).default(25),
      })
      .strict()
      .parse(req.query);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT eoms.onboarding_context($1,$2,NULL)", [
        res.locals.sessionHash,
        i.customerId,
      ]);
      const v = (
        await c.query("SELECT * FROM eoms.onboarding_estates($1,$2,$3,$4)", [
          res.locals.sessionHash,
          i.customerId,
          i.after ?? null,
          i.limit,
        ])
      ).rows;
      await c.query("COMMIT");
      res.json({
        items: v.slice(0, i.limit),
        next: v.length > i.limit ? v[i.limit - 1].id : null,
      });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  });
  app.post("/api/auth/onboarding/write", async (req, res) => {
    const envelope = z
      .object({
        operation: z.enum([
          "stage",
          "amend",
          "reopen",
          "invite",
          "cancel",
          "access",
          "assign",
        ]),
        key: targetId,
        input: z.unknown(),
      })
      .strict()
      .parse(req.body);
    let input: any;
    if (envelope.operation === "stage")
      input = z
        .object({
          ...shared,
          email: z
            .string()
            .trim()
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          name: z.string().trim().min(1).max(160),
          userCode: z.string().trim().min(1).max(50),
          employeeReference: z.string().trim().min(1).max(100),
          estates: z
            .array(
              z
                .object({
                  estateId: targetId,
                  role: z.enum(["manager", "supervisor", "clerk"]),
                })
                .strict(),
            )
            .max(100)
            .refine((v) => new Set(v.map((x) => x.estateId)).size === v.length),
        })
        .strict()
        .parse(envelope.input);
    else if (envelope.operation === "reopen")
      input = z
        .object({ ...shared, targetId, revision, reviewed: z.literal(true) })
        .strict()
        .parse(envelope.input);
    else if (envelope.operation === "amend")
      input = z
        .object({
          ...shared,
          targetId,
          revision,
          email: z
            .string()
            .trim()
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          name: z.string().trim().min(1).max(160),
          userCode: z.string().trim().min(1).max(50),
          employeeReference: z.string().trim().min(1).max(100),
          estates: z
            .array(
              z
                .object({
                  estateId: targetId,
                  role: z.enum(["manager", "supervisor", "clerk"]),
                })
                .strict(),
            )
            .max(100)
            .refine((v) => new Set(v.map((x) => x.estateId)).size === v.length),
        })
        .strict()
        .parse(envelope.input);
    else if (envelope.operation === "invite") {
      const i = z
        .object({
          ...shared,
          targetId,
          revision,
          token: z.string().regex(/^[a-f0-9]{64}$/),
          method: z.enum(["local", "oidc"]),
          subject: z.string().trim().min(1).max(255).optional(),
        })
        .strict()
        .parse(envelope.input);
      if (i.method === "local" && process.env.NODE_ENV === "production")
        throw new ApiError(
          403,
          "Local invitations are available only in development/test.",
        );
      if (i.method === "oidc" && (!issuer || !i.subject))
        throw new ApiError(
          422,
          "Configure organization identity and provide the approved exact subject.",
        );
      const { token, ...rest } = i;
      input = {
        ...rest,
        tokenHash: hash(token),
        ...(i.method === "oidc" ? { issuer } : {}),
      };
    } else if (envelope.operation === "cancel")
      input = z
        .object({ ...shared, targetId, revision, invitationId: targetId })
        .strict()
        .parse(envelope.input);
    else if (envelope.operation === "assign")
      input = z
        .object({
          ...shared,
          targetId,
          revision,
          scopeRevision: z
            .string()
            .regex(/^[0-9]+:[0-9]+$/)
            .max(50),
          estates: z
            .array(
              z
                .object({
                  estateId: targetId,
                  role: z.enum(["manager", "supervisor", "clerk"]),
                })
                .strict(),
            )
            .max(100)
            .refine((v) => new Set(v.map((x) => x.estateId)).size === v.length),
        })
        .strict()
        .parse(envelope.input);
    else
      input = z
        .object({
          ...shared,
          targetId,
          revision,
          scopeRevision: z
            .string()
            .regex(/^[0-9]+:[0-9]+$/)
            .max(50),
          state: z.enum(["active", "suspended", "deactivated"]),
        })
        .strict()
        .parse(envelope.input);
    if (envelope.operation === "reopen") {
      res.json(
        (
          await pool.query(
            "SELECT eoms.reopen_registration($1,$2,$3,$4,$5) AS value",
            [
              res.locals.sessionHash,
              req.get("X-CSRF-Token"),
              JSON.stringify(input),
              envelope.key,
              res.locals.requestId,
            ],
          )
        ).rows[0].value,
      );
      return;
    }
    res.json(
      (
        await pool.query(
          "SELECT eoms.onboarding_write($1,$2,$3,$4,$5,$6) AS value",
          [
            res.locals.sessionHash,
            req.get("X-CSRF-Token"),
            envelope.operation,
            JSON.stringify(input),
            envelope.key,
            res.locals.requestId,
          ],
        )
      ).rows[0].value,
    );
  });
}
