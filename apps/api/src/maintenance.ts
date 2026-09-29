import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
type EstateTx = <T>(
  req: Request,
  res: Response,
  write: boolean,
  fn: (c: PoolClient, id: string) => Promise<T>,
) => Promise<T>;
type Audit = (
  c: PoolClient,
  estateId: string,
  res: Response,
  action: string,
  id: string | null,
  detail: object,
) => Promise<void>;
export function maintenanceRoutes(
  app: Express,
  estateTx: EstateTx,
  audit: Audit,
  ApiError: new (status: number, message: string) => Error,
) {
  const uuid = z.string().uuid(),
    text = z.string().trim().min(1).max(100),
    version = z.number().int().positive();
  const area = z
    .number()
    .finite()
    .positive()
    .max(1000000)
    .refine(
      (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7,
      "Use at most two decimals",
    );
  const month = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/)
    .refine((s) => Number(s.slice(0, 4)) >= 2000, "Use year 2000 or later");
  const query = z.object({
    q: z.string().trim().max(100).default(""),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(1000).optional(),
    includeInactive: z.enum(["true", "false"]).default("false"),
  });
  async function manager<T>(
    req: Request,
    res: Response,
    fn: (c: PoolClient, id: string) => Promise<T>,
  ) {
    return estateTx(req, res, true, async (c, id) => {
      const m = await c.query(
        "SELECT role FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
        [id, res.locals.user.id],
      );
      if (m.rows[0]?.role !== "manager")
        throw new ApiError(
          403,
          "Only estate managers can maintain master data and periods",
        );
      return fn(c, id);
    });
  }
  function cursor(
    raw: string | undefined,
    kind: string,
    q: string,
    inactive: string,
  ) {
    if (!raw) return undefined;
    try {
      const v = z
        .object({
          kind: z.string(),
          q: z.string(),
          inactive: z.string(),
          a: z.string(),
          b: z.string(),
          id: uuid,
        })
        .parse(JSON.parse(Buffer.from(raw, "base64url").toString()));
      if (v.kind !== kind || v.q !== q || v.inactive !== inactive)
        throw Error();
      return v;
    } catch {
      throw new ApiError(422, "Invalid cursor for these filters");
    }
  }
  for (const kind of ["workers", "occurrences"] as const)
    app.get(`/api/estates/:estateId/catalog/${kind}`, async (req, res) => {
      const q = query.parse(req.query),
        last = cursor(q.cursor, kind, q.q, q.includeInactive);
      const pattern = "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%";
      const rows = await estateTx(req, res, false, async (c, id) =>
        kind === "workers"
          ? (
              await c.query(
                "SELECT id,code,name,active,version FROM eoms.workers WHERE estate_id=$1 AND ($2::boolean OR active) AND (code || ' ' || name) ILIKE $3 AND ($4::text IS NULL OR (code,id)>($4,$5::uuid)) ORDER BY code,id LIMIT $6",
                [
                  id,
                  q.includeInactive === "true",
                  pattern,
                  last?.a ?? null,
                  last?.id ?? null,
                  q.limit + 1,
                ],
              )
            ).rows
          : (
              await c.query(
                "SELECT o.*,(SELECT coalesce(sum(m.quantity_ha),0)::text FROM eoms.musters m WHERE m.estate_id=o.estate_id AND m.occurrence_id=o.id AND m.status='confirmed') AS confirmed_ha FROM eoms.occurrences o WHERE o.estate_id=$1 AND (block_code || ' ' || task_code || ' ' || activity || ' ' || round_code) ILIKE $2 AND ($3::text IS NULL OR (block_code,task_code,id)>($3,$4,$5::uuid)) ORDER BY block_code,task_code,id LIMIT $6",
                [
                  id,
                  pattern,
                  last?.a ?? null,
                  last?.b ?? null,
                  last?.id ?? null,
                  q.limit + 1,
                ],
              )
            ).rows,
      );
      const items = rows.slice(0, q.limit),
        end = items.at(-1);
      res.json({
        items,
        nextCursor:
          rows.length > q.limit
            ? Buffer.from(
                JSON.stringify({
                  kind,
                  q: q.q,
                  inactive: q.includeInactive,
                  a: kind === "workers" ? end.code : end.block_code,
                  b: kind === "workers" ? "" : end.task_code,
                  id: end.id,
                }),
              ).toString("base64url")
            : null,
      });
    });
  app.post("/api/estates/:estateId/workers", async (req, res) => {
    const input = z.object({ code: text, name: text }).strict().parse(req.body);
    const row = await manager(req, res, async (c, id) => {
      const row = (
        await c.query(
          "INSERT INTO eoms.workers(estate_id,code,name) VALUES($1,$2,$3) RETURNING *",
          [id, input.code, input.name],
        )
      ).rows[0];
      await audit(c, id, res, "worker.created", row.id, input);
      return row;
    });
    res.status(201).json(row);
  });
  app.post("/api/estates/:estateId/workers/:id", async (req, res) => {
    const record = uuid.parse(req.params.id),
      input = z
        .object({ name: text, active: z.boolean(), version })
        .strict()
        .parse(req.body);
    res.json(
      await manager(req, res, async (c, id) => {
        const before = (
          await c.query(
            "SELECT * FROM eoms.workers WHERE estate_id=$1 AND id=$2 FOR UPDATE",
            [id, record],
          )
        ).rows[0];
        if (!before) throw new ApiError(404, "Worker not found");
        if (before.version !== input.version)
          throw new ApiError(409, "Worker changed. Refresh before saving.");
        const row = (
          await c.query(
            "UPDATE eoms.workers SET name=$3,active=$4,version=version+1 WHERE estate_id=$1 AND id=$2 RETURNING *",
            [id, record, input.name, input.active],
          )
        ).rows[0];
        await audit(c, id, res, "worker.updated", record, {
          before: { name: before.name, active: before.active },
          after: { name: row.name, active: row.active },
          version: row.version,
        });
        return row;
      }),
    );
  });
  app.post("/api/estates/:estateId/occurrences", async (req, res) => {
    const input = z
      .object({
        blockCode: text,
        taskCode: text,
        activity: text,
        roundCode: text,
        capacityHa: area,
      })
      .strict()
      .parse(req.body);
    const row = await manager(req, res, async (c, id) => {
      const row = (
        await c.query(
          "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            id,
            input.blockCode,
            input.taskCode,
            input.activity,
            input.roundCode,
            input.capacityHa.toFixed(2),
          ],
        )
      ).rows[0];
      await audit(c, id, res, "task.created", row.id, input);
      return row;
    });
    res.status(201).json(row);
  });
  app.post("/api/estates/:estateId/occurrences/:id", async (req, res) => {
    const record = uuid.parse(req.params.id),
      input = z.object({ capacityHa: area, version }).strict().parse(req.body);
    res.json(
      await manager(req, res, async (c, id) => {
        const before = (
          await c.query(
            "SELECT * FROM eoms.occurrences WHERE estate_id=$1 AND id=$2 FOR UPDATE",
            [id, record],
          )
        ).rows[0];
        if (!before) throw new ApiError(404, "Task not found");
        if (before.version !== input.version)
          throw new ApiError(409, "Task changed. Refresh before saving.");
        const used = (
          await c.query(
            "SELECT coalesce(sum(quantity_ha),0)::text AS total FROM eoms.musters WHERE estate_id=$1 AND occurrence_id=$2 AND status='confirmed'",
            [id, record],
          )
        ).rows[0];
        if (
          Math.round(input.capacityHa * 100) <
          Math.round(Number(used.total) * 100)
        )
          throw new ApiError(
            409,
            "Capacity cannot be below already confirmed area",
          );
        const row = (
          await c.query(
            "UPDATE eoms.occurrences SET capacity_ha=$3,version=version+1 WHERE estate_id=$1 AND id=$2 RETURNING *",
            [id, record, input.capacityHa.toFixed(2)],
          )
        ).rows[0];
        await audit(c, id, res, "task.updated", record, {
          before: before.capacity_ha,
          after: row.capacity_ha,
          version: row.version,
        });
        return row;
      }),
    );
  });
  app.get("/api/estates/:estateId/periods", async (req, res) => {
    const year = z.coerce
      .number()
      .int()
      .min(2000)
      .max(9999)
      .parse(req.query.year);
    res.json(
      await estateTx(
        req,
        res,
        false,
        async (c, id) =>
          (
            await c.query(
              "SELECT month::text AS month,locked,version FROM eoms.periods WHERE estate_id=$1 AND month >= make_date($2,1,1) AND month <= make_date($2,12,1) ORDER BY month DESC",
              [id, year],
            )
          ).rows,
      ),
    );
  });
  app.post("/api/estates/:estateId/periods", async (req, res) => {
    const input = z.object({ month }).strict().parse(req.body);
    const row = await manager(req, res, async (c, id) => {
      const row = (
        await c.query(
          "INSERT INTO eoms.periods(estate_id,month) VALUES($1,$2) RETURNING month::text AS month,locked,version",
          [id, input.month],
        )
      ).rows[0];
      await audit(c, id, res, "period.created", null, input);
      return row;
    });
    res.status(201).json(row);
  });
  app.post("/api/estates/:estateId/periods/:month", async (req, res) => {
    const date = month.parse(req.params.month),
      input = z
        .object({
          locked: z.boolean(),
          version,
          reason: z.string().trim().min(5).max(500),
        })
        .strict()
        .parse(req.body);
    res.json(
      await manager(req, res, async (c, id) => {
        const before = (
          await c.query(
            "SELECT locked,version FROM eoms.periods WHERE estate_id=$1 AND month=$2 FOR UPDATE",
            [id, date],
          )
        ).rows[0];
        if (!before) throw new ApiError(404, "Period not found");
        if (before.version !== input.version)
          throw new ApiError(409, "Period changed. Refresh before saving.");
        const row = (
          await c.query(
            "UPDATE eoms.periods SET locked=$3,version=version+1 WHERE estate_id=$1 AND month=$2 RETURNING month::text AS month,locked,version",
            [id, date, input.locked],
          )
        ).rows[0];
        await audit(c, id, res, "period.updated", null, {
          month: date,
          before: before.locked,
          after: row.locked,
          reason: input.reason,
          version: row.version,
        });
        return row;
      }),
    );
  });
}
