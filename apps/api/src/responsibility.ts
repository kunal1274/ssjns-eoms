import type { Express } from "express";
import { z } from "zod";
import { ApiError } from "./http";
import type { Transaction } from "./organization";
import { administrator, estateContext } from "./hierarchy";
const uuid = z.string().uuid(),
  date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const parsed = new Date(value + "T00:00:00Z");
      return (
        !isNaN(+parsed) &&
        parsed.toISOString().slice(0, 10) === value &&
        value >= "2000-01-01" &&
        value < "9999-01-01"
      );
    });
export function responsibilityRoutes(app: Express, tx: Transaction) {
  app.get("/api/estates/:estateId/responsibility", async (req, res) => {
    const estate = uuid.parse(req.params.estateId),
      on = date.optional().parse(req.query.on);
    res.json(
      await tx(res, async (c) => {
        const scope = await estateContext(c, estate);
        const today = (await c.query("SELECT CURRENT_DATE::text AS day"))
            .rows[0].day,
          asOf = on || today;
        const baseline = (
          await c.query(
            "SELECT c.id,c.name FROM eoms.estates e JOIN eoms.companies c ON c.id=e.company_id WHERE e.id=$1",
            [estate],
          )
        ).rows[0];
        const responsible = (
          await c.query(
            "SELECT r.id,r.company_id AS id_company,c.name,r.effective_from::text AS effective_from FROM eoms.estate_responsibilities r JOIN eoms.companies c ON c.id=r.company_id WHERE r.estate_id=$1 AND r.effective_from<=$2::date ORDER BY r.effective_from DESC LIMIT 1",
            [estate, asOf],
          )
        ).rows[0];
        const rows = (
          await c.query(
            "SELECT r.id,r.company_id,c.name AS company_name,r.previous_company_id,p.name AS previous_company_name,r.effective_from::text AS effective_from,r.revision,r.reason,r.request_id,r.created_at,coalesce(u.display_name,'System / explicit migration') AS actor FROM eoms.estate_responsibilities r JOIN eoms.companies c ON c.id=r.company_id JOIN eoms.companies p ON p.id=r.previous_company_id LEFT JOIN eoms.users u ON u.id=r.actor_id WHERE r.estate_id=$1 ORDER BY r.revision DESC LIMIT 51",
            [estate],
          )
        ).rows;
        const companies = (
          await c.query(
            "SELECT id,name FROM eoms.companies WHERE customer_id=$1 ORDER BY name,id LIMIT 201",
            [scope.customer_id],
          )
        ).rows;
        const revision = (
          await c.query(
            "SELECT coalesce(max(revision),0)::int AS revision FROM eoms.estate_responsibilities WHERE estate_id=$1",
            [estate],
          )
        ).rows[0].revision;
        return {
          today,
          asOf,
          baseline,
          responsible: responsible
            ? {
                id: responsible.id_company,
                name: responsible.name,
                assignmentId: responsible.id,
                effectiveFrom: responsible.effective_from,
              }
            : baseline,
          revision,
          items: rows.slice(0, 50),
          companies: companies.slice(0, 200),
          truncated: rows.length > 50 || companies.length > 200,
          canConfigure: (
            await c.query("SELECT eoms.can_manage_customer($1) AS allowed", [
              scope.customer_id,
            ])
          ).rows[0].allowed,
        };
      }),
    );
  });
  app.post("/api/estates/:estateId/responsibility", async (req, res) => {
    const estate = uuid.parse(req.params.estateId),
      input = z
        .object({
          companyId: uuid,
          effectiveFrom: date,
          revision: z.number().int().min(0),
          reason: z.string().trim().min(3).max(500),
        })
        .strict()
        .parse(req.body);
    const row = await tx(res, async (c) => {
      const scope = await estateContext(c, estate);
      await administrator(c, scope.customer_id);
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text,609))",
        [estate],
      );
      const previous = (
        await c.query(
          "SELECT company_id,effective_from::text AS effective_from,revision FROM eoms.estate_responsibilities WHERE estate_id=$1 ORDER BY revision DESC LIMIT 1",
          [estate],
        )
      ).rows[0];
      if ((previous?.revision || 0) !== input.revision)
        throw new ApiError(
          409,
          "Responsibility history changed. Refresh and review the current revision before scheduling.",
        );
      const baseline = (
        await c.query("SELECT company_id FROM eoms.estates WHERE id=$1", [
          estate,
        ])
      ).rows[0].company_id;
      if ((previous?.company_id || baseline) === input.companyId)
        throw new ApiError(422, "Choose a different responsible company.");
      const today = (await c.query("SELECT CURRENT_DATE::text AS day")).rows[0]
        .day;
      if (
        input.effectiveFrom < today ||
        (previous && input.effectiveFrom <= previous.effective_from)
      )
        throw new ApiError(
          422,
          "Choose a current or future date later than the latest recorded change.",
        );
      if (
        !(
          await c.query(
            "SELECT id FROM eoms.companies WHERE id=$1 AND customer_id=$2",
            [input.companyId, scope.customer_id],
          )
        ).rowCount
      )
        throw new ApiError(
          422,
          "Choose an accessible company in this customer.",
        );
      if (
        (
          await c.query(
            "SELECT id FROM eoms.musters WHERE estate_id=$1 AND business_date>=$2::date LIMIT 1",
            [estate, input.effectiveFrom],
          )
        ).rowCount
      )
        throw new ApiError(
          409,
          "Work already exists on or after this date. Review those records and use the governed correction process; this change cannot rewrite their attribution.",
        );
      await c.query("SELECT set_config('app.request_id',$1,true)", [
        res.locals.requestId,
      ]);
      return (
        await c.query(
          "INSERT INTO eoms.estate_responsibilities(estate_id,customer_id,company_id,effective_from,revision,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,company_id,previous_company_id,effective_from::text AS effective_from,revision,reason,request_id",
          [
            estate,
            scope.customer_id,
            input.companyId,
            input.effectiveFrom,
            input.revision + 1,
            input.reason,
          ],
        )
      ).rows[0];
    });
    res.status(201).json(row);
  });
}
