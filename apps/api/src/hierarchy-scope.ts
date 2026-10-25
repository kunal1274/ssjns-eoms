import { readHierarchyPage, hierarchyPage } from "./hierarchy-read-page";
import type { Express } from "express";
import type { Transaction } from "./organization";
import { z } from "zod";
import { ApiError } from "./http";
import {
  pageFields,
  readPage,
  pageResult,
  literalPattern,
} from "./navigation-page";
import { hierarchyReadGrantInput } from "../../../packages/domain/hierarchy-scope";
export function hierarchyScopeRoutes(app: Express, tx: Transaction) {
  app.get("/api/hierarchy-scopes/contexts", async (req, res) => {
    const q = z
      .object({ limit: pageFields.limit, cursor: pageFields.cursor })
      .strict()
      .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await tx(res, async (c) => {
        const binding = {
            kind: "hierarchy-scope-context",
            actor: res.locals.user.id,
            limit: q.limit,
          },
          p = readPage(q.cursor, binding),
          rows = (
            await c.query(
              "SELECT * FROM eoms.hierarchy_scope_contexts() WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2",
              [p?.key ?? null, q.limit + 1],
            )
          ).rows;
        return pageResult(rows, q.limit, binding, (r) => r.id);
      }),
    );
  });
  app.get(
    "/api/customers/:customerId/hierarchy-scopes/read",
    async (req, res) => {
      const customer = z.string().uuid().parse(req.params.customerId),
        q = z
          .object({
            q: pageFields.q,
            limit: pageFields.limit,
            cursor: pageFields.cursor,
          })
          .strict()
          .parse(req.query);
      res.set("Cache-Control", "no-store").json(
        await tx(res, async (c) => {
          if (
            !(
              await c.query(
                "SELECT id FROM eoms.hierarchy_scope_contexts() WHERE id=$1",
                [customer],
              )
            ).rowCount
          )
            throw new ApiError(
              403,
              "No current explicit hierarchy-read assignment is available for this customer. Refresh your granted contexts.",
            );
          const binding = {
              kind: "hierarchy-scope-read",
              customer,
              actor: res.locals.user.id,
              q: q.q,
              limit: q.limit,
            },
            p = readHierarchyPage(q.cursor, binding),
            rows = (
              await c.query(
                "SELECT * FROM eoms.read_hierarchy_scope($1) WHERE ($2::text IS NULL OR (kind,id)>($2::text,$3::uuid)) AND (code ILIKE $4 ESCAPE '\\' OR name ILIKE $4 ESCAPE '\\') ORDER BY kind,id LIMIT $5",
                [
                  customer,
                  p?.kind ?? null,
                  p?.id ?? null,
                  literalPattern(q.q),
                  q.limit + 1,
                ],
              )
            ).rows;
          return {
            ...hierarchyPage(rows, q.limit, binding),
            permission: "hierarchy.read",
            workAccessGranted: false,
            readWindow: true,
          };
        }),
      );
    },
  );
  app.get(
    "/api/customers/:customerId/hierarchy-scopes/nodes",
    async (req, res) => {
      const customer = z.string().uuid().parse(req.params.customerId),
        q = z
          .object({
            nodeKind: z.enum([
              "customer",
              "group",
              "company",
              "area",
              "estate",
              "unit",
              "site",
            ]),
            q: pageFields.q,
            limit: pageFields.limit,
            cursor: pageFields.cursor,
          })
          .strict()
          .parse(req.query);
      res.set("Cache-Control", "no-store").json(
        await tx(res, async (c) => {
          const binding = {
              kind: "hierarchy-assignment-nodes",
              customer,
              nodeKind: q.nodeKind,
              q: q.q,
              actor: res.locals.user.id,
              limit: q.limit,
            },
            p = readHierarchyPage(q.cursor, binding),
            rows = (
              await c.query(
                "SELECT * FROM eoms.hierarchy_assignment_nodes($1) WHERE kind=$2 AND ($3::text IS NULL OR (kind,id)>($3::text,$4::uuid)) AND (code ILIKE $5 ESCAPE '\\' OR name ILIKE $5 ESCAPE '\\') ORDER BY kind,id LIMIT $6",
                [
                  customer,
                  q.nodeKind,
                  p?.kind ?? null,
                  p?.id ?? null,
                  literalPattern(q.q),
                  q.limit + 1,
                ],
              )
            ).rows;
          return hierarchyPage(rows, q.limit, binding);
        }),
      );
    },
  );
  app.get("/api/customers/:customerId/hierarchy-scopes", async (req, res) => {
    const customer = z.string().uuid().parse(req.params.customerId),
      q = z
        .object({
          subjectId: z.string().uuid().optional(),
          nodeKind: z
            .enum([
              "customer",
              "group",
              "company",
              "area",
              "estate",
              "unit",
              "site",
            ])
            .optional(),
          nodeId: z.string().uuid().optional(),
          limit: pageFields.limit,
          cursor: pageFields.cursor,
        })
        .strict()
        .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await tx(res, async (c) => {
        if (
          !(
            await c.query("SELECT eoms.can_manage_customer($1) AS ok", [
              customer,
            ])
          ).rows[0].ok
        )
          throw new ApiError(
            403,
            "Customer setup authority is required to inspect hierarchy scope history.",
          );
        const binding = {
            kind: "hierarchy-scope-history",
            customer,
            actor: res.locals.user.id,
            subject: q.subjectId ?? null,
            nodeKind: q.nodeKind ?? null,
            node: q.nodeId ?? null,
            limit: q.limit,
          },
          p = readPage(q.cursor, binding),
          filter = [
            customer,
            q.subjectId ?? null,
            q.nodeKind ?? null,
            q.nodeId ?? null,
          ],
          rows = (
            await c.query(
              "SELECT * FROM eoms.hierarchy_read_grants WHERE customer_id=$1 AND ($2::uuid IS NULL OR subject_id=$2) AND ($3::text IS NULL OR node_kind=$3) AND ($4::uuid IS NULL OR node_id=$4) AND ($5::uuid IS NULL OR id>$5) ORDER BY id LIMIT $6",
              [...filter, p?.key ?? null, q.limit + 1],
            )
          ).rows,
          head =
            q.subjectId && q.nodeKind && q.nodeId
              ? ((
                  await c.query(
                    "SELECT * FROM eoms.hierarchy_read_grants WHERE customer_id=$1 AND subject_id=$2 AND node_kind=$3 AND node_id=$4 ORDER BY revision DESC LIMIT 1",
                    filter,
                  )
                ).rows[0] ?? null)
              : null;
        return { ...pageResult(rows, q.limit, binding, (r) => r.id), head };
      }),
    );
  });
  app.post("/api/customers/:customerId/hierarchy-scopes", async (req, res) => {
    const customer = z.string().uuid().parse(req.params.customerId),
      v = hierarchyReadGrantInput.parse(req.body);
    res.json(
      await tx(res, async (c) => {
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        try {
          return (
            await c.query(
              "SELECT eoms.record_hierarchy_read_grant($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value",
              [
                customer,
                v.subjectId,
                v.nodeKind,
                v.nodeId,
                v.inheritance,
                v.action,
                v.key,
                v.expectedRevision,
                v.reference,
                v.reason,
              ],
            )
          ).rows[0].value;
        } catch (e) {
          if ((e as { code?: string }).code === "23505")
            throw new ApiError(
              409,
              "The hierarchy assignment revision or retry reference changed. Refresh the selected subject and node before correcting the retained draft; retry an unchanged uncertain submission.",
            );
          throw e;
        }
      }),
    );
  });
}
