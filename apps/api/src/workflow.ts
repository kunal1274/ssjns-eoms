import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
type Tx = <T>(
  req: Request,
  res: Response,
  write: boolean,
  fn: (c: PoolClient, id: string) => Promise<T>,
) => Promise<T>;
type Audit = (
  c: PoolClient,
  id: string,
  res: Response,
  action: string,
  record: string | null,
  detail: object,
) => Promise<void>;
type ErrorType = new (status: number, message: string) => Error;
export async function assertGangAllowed(
  c: PoolClient,
  res: Response,
  id: string,
  code: string,
  ErrorClass: ErrorType,
) {
  const gang = (
    await c.query(
      "SELECT id,active FROM eoms.gangs WHERE estate_id=$1 AND code=$2 FOR SHARE",
      [id, code],
    )
  ).rows[0];
  if (!gang?.active)
    throw new ErrorClass(422, "Choose an active registered gang");
  const role = (
    await c.query(
      "SELECT role FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
      [id, res.locals.user.id],
    )
  ).rows[0]?.role;
  if (role === "manager") return;
  const assigned = await c.query(
    "SELECT 1 FROM eoms.gang_supervisors WHERE estate_id=$1 AND gang_id=$2 AND user_id=$3",
    [id, gang.id, res.locals.user.id],
  );
  if (!assigned.rowCount)
    throw new ErrorClass(403, "You are not assigned to this gang");
}
export function workflowRoutes(
  app: Express,
  tx: Tx,
  audit: Audit,
  openPeriod: (c: PoolClient, id: string, date: string) => Promise<void>,
  ErrorClass: ErrorType,
) {
  const uuid = z.string().uuid(),
    text = z.string().trim().min(1).max(100),
    reason = z.string().trim().min(5).max(500),
    version = z.number().int().positive(),
    supervisors = z
      .array(uuid)
      .max(100)
      .refine((a) => new Set(a).size === a.length, "Duplicate supervisors");
  async function manager<T>(
    req: Request,
    res: Response,
    fn: (c: PoolClient, id: string) => Promise<T>,
  ) {
    return tx(req, res, true, async (c, id) => {
      const m = (
        await c.query(
          "SELECT role FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
          [id, res.locals.user.id],
        )
      ).rows[0];
      if (m?.role !== "manager")
        throw new ErrorClass(
          403,
          "Only estate managers can perform this action",
        );
      return fn(c, id);
    });
  }
  app.get("/api/estates/:estateId/supervisors", async (req, res) =>
    res.json(
      await manager(
        req,
        res,
        async (c, id) =>
          (
            await c.query(
              "SELECT * FROM eoms.assignable_supervisors($1) LIMIT 200",
              [id],
            )
          ).rows,
      ),
    ),
  );
  app.get("/api/estates/:estateId/gangs", async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().max(100).default(""),
        cursor: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        assignable: z.enum(["true", "false"]).default("false"),
      })
      .parse(req.query);
    const rows = await tx(
      req,
      res,
      false,
      async (c, id) =>
        (
          await c.query(
            "SELECT g.*,(SELECT coalesce(json_agg(s.user_id),'[]') FROM eoms.gang_supervisors s WHERE s.estate_id=g.estate_id AND s.gang_id=g.id) AS supervisor_ids FROM eoms.gangs g WHERE g.estate_id=$1 AND ($2::uuid IS NULL OR g.id>$2) AND (g.code || ' ' || g.name) ILIKE $3 AND (NOT $4::boolean OR (g.active AND (EXISTS(SELECT 1 FROM eoms.memberships m WHERE m.estate_id=g.estate_id AND m.user_id=$5 AND m.role='manager') OR EXISTS(SELECT 1 FROM eoms.gang_supervisors s WHERE s.estate_id=g.estate_id AND s.gang_id=g.id AND s.user_id=$5)))) ORDER BY g.id LIMIT $6",
            [
              id,
              q.cursor ?? null,
              "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%",
              q.assignable === "true",
              res.locals.user.id,
              q.limit + 1,
            ],
          )
        ).rows,
    );
    res.json({
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
    });
  });
  async function assign(
    c: PoolClient,
    id: string,
    gang: string,
    users: string[],
  ) {
    const valid = (
      await c.query(
        "SELECT id FROM eoms.assignable_supervisors($1) WHERE id=ANY($2::uuid[])",
        [id, users],
      )
    ).rows;
    if (valid.length !== users.length)
      throw new ErrorClass(422, "Choose active supervisors from this estate");
    await c.query(
      "DELETE FROM eoms.gang_supervisors WHERE estate_id=$1 AND gang_id=$2",
      [id, gang],
    );
    for (const user of users)
      await c.query(
        "INSERT INTO eoms.gang_supervisors(estate_id,gang_id,user_id) VALUES($1,$2,$3)",
        [id, gang, user],
      );
  }
  app.post("/api/estates/:estateId/gangs", async (req, res) => {
    const input = z
      .object({
        code: z.string().trim().min(1).max(30),
        name: text,
        supervisorIds: supervisors,
      })
      .strict()
      .parse(req.body);
    const row = await manager(req, res, async (c, id) => {
      const row = (
        await c.query(
          "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,$2,$3) RETURNING *",
          [id, input.code, input.name],
        )
      ).rows[0];
      await assign(c, id, row.id, input.supervisorIds);
      await audit(c, id, res, "gang.created", row.id, input);
      return row;
    });
    res.status(201).json(row);
  });
  app.post("/api/estates/:estateId/gangs/:id", async (req, res) => {
    const record = uuid.parse(req.params.id),
      input = z
        .object({
          name: text,
          active: z.boolean(),
          supervisorIds: supervisors,
          version,
        })
        .strict()
        .parse(req.body);
    res.json(
      await manager(req, res, async (c, id) => {
        const before = (
          await c.query(
            "SELECT * FROM eoms.gangs WHERE estate_id=$1 AND id=$2 FOR UPDATE",
            [id, record],
          )
        ).rows[0];
        if (!before) throw new ErrorClass(404, "Gang not found");
        if (before.version !== input.version)
          throw new ErrorClass(409, "Gang changed. Refresh before saving.");
        const previous = (
          await c.query(
            "SELECT user_id FROM eoms.gang_supervisors WHERE estate_id=$1 AND gang_id=$2",
            [id, record],
          )
        ).rows.map((r) => r.user_id);
        await assign(c, id, record, input.supervisorIds);
        const row = (
          await c.query(
            "UPDATE eoms.gangs SET name=$3,active=$4,version=version+1 WHERE estate_id=$1 AND id=$2 RETURNING *",
            [id, record, input.name, input.active],
          )
        ).rows[0];
        await audit(c, id, res, "gang.updated", record, {
          before: {
            name: before.name,
            active: before.active,
            supervisorIds: previous,
          },
          after: input,
        });
        return row;
      }),
    );
  });
  for (const action of ["approve", "reverse"] as const)
    app.post(
      `/api/estates/:estateId/musters/:id/${action}`,
      async (req, res) => {
        const record = uuid.parse(req.params.id),
          input = z.object({ version, reason }).strict().parse(req.body);
        res.json(
          await manager(req, res, async (c, id) => {
            const first = (
              await c.query(
                "SELECT *,business_date::text AS business_date FROM eoms.musters WHERE estate_id=$1 AND id=$2",
                [id, record],
              )
            ).rows[0];
            if (!first) throw new ErrorClass(404, "Muster not found");
            await openPeriod(c, id, first.business_date);
            // Same lock ordering as confirmation: period, occurrence, muster.
            await c.query(
              "SELECT id FROM eoms.occurrences WHERE estate_id=$1 AND id=$2 FOR UPDATE",
              [id, first.occurrence_id],
            );
            const row = (
              await c.query(
                "SELECT * FROM eoms.musters WHERE estate_id=$1 AND id=$2 FOR UPDATE",
                [id, record],
              )
            ).rows[0];
            if (row.version !== input.version)
              throw new ErrorClass(
                409,
                "Muster changed. Refresh before taking action.",
              );
            if (row.status !== "confirmed")
              throw new ErrorClass(
                409,
                "Only confirmed work can be reviewed or reversed",
              );
            if (action === "approve" && row.review_status === "approved")
              throw new ErrorClass(409, "Muster is already approved");
            const updated = (
              await c.query(
                action === "approve"
                  ? "UPDATE eoms.musters SET review_status='approved',reviewed_by=$3,reviewed_at=now(),review_reason=$4,version=version+1 WHERE estate_id=$1 AND id=$2 RETURNING *,business_date::text AS business_date"
                  : "UPDATE eoms.musters SET status='reversed',reversed_by=$3,reversed_at=now(),reversal_reason=$4,version=version+1 WHERE estate_id=$1 AND id=$2 RETURNING *,business_date::text AS business_date",
                [id, record, res.locals.user.id, input.reason],
              )
            ).rows[0];
            const event =
              action === "approve" ? "muster.approved" : "muster.reversed";
            await audit(c, id, res, event, record, {
              reason: input.reason,
              previousVersion: row.version,
              version: updated.version,
              quantityHa: row.quantity_ha,
            });
            await c.query(
              "INSERT INTO eoms.outbox(estate_id,aggregate_id,event_type,payload) VALUES($1,$2,$3,$4)",
              [
                id,
                record,
                event,
                JSON.stringify({
                  musterId: record,
                  version: updated.version,
                  reason: input.reason,
                }),
              ],
            );
            return updated;
          }),
        );
      },
    );
}
