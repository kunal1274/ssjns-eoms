import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { administrator, context, visibleCustomer } from "./hierarchy";
import { lifecycleLock } from "./lifecycle";
import { ApiError } from "./http";
import type { Transaction } from "./organization";
import {
  literalPattern,
  pageFields,
  pageResult,
  readPage,
} from "./navigation-page";
const uuid = z.string().uuid();
const kind = z.enum(["mill", "nursery", "warehouse", "workshop", "other"]);
const name = z.string().trim().min(1).max(160);
const reason = z.string().trim().min(3).max(500);
const create = z
  .object({
    kind,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/),
    name,
    companyId: uuid,
    estateId: uuid.nullable(),
    reason,
  })
  .strict();
const edit = z
  .object({
    name,
    active: z.boolean(),
    version: z.number().int().positive(),
    reason,
  })
  .strict();
const projection = `s.id,s.customer_id,s.company_id,s.estate_id,s.kind,s.code,s.name,s.active,s.version,c.name AS company_name,e.code AS estate_code,e.name AS estate_name,
 eoms.can_manage_customer(s.customer_id) AS can_configure`;
const from = `FROM eoms.operational_sites s JOIN eoms.companies c ON c.id=s.company_id AND c.customer_id=s.customer_id LEFT JOIN eoms.estates e ON e.id=s.estate_id AND e.customer_id=s.customer_id`;
async function site(c: PoolClient, customer: string, id: string) {
  const row = (
    await c.query(
      `SELECT ${projection} ${from} WHERE s.customer_id=$1 AND s.id=$2`,
      [customer, id],
    )
  ).rows[0];
  if (!row)
    throw new ApiError(
      404,
      "This operational site is not available in your current scope. Refresh and review your access.",
    );
  return row;
}
export function siteRoutes(app: Express, tx: Transaction) {
  app.get("/api/customers/:customerId/sites/context", async (req, res) => {
    const customer = uuid.parse(req.params.customerId);
    res.json(
      await tx(res, async (c) => {
        await visibleCustomer(c, customer);
        return {
          canConfigure: (
            await c.query("SELECT eoms.can_manage_customer($1) AS allowed", [
              customer,
            ])
          ).rows[0].allowed,
        };
      }),
    );
  });
  app.get("/api/navigation/customers/:customerId/sites", async (req, res) => {
    const customer = uuid.parse(req.params.customerId),
      q = z
        .object({
          ...pageFields,
          selectedId: uuid.optional(),
          kind: kind.optional(),
          status: z.enum(["all", "active", "inactive"]).default("all"),
          estateId: z.union([uuid, z.literal("unlinked")]).optional(),
        })
        .strict()
        .parse(req.query);
    const binding = {
      route: "sites",
      actor: res.locals.user.id,
      customer,
      q: q.q,
      kind: q.kind ?? null,
      status: q.status,
      estateId: q.estateId ?? null,
    };
    const page = readPage(q.cursor, binding);
    res.json(
      await tx(res, async (c) => {
        await visibleCustomer(c, customer);
        const rows = (
          await c.query(
            `SELECT ${projection} ${from} WHERE s.customer_id=$1 AND ($2::uuid IS NULL OR s.id>$2) AND (s.code||' '||s.name) ILIKE $3 AND ($4::text IS NULL OR s.kind=$4) AND ($5='all' OR s.active=($5='active')) AND ($6::text IS NULL OR ($6='unlinked' AND s.estate_id IS NULL) OR s.estate_id::text=$6) ORDER BY s.id LIMIT $7`,
            [
              customer,
              page?.key ?? null,
              literalPattern(q.q),
              q.kind ?? null,
              q.status,
              q.estateId ?? null,
              q.limit + 1,
            ],
          )
        ).rows;
        const selected = q.selectedId
          ? await site(c, customer, q.selectedId)
          : null;
        return {
          ...pageResult(rows, q.limit, binding, (r) => r.id),
          selected: selected
            ? {
                ...selected,
                eligible:
                  (!q.kind || selected.kind === q.kind) &&
                  (q.status === "all" ||
                    selected.active === (q.status === "active")) &&
                  (!q.estateId ||
                    (q.estateId === "unlinked"
                      ? selected.estate_id === null
                      : selected.estate_id === q.estateId)),
              }
            : null,
        };
      }),
    );
  });
  app.get("/api/customers/:customerId/sites/:siteId", async (req, res) => {
    const customer = uuid.parse(req.params.customerId),
      id = uuid.parse(req.params.siteId);
    res.json(await tx(res, (c) => site(c, customer, id)));
  });
  app.get(
    "/api/customers/:customerId/sites/:siteId/history",
    async (req, res) => {
      const customer = uuid.parse(req.params.customerId),
        id = uuid.parse(req.params.siteId),
        q = z.object(pageFields).strict().parse(req.query);
      const binding = {
        route: "site-history",
        actor: res.locals.user.id,
        customer,
        id,
        q: q.q,
      };
      const page = readPage(q.cursor, binding, true);
      res.json(
        await tx(res, async (c) => {
          await site(c, customer, id);
          const upper =
            page?.upper ??
            (
              await c.query(
                "SELECT max(id)::text AS upper FROM eoms.site_history WHERE site_id=$1",
                [id],
              )
            ).rows[0].upper;
          if (!upper) return { items: [], nextCursor: null };
          const rows = (
            await c.query(
              `SELECT h.id,h.site_id,h.actor_id,coalesce(u.display_name,'System / explicit bootstrap') AS actor,h.action,h.reason,h.request_id,h.created_at,h.before_state AS before,h.after_state AS after FROM eoms.site_history h LEFT JOIN eoms.users u ON u.id=h.actor_id WHERE h.site_id=$1 AND h.id<=$2::bigint AND ($3::bigint IS NULL OR h.id<$3) AND (h.reason||' '||h.action||' '||coalesce(h.actor_id::text,'System')||' '||coalesce(u.display_name,'')||' '||coalesce(h.request_id::text,'')) ILIKE $4 ORDER BY h.id DESC LIMIT $5`,
              [id, upper, page?.key ?? null, literalPattern(q.q), q.limit + 1],
            )
          ).rows;
          return pageResult(rows, q.limit, binding, (r) => r.id, upper);
        }),
      );
    },
  );
  app.post("/api/customers/:customerId/sites", async (req, res) => {
    const customer = uuid.parse(req.params.customerId),
      input = create.parse(req.body);
    res.status(201).json(
      await tx(res, async (c) => {
        await administrator(c, customer);
        if (
          !(
            await c.query(
              "SELECT id FROM eoms.companies WHERE id=$1 AND customer_id=$2",
              [input.companyId, customer],
            )
          ).rowCount
        )
          throw new ApiError(
            404,
            "Responsible company is not available in this customer.",
          );
        if (input.estateId) {
          await lifecycleLock(c, input.estateId);
          const estate = (
            await c.query(
              "SELECT id,active FROM eoms.estates WHERE id=$1 AND customer_id=$2 AND eoms.is_member(id)",
              [input.estateId, customer],
            )
          ).rows[0];
          if (!estate)
            throw new ApiError(
              404,
              "Linked estate is not assigned to you in this customer.",
            );
          if (!estate.active)
            throw new ApiError(
              409,
              "The linked estate is paused. Reactivate it before creating an active site.",
            );
        }
        await context(c, res, input.reason);
        const row = (
          await c.query(
            "INSERT INTO eoms.operational_sites(customer_id,company_id,estate_id,kind,code,name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
            [
              customer,
              input.companyId,
              input.estateId,
              input.kind,
              input.code,
              input.name,
            ],
          )
        ).rows[0];
        return site(c, customer, row.id);
      }),
    );
  });
  app.post("/api/customers/:customerId/sites/:siteId", async (req, res) => {
    const customer = uuid.parse(req.params.customerId),
      id = uuid.parse(req.params.siteId),
      input = edit.parse(req.body);
    res.json(
      await tx(res, async (c) => {
        await administrator(c, customer);
        const current = await site(c, customer, id);
        if (current.estate_id) await lifecycleLock(c, current.estate_id);
        if (current.version !== input.version)
          throw new ApiError(
            409,
            "This site changed. Refresh the site, select Edit again and review the current version before saving.",
          );
        if (current.name === input.name && current.active === input.active)
          throw new ApiError(
            422,
            "Change the site name or availability before saving.",
          );
        if (
          input.active &&
          !current.active &&
          current.estate_id &&
          !(
            await c.query(
              "SELECT id FROM eoms.estates WHERE id=$1 AND active",
              [current.estate_id],
            )
          ).rowCount
        )
          throw new ApiError(
            409,
            "The linked estate is paused. Reactivate it before resuming this site.",
          );
        await context(c, res, input.reason);
        const result = await c.query(
          "UPDATE eoms.operational_sites SET name=$1,active=$2,version=version+1 WHERE id=$3 AND customer_id=$4 AND version=$5 RETURNING id",
          [input.name, input.active, id, customer, input.version],
        );
        if (!result.rowCount)
          throw new ApiError(
            409,
            "This site changed. Refresh and review before retrying.",
          );
        return site(c, customer, id);
      }),
    );
  });
}
