import type { Express } from "express";
import type { PoolClient } from "pg";
import type { EstateTx } from "./maintenance";
import { z } from "zod";
import { ApiError } from "./http";
import { pageFields, readPage, pageResult } from "./navigation-page";
import {
  overlayAuthorityInput,
  overlayExecutionInput,
} from "../../../packages/domain/mapping-overlay";
export function mappingOverlayRoutes(app: Express, estateTx: EstateTx) {
  const base = "/api/estates/:estateId/reconciliation",
    request = base + "/mapping-requests/:requestId";
  async function gate(c: PoolClient, estate: string, id?: string) {
    if (
      !(
        await c.query("SELECT eoms.can_review_reconciliation($1) AS ok", [
          estate,
        ])
      ).rows[0].ok
    )
      throw new ApiError(
        403,
        "Estate-manager and customer setup access is required for attribution overlays.",
      );
    if (
      id &&
      !(
        await c.query(
          "SELECT id FROM eoms.mapping_requests WHERE id=$1 AND estate_id=$2",
          [id, estate],
        )
      ).rowCount
    )
      throw new ApiError(
        404,
        "Mapping request is not available in this estate scope.",
      );
  }
  function conflict(e: unknown): never {
    if ((e as { code?: string }).code === "23505")
      throw new ApiError(
        409,
        "The execution authorization, approval, evidence, work or receipt changed. Refresh and inspect the current state. Compensate an existing application before preparing a linked correction; retry only an unchanged uncertain submission.",
      );
    throw e;
  }
  app.get(request + "/execution-authority", async (req, res) => {
    const id = z.string().uuid().parse(req.params.requestId),
      q = z
        .object({
          subjectId: z.string().uuid().optional(),
          purpose: z.enum(["apply", "compensate"]).default("apply"),
          limit: pageFields.limit,
          cursor: pageFields.cursor,
        })
        .strict()
        .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, estate) => {
        await gate(c, estate, id);
        const subject = q.subjectId ?? res.locals.user.id,
          binding = {
            kind: "overlay-authority",
            estate,
            request: id,
            subject,
            purpose: q.purpose,
            actor: res.locals.user.id,
            limit: q.limit,
          },
          p = readPage(q.cursor, binding);
        const rows = (
          await c.query(
            "SELECT * FROM eoms.mapping_execution_authority WHERE mapping_request_id=$1 AND subject_id=$2 AND purpose=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5",
            [id, subject, q.purpose, p?.key ?? null, q.limit + 1],
          )
        ).rows;
        return {
          ...pageResult(rows, q.limit, binding, (r) => r.id),
          state: (
            await c.query(
              "SELECT eoms.mapping_execution_state($1,$2,$3) AS value",
              [id, subject, q.purpose],
            )
          ).rows[0].value,
          actorId: res.locals.user.id,
        };
      }),
    );
  });
  app.post(request + "/execution-authority", async (req, res) => {
    const id = z.string().uuid().parse(req.params.requestId),
      v = overlayAuthorityInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, estate) => {
        await gate(c, estate, id);
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        try {
          return (
            await c.query(
              "SELECT eoms.appoint_mapping_executor($1,$2,$3,$4,$5,$6,$7,$8) AS value",
              [
                id,
                v.subjectId,
                v.purpose,
                v.key,
                v.expectedRevision,
                v.action,
                v.reference,
                v.reason,
              ],
            )
          ).rows[0].value;
        } catch (e) {
          return conflict(e);
        }
      }),
    );
  });
  app.get(request + "/execution", async (req, res) => {
    const id = z.string().uuid().parse(req.params.requestId);
    z.object({}).strict().parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, estate) => {
        await gate(c, estate, id);
        const state = (
            await c.query("SELECT eoms.mapping_request_state($1) AS value", [
              id,
            ])
          ).rows[0].value,
          receipts = (
            await c.query(
              "SELECT * FROM eoms.mapping_overlay_receipts WHERE mapping_request_id=$1 ORDER BY CASE WHEN kind='applied' THEN 0 ELSE 1 END",
              [id],
            )
          ).rows,
          rows = (
            await c.query(
              "SELECT o.*,m.legal_company_id AS current_original_company_id,m.version AS current_version FROM eoms.mapping_overlay_rows o JOIN eoms.mapping_overlay_receipts p ON p.id=o.receipt_id JOIN eoms.musters m ON m.id=o.record_id AND m.estate_id=o.estate_id WHERE p.mapping_request_id=$1 ORDER BY o.record_id",
              [id],
            )
          ).rows,
          ownApply = (
            await c.query(
              "SELECT eoms.mapping_execution_state($1,$2,'apply') AS value",
              [id, res.locals.user.id],
            )
          ).rows[0].value,
          ownCompensate = (
            await c.query(
              "SELECT eoms.mapping_execution_state($1,$2,'compensate') AS value",
              [id, res.locals.user.id],
            )
          ).rows[0].value;
        return {
          state,
          receipts,
          rows,
          ownApply,
          ownCompensate,
          actorId: res.locals.user.id,
          active: receipts.length === 1,
          applicationAvailable: true,
          downstreamDispatched: false,
        };
      }),
    );
  });
  app.post(request + "/execution", async (req, res) => {
    const id = z.string().uuid().parse(req.params.requestId),
      v = overlayExecutionInput.parse(req.body);
    res.json(
      await estateTx(req, res, false, async (c, estate) => {
        await gate(c, estate, id);
        await c.query("SELECT set_config('app.request_id',$1,true)", [
          res.locals.requestId,
        ]);
        try {
          return (
            await c.query(
              "SELECT eoms.execute_mapping_overlay($1,$2,$3,$4,$5,$6,$7,$8) AS value",
              [
                id,
                v.authorityId,
                v.key,
                v.operation,
                v.previousId,
                v.reference,
                v.reason,
                v.examined,
              ],
            )
          ).rows[0].value;
        } catch (e) {
          return conflict(e);
        }
      }),
    );
  });
  app.get(base + "/overlay-register", async (req, res) => {
    const q = z
      .object({ limit: pageFields.limit, cursor: pageFields.cursor })
      .strict()
      .parse(req.query);
    res.set("Cache-Control", "no-store").json(
      await estateTx(req, res, false, async (c, estate) => {
        await gate(c, estate);
        const binding = {
            kind: "overlay-register",
            estate,
            actor: res.locals.user.id,
            limit: q.limit,
          },
          p = readPage(q.cursor, binding);
        // Only uncompensated immutable application rows contribute to the adjusted projection.
        const cte = `WITH active AS (SELECT o.* FROM eoms.mapping_overlay_rows o WHERE o.estate_id=$1 AND NOT EXISTS(SELECT 1 FROM eoms.mapping_overlay_receipts c WHERE c.previous_id=o.receipt_id))`;
        const rows = (
          await c.query(
            cte +
              " SELECT m.id,m.business_date::text,m.quantity_ha,m.version,m.legal_company_id AS original_company_id,coalesce(m.legal_company_id,a.adjusted_company_id) AS adjusted_company_id,a.receipt_id,a.adjusted_company_name,a.record_version,coalesce(a.record_version=m.version,true) AS version_current FROM eoms.musters m LEFT JOIN active a ON a.record_id=m.id WHERE m.estate_id=$1 AND ($2::uuid IS NULL OR m.id>$2) ORDER BY m.id LIMIT $3",
            [estate, p?.key ?? null, q.limit + 1],
          )
        ).rows;
        const totals = (
          await c.query(
            cte +
              " SELECT count(*)::int AS records, count(*) FILTER(WHERE m.legal_company_id IS NULL)::int AS original_unresolved,count(*) FILTER(WHERE m.legal_company_id IS NULL AND a.receipt_id IS NULL)::int AS adjusted_unresolved,count(a.receipt_id)::int AS active_overlay_rows,coalesce(sum(m.quantity_ha),0)::text AS original_quantity_ha,coalesce(sum(m.quantity_ha),0)::text AS adjusted_quantity_ha FROM eoms.musters m LEFT JOIN active a ON a.record_id=m.id WHERE m.estate_id=$1",
            [estate],
          )
        ).rows[0];
        return {
          ...pageResult(rows, q.limit, binding, (r) => r.id),
          totals,
          readWindow: true,
          downstreamDispatched: false,
        };
      }),
    );
  });
}
