import type { Express } from "express";
import { z } from "zod";
import { ApiError } from "./http";
import { estateContext, visibleCustomer } from "./hierarchy";
import type { Transaction } from "./organization";
import {
  literalPattern,
  pageFields,
  pageResult,
  readPage,
} from "./navigation-page";
const uuid = z.string().uuid(),
  recordType = z.enum([
    "group",
    "company",
    "unit",
    "setup-grant",
    "task-link",
    "area",
    "estate-placement",
    "estate-lifecycle",
    "unit-lifecycle",
  ]);
export function navigationRoutes(app: Express, tx: Transaction) {
  app.get("/api/navigation/estates", async (req, res) => {
    const q = z
        .object({ ...pageFields, customerId: uuid.optional() })
        .strict()
        .parse(req.query),
      binding = {
        route: "estates",
        actor: res.locals.user.id,
        q: q.q,
        customer: q.customerId ?? null,
      },
      page = readPage(q.cursor, binding);
    res.json(
      await tx(res, async (c) => {
        if (q.customerId) await visibleCustomer(c, q.customerId);
        const rows = (
          await c.query(
            `SELECT e.id,e.code,e.name,e.active,e.customer_id,t.code AS customer_code,t.name AS customer_name,e.company_id,c.name AS company_name
 FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id JOIN eoms.companies c ON c.id=e.company_id AND c.customer_id=e.customer_id JOIN eoms.customers t ON t.id=e.customer_id
 WHERE m.user_id=$1 AND ($2::uuid IS NULL OR e.customer_id=$2) AND ($3::uuid IS NULL OR e.id>$3) AND ((e.code||' '||e.name) ILIKE $4 OR (t.code||' '||t.name) ILIKE $4 OR c.name ILIKE $4) ORDER BY e.id LIMIT $5`,
            [
              res.locals.user.id,
              q.customerId ?? null,
              page?.key ?? null,
              literalPattern(q.q),
              q.limit + 1,
            ],
          )
        ).rows;
        return pageResult(rows, q.limit, binding, (r) => r.id);
      }),
    );
  });
  app.get("/api/navigation/estates/:estateId/units", async (req, res) => {
    const estate = uuid.parse(req.params.estateId),
      q = z
        .object({
          ...pageFields,
          kind: z.enum(["all", "division", "field", "block"]).default("all"),
          status: z.enum(["all", "active", "inactive"]).default("all"),
        })
        .strict()
        .parse(req.query),
      binding = {
        route: "units",
        actor: res.locals.user.id,
        estate,
        q: q.q,
        kind: q.kind,
        status: q.status,
      },
      page = readPage(q.cursor, binding);
    res.json(
      await tx(res, async (c) => {
        await estateContext(c, estate);
        const rows = (
          await c.query(
            `SELECT u.id,u.kind,u.code,u.name,u.parent_id,p.code AS parent_code,u.active,u.version FROM eoms.operating_units u LEFT JOIN eoms.operating_units p ON p.id=u.parent_id AND p.estate_id=u.estate_id
 WHERE u.estate_id=$1 AND ($2='all' OR u.kind=$2) AND ($3='all' OR u.active=($3='active')) AND (u.code||' '||u.name) ILIKE $4 AND ($5::uuid IS NULL OR u.id>$5) ORDER BY u.id LIMIT $6`,
            [
              estate,
              q.kind,
              q.status,
              literalPattern(q.q),
              page?.key ?? null,
              q.limit + 1,
            ],
          )
        ).rows;
        return pageResult(rows, q.limit, binding, (r) => r.id);
      }),
    );
  });
  app.get("/api/navigation/customers/:customerId/history", async (req, res) => {
    const customer = uuid.parse(req.params.customerId),
      q = z
        .object({
          ...pageFields,
          source: z.enum(["hierarchy", "customer"]).default("hierarchy"),
          estateId: uuid.optional(),
          recordId: uuid.optional(),
          recordType: recordType.optional(),
          requestId: uuid.optional(),
        })
        .strict()
        .parse(req.query);
    if (q.source === "customer" && (q.estateId || q.recordId || q.recordType))
      throw new ApiError(
        422,
        "Customer display history does not have estate, unit or hierarchy-type filters. Clear these filters first.",
      );
    const binding = {
        route: "history",
        actor: res.locals.user.id,
        customer,
        source: q.source,
        q: q.q,
        estate: q.estateId ?? null,
        record: q.recordId ?? null,
        type: q.recordType ?? null,
        request: q.requestId ?? null,
      },
      page = readPage(q.cursor, binding, true);
    res.json(
      await tx(res, async (c) => {
        await visibleCustomer(c, customer);
        if (q.estateId) {
          const scope = await estateContext(c, q.estateId);
          if (scope.customer_id !== customer)
            throw new ApiError(
              404,
              "Estate is not available in this customer.",
            );
        }
        const hierarchy = q.source === "hierarchy";
        const rows = hierarchy
          ? (
              await c.query(
                `SELECT h.id::text,h.record_id,h.estate_id,h.record_type,h.action,h.reason,h.actor_id,coalesce(u.display_name,'System / migration') AS actor,h.request_id,h.created_at,
 jsonb_build_object('code',h.before_state->'code','name',h.before_state->'name','kind',h.before_state->'kind','parentId',h.before_state->'parentId','groupId',h.before_state->'groupId','version',h.before_state->'version','active',h.before_state->'active','moveDecisionId',h.before_state->'moveDecisionId') AS before,
 jsonb_build_object('code',h.after_state->'code','name',h.after_state->'name','kind',h.after_state->'kind','parentId',h.after_state->'parentId','groupId',h.after_state->'groupId','version',h.after_state->'version','active',h.after_state->'active','moveDecisionId',h.after_state->'moveDecisionId') AS after
 FROM eoms.hierarchy_history h LEFT JOIN eoms.users u ON u.id=h.actor_id WHERE h.customer_id=$1 AND ($2::bigint IS NULL OR h.id<$2) AND ($3::bigint IS NULL OR h.id<=$3) AND ($4::uuid IS NULL OR h.estate_id=$4) AND ($5::uuid IS NULL OR h.record_id=$5) AND ($6::text IS NULL OR h.record_type=$6) AND ($7::uuid IS NULL OR h.request_id=$7) AND (h.reason||' '||coalesce(h.after_state->>'name','')||' '||coalesce(h.after_state->>'code','')) ILIKE $8 ORDER BY h.id DESC LIMIT $9`,
                [
                  customer,
                  page?.key ?? null,
                  page?.upper ?? null,
                  q.estateId ?? null,
                  q.recordId ?? null,
                  q.recordType ?? null,
                  q.requestId ?? null,
                  literalPattern(q.q),
                  q.limit + 1,
                ],
              )
            ).rows
          : (
              await c.query(
                `SELECT h.id::text,h.customer_id AS record_id,NULL::uuid AS estate_id,'customer'::text AS record_type,h.action,NULL::text AS reason,h.actor_id,coalesce(u.display_name,'System / migration') AS actor,h.detail->>'requestId' AS request_id,h.created_at,
 jsonb_build_object('code',h.detail#>>'{before,code}','name',h.detail#>>'{before,name}') AS before,jsonb_build_object('code',h.detail#>>'{after,code}','name',h.detail#>>'{after,name}') AS after
 FROM eoms.customer_history h LEFT JOIN eoms.users u ON u.id=h.actor_id WHERE h.customer_id=$1 AND ($2::bigint IS NULL OR h.id<$2) AND ($3::bigint IS NULL OR h.id<=$3) AND ($4::text IS NULL OR h.detail->>'requestId'=$4) AND (h.action||' '||coalesce(h.detail#>>'{after,name}','')||' '||coalesce(h.detail#>>'{after,code}','')) ILIKE $5 ORDER BY h.id DESC LIMIT $6`,
                [
                  customer,
                  page?.key ?? null,
                  page?.upper ?? null,
                  q.requestId ?? null,
                  literalPattern(q.q),
                  q.limit + 1,
                ],
              )
            ).rows;
        const projected = rows.map((row) => ({
          ...row,
          request_id: uuid.safeParse(row.request_id).success
            ? row.request_id
            : null,
        }));
        return {
          ...pageResult(
            projected,
            q.limit,
            binding,
            (r) => r.id,
            page?.upper ?? projected[0]?.id,
          ),
          newerChangesRequireRefresh: true,
        };
      }),
    );
  });
}
