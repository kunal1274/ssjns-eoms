import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import type { Pool, PoolClient } from "pg";
import { webOrigin } from "./config.ts";
import { hash, token, verifyPassword, passwordHash } from "./security.ts";
import { allocateHundredths } from "../../../packages/domain/allocation.ts";
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const uuid = z.string().uuid();
const createSchema = z
  .object({
    occurrenceId: uuid,
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const d = new Date(v + "T00:00:00Z");
        return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
      }, "Invalid date"),
    gangCode: z.string().trim().min(1).max(30),
    quantityHa: z
      .number()
      .finite()
      .positive()
      .max(1000000)
      .refine(
        (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7,
        "Use at most two decimals",
      ),
    workerIds: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((v) => new Set(v).size === v.length, "Workers must be unique"),
  })
  .strict();
export function createApp(pool: Pool) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "eoms-api", stage: "foundation" });
  });
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("Origin") !== webOrigin
    )
      return res.status(403).json({ error: "Untrusted request origin" });
    next();
  });
  const dummy = passwordHash("dummy-unknown-account-" + token());
  app.post(
    "/api/auth/login",
    rateLimit({
      windowMs: 60000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) => {
      const input = z
        .object({
          email: z.string().email().max(254),
          password: z.string().min(1).max(128),
        })
        .strict()
        .parse(req.body);
      const result = await pool.query(
        "SELECT id,email,display_name,password_hash,active FROM eoms.users WHERE email=$1",
        [input.email.toLowerCase()],
      );
      const u = result.rows[0];
      const valid = await verifyPassword(
        input.password,
        u?.password_hash ?? (await dummy),
      );
      if (!valid || !u?.active)
        throw new ApiError(401, "Email or password is incorrect");
      const raw = token(),
        csrf = token();
      await pool.query(
        "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
        [hash(raw), u.id, csrf],
      );
      res.cookie("eoms_session", raw, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 8 * 3600000,
        path: "/api",
      });
      res.json({
        user: { id: u.id, email: u.email, name: u.display_name },
        csrf,
      });
    },
  );
  app.use("/api", async (req, res, next) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("eoms_session="))
      ?.slice(13);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie))
      throw new ApiError(401, "Sign in to continue");
    const rows = await pool.query(
      "SELECT u.id,u.email,u.display_name,s.csrf FROM eoms.sessions s JOIN eoms.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active",
      [hash(cookie)],
    );
    if (!rows.rowCount)
      throw new ApiError(401, "Session expired. Sign in again.");
    res.locals.user = rows.rows[0];
    res.locals.sessionHash = hash(cookie);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("X-CSRF-Token") !== rows.rows[0].csrf
    )
      throw new ApiError(403, "Invalid CSRF token");
    next();
  });
  app.get("/api/auth/session", (req, res) => {
    const u = res.locals.user;
    res.json({
      user: { id: u.id, email: u.email, name: u.display_name },
      csrf: u.csrf,
    });
  });
  app.post("/api/auth/logout", async (_req, res) => {
    await pool.query("DELETE FROM eoms.sessions WHERE token_hash=$1", [
      res.locals.sessionHash,
    ]);
    res.clearCookie("eoms_session", { path: "/api" }).status(204).end();
  });
  async function tx<T>(res: Response, fn: (c: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id',$1,true)", [
        res.locals.user.id,
      ]);
      await c.query("SET LOCAL statement_timeout='5s'");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async function estateTx<T>(
    req: Request,
    res: Response,
    write: boolean,
    fn: (c: PoolClient, id: string) => Promise<T>,
  ) {
    const id = uuid.parse(req.params.estateId);
    return tx(res, async (c) => {
      const m = await c.query(
        "SELECT role FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
        [id, res.locals.user.id],
      );
      if (!m.rowCount) throw new ApiError(403, "Estate access denied");
      if (write && !["manager", "supervisor"].includes(m.rows[0].role))
        throw new ApiError(403, "Your role cannot record or confirm muster");
      return fn(c, id);
    });
  }
  async function audit(
    c: PoolClient,
    estateId: string,
    res: Response,
    action: string,
    id: string,
    detail: object,
  ) {
    await c.query(
      "INSERT INTO eoms.audit(estate_id,actor_id,action,record_id,detail) VALUES($1,$2,$3,$4,$5)",
      [estateId, res.locals.user.id, action, id, JSON.stringify(detail)],
    );
  }
  async function openPeriod(c: PoolClient, estateId: string, date: string) {
    const p = await c.query(
      "SELECT locked FROM eoms.periods WHERE estate_id=$1 AND month=date_trunc('month',$2::date)::date FOR SHARE",
      [estateId, date],
    );
    if (!p.rowCount)
      throw new ApiError(
        409,
        "No open operational period exists for this date",
      );
    if (p.rows[0].locked)
      throw new ApiError(409, "This operational period is locked");
  }
  app.get("/api/estates", async (_req, res) =>
    res.json(
      await tx(
        res,
        async (c) =>
          (
            await c.query(
              "SELECT e.id,e.code,e.name,m.role FROM eoms.estates e JOIN eoms.memberships m ON m.estate_id=e.id WHERE m.user_id=$1 ORDER BY e.name",
              [res.locals.user.id],
            )
          ).rows,
      ),
    ),
  );
  app.get("/api/estates/:estateId/workers", async (req, res) =>
    res.json(
      await estateTx(
        req,
        res,
        false,
        async (c, id) =>
          (
            await c.query(
              "SELECT id,code,name,active FROM eoms.workers WHERE estate_id=$1 AND active ORDER BY code LIMIT 200",
              [id],
            )
          ).rows,
      ),
    ),
  );
  app.get("/api/estates/:estateId/occurrences", async (req, res) =>
    res.json(
      await estateTx(
        req,
        res,
        false,
        async (c, id) =>
          (
            await c.query(
              "SELECT o.*,(SELECT coalesce(sum(m.quantity_ha),0)::text FROM eoms.musters m WHERE m.estate_id=o.estate_id AND m.occurrence_id=o.id AND m.status='confirmed') AS confirmed_ha FROM eoms.occurrences o WHERE o.estate_id=$1 ORDER BY block_code,task_code LIMIT 100",
              [id],
            )
          ).rows,
      ),
    ),
  );
  app.get("/api/estates/:estateId/musters", async (req, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        cursor: z.string().max(300).optional(),
      })
      .parse(req.query);
    let cursor: { date: string; id: string } | undefined;
    if (q.cursor) {
      try {
        cursor = z
          .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), id: uuid })
          .parse(JSON.parse(Buffer.from(q.cursor, "base64url").toString()));
      } catch {
        throw new ApiError(422, "Invalid page cursor");
      }
    }
    const result = await estateTx(req, res, false, async (c, id) => {
      const rows = (
        await c.query(
          "SELECT m.*,m.business_date::text AS business_date,o.block_code,o.task_code,o.activity,o.round_code FROM eoms.musters m JOIN eoms.occurrences o ON o.id=m.occurrence_id AND o.estate_id=m.estate_id WHERE m.estate_id=$1 AND ($2::date IS NULL OR (m.business_date,m.id)<($2::date,$3::uuid)) ORDER BY m.business_date DESC,m.id DESC LIMIT $4",
          [id, cursor?.date ?? null, cursor?.id ?? null, q.limit + 1],
        )
      ).rows;
      const items = rows.slice(0, q.limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > q.limit
            ? Buffer.from(
                JSON.stringify({ date: last.business_date, id: last.id }),
              ).toString("base64url")
            : null,
      };
    });
    res.json(result);
  });
  app.get("/api/estates/:estateId/musters/:id", async (req, res) => {
    const record = uuid.parse(req.params.id);
    res.json(
      await estateTx(req, res, false, async (c, estateId) => {
        const row = (
          await c.query(
            "SELECT m.*,m.business_date::text AS business_date FROM eoms.musters m WHERE estate_id=$1 AND id=$2",
            [estateId, record],
          )
        ).rows[0];
        if (!row) throw new ApiError(404, "Muster not found");
        const shares = (
          await c.query(
            "SELECT s.worker_id,s.quantity_ha,s.man_days,w.name FROM eoms.muster_shares s JOIN eoms.workers w ON w.id=s.worker_id AND w.estate_id=s.estate_id WHERE s.estate_id=$1 AND s.muster_id=$2 ORDER BY w.code",
            [estateId, record],
          )
        ).rows;
        return { ...row, shares };
      }),
    );
  });
  app.post("/api/estates/:estateId/musters", async (req, res) => {
    const input = createSchema.parse(req.body);
    const key = uuid.parse(req.get("Idempotency-Key"));
    const requestHash = hash(JSON.stringify(input));
    const result = await estateTx(req, res, true, async (c, id) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${id}:${res.locals.user.id}:${key}`,
      ]);
      const seen = (
        await c.query(
          "SELECT request_hash,response FROM eoms.idempotency WHERE estate_id=$1 AND user_id=$2 AND key=$3",
          [id, res.locals.user.id, key],
        )
      ).rows[0];
      if (seen) {
        if (seen.request_hash !== requestHash)
          throw new ApiError(
            409,
            "Idempotency key was already used for different input",
          );
        return seen.response;
      }
      await openPeriod(c, id, input.businessDate);
      const occurrence = (
        await c.query(
          "SELECT id,capacity_ha FROM eoms.occurrences WHERE estate_id=$1 AND id=$2",
          [id, input.occurrenceId],
        )
      ).rows[0];
      if (!occurrence)
        throw new ApiError(422, "Task does not belong to this estate");
      if (input.quantityHa > Number(occurrence.capacity_ha))
        throw new ApiError(422, "Work exceeds registered task area");
      const workers = (
        await c.query(
          "SELECT id FROM eoms.workers WHERE estate_id=$1 AND active AND id=ANY($2::uuid[])",
          [id, input.workerIds],
        )
      ).rows;
      if (workers.length !== input.workerIds.length)
        throw new ApiError(
          422,
          "Select active workers belonging to this estate",
        );
      const allocations = allocateHundredths(input.quantityHa, input.workerIds);
      const row = (
        await c.query(
          "INSERT INTO eoms.musters(estate_id,occurrence_id,business_date,gang_code,quantity_ha,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *,business_date::text AS business_date",
          [
            id,
            input.occurrenceId,
            input.businessDate,
            input.gangCode,
            input.quantityHa.toFixed(2),
            res.locals.user.id,
          ],
        )
      ).rows[0];
      for (const workerId of input.workerIds)
        await c.query(
          "INSERT INTO eoms.muster_shares(estate_id,muster_id,worker_id,quantity_ha,man_days) VALUES($1,$2,$3,$4,1)",
          [id, row.id, workerId, (allocations[workerId] / 100).toFixed(2)],
        );
      await audit(c, id, res, "muster.created", row.id, {
        quantityHa: input.quantityHa,
        workers: input.workerIds.length,
      });
      await c.query(
        "INSERT INTO eoms.idempotency(estate_id,user_id,key,request_hash,response) VALUES($1,$2,$3,$4,$5)",
        [id, res.locals.user.id, key, requestHash, JSON.stringify(row)],
      );
      return row;
    });
    res.status(201).json(result);
  });
  app.post("/api/estates/:estateId/musters/:id/confirm", async (req, res) => {
    const record = uuid.parse(req.params.id);
    const input = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    res.json(
      await estateTx(req, res, true, async (c, id) => {
        const first = (
          await c.query(
            "SELECT *,business_date::text AS business_date FROM eoms.musters WHERE estate_id=$1 AND id=$2",
            [id, record],
          )
        ).rows[0];
        if (!first) throw new ApiError(404, "Muster not found");
        if (first.status === "confirmed") return first;
        await openPeriod(c, id, first.business_date);
        const occurrence = (
          await c.query(
            "SELECT capacity_ha FROM eoms.occurrences WHERE estate_id=$1 AND id=$2 FOR UPDATE",
            [id, first.occurrence_id],
          )
        ).rows[0];
        const row = (
          await c.query(
            "SELECT *,business_date::text AS business_date FROM eoms.musters WHERE estate_id=$1 AND id=$2 FOR UPDATE",
            [id, record],
          )
        ).rows[0];
        if (row.status === "confirmed") return row;
        if (row.version !== input.version)
          throw new ApiError(
            409,
            "Muster version changed. Refresh before confirming.",
          );
        const totals = (
          await c.query(
            "SELECT coalesce(sum(quantity_ha),0)::text AS total FROM eoms.musters WHERE estate_id=$1 AND occurrence_id=$2 AND status='confirmed'",
            [id, row.occurrence_id],
          )
        ).rows[0];
        if (
          Math.round(Number(totals.total) * 100) +
            Math.round(Number(row.quantity_ha) * 100) >
          Math.round(Number(occurrence.capacity_ha) * 100)
        )
          throw new ApiError(
            409,
            "Another confirmed record uses this task area. Review remaining capacity.",
          );
        const sums = (
          await c.query(
            "SELECT coalesce(sum(quantity_ha),0)::text AS total FROM eoms.muster_shares WHERE estate_id=$1 AND muster_id=$2",
            [id, record],
          )
        ).rows[0];
        if (
          sums.total !== row.quantity_ha &&
          Number(sums.total) !== Number(row.quantity_ha)
        )
          throw new ApiError(409, "Worker shares do not reconcile");
        const updated = (
          await c.query(
            "UPDATE eoms.musters SET status='confirmed',version=version+1,confirmed_at=now() WHERE estate_id=$1 AND id=$2 RETURNING *,business_date::text AS business_date",
            [id, record],
          )
        ).rows[0];
        await audit(c, id, res, "muster.confirmed", record, {
          quantityHa: updated.quantity_ha,
          version: updated.version,
        });
        await c.query(
          "INSERT INTO eoms.outbox(estate_id,aggregate_id,event_type,payload) VALUES($1,$2,'muster.confirmed',$3)",
          [
            id,
            record,
            JSON.stringify({ musterId: record, version: updated.version }),
          ],
        );
        return updated;
      }),
    );
  });
  app.get("/api/estates/:estateId/audit", async (req, res) =>
    res.json(
      await estateTx(
        req,
        res,
        false,
        async (c, id) =>
          (
            await c.query(
              "SELECT a.id,a.action,a.record_id,a.detail,a.created_at,u.display_name AS actor FROM eoms.audit a JOIN eoms.users u ON u.id=a.actor_id WHERE a.estate_id=$1 ORDER BY a.id DESC LIMIT 50",
              [id],
            )
          ).rows,
      ),
    ),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found" }),
  );
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError)
      return res
        .status(422)
        .json({
          error: error.errors
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("; "),
        });
    if (error instanceof ApiError)
      return res.status(error.status).json({ error: error.message });
    if (error.code === "23503")
      return res.status(422).json({ error: "Invalid record reference" });
    if (error.code === "23505")
      return res
        .status(409)
        .json({ error: "A matching record already exists" });
    if (error.type === "entity.too.large")
      return res.status(413).json({ error: "Request too large" });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON" });
    console.error("API error", {
      code: error.code || "unknown",
      message: error.message,
    });
    res.status(500).json({ error: "Request could not be completed" });
  });
  return app;
}
