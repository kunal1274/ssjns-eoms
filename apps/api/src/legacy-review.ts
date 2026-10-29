import type { Express } from "express";
import { z } from "zod";
import type { EstateTx } from "./maintenance";
import { ApiError } from "./http";
import {
  literalPattern,
  pageFields,
  pageResult,
  readPage,
} from "./navigation-page";
const taskProjection = `o.id,o.estate_id,o.block_code,o.task_code,o.activity,o.round_code,o.capacity_ha,o.version,o.block_unit_id,u.name AS linked_block_name`;
export function legacyReviewRoutes(app: Express, estateTx: EstateTx) {
  for (const kind of ["tasks", "work"] as const)
    app.get(
      `/api/estates/:estateId/legacy-review/${kind}`,
      async (req, res) => {
        const q = z.object(pageFields).strict().parse(req.query);
        const binding = {
          route: "legacy-review",
          kind,
          estate: req.params.estateId,
          actor: res.locals.user.id,
          q: q.q,
        };
        const page = readPage(q.cursor, binding);
        res.json(
          await estateTx(req, res, false, async (c, id) => {
            const access = (
              await c.query(
                "SELECT e.active AND m.role='manager' AS can_link FROM eoms.estates e JOIN eoms.memberships m ON m.estate_id=e.id AND m.user_id=eoms.actor_id() WHERE e.id=$1",
                [id],
              )
            ).rows[0];
            const rows = (
              await c.query(
                kind === "tasks"
                  ? `SELECT ${taskProjection} FROM eoms.occurrences o LEFT JOIN eoms.operating_units u ON u.id=o.block_unit_id AND u.estate_id=o.estate_id WHERE o.estate_id=$1 AND o.block_unit_id IS NULL AND ($2::uuid IS NULL OR o.id>$2) AND (o.block_code||' '||o.task_code||' '||o.activity||' '||o.round_code||' '||o.id::text) ILIKE $3 ORDER BY o.id LIMIT $4`
                  : `SELECT m.id,m.estate_id,m.occurrence_id,m.business_date::text AS business_date,m.status,m.quantity_ha,m.version,o.block_code,o.task_code,o.block_unit_id AS current_task_block_id FROM eoms.musters m JOIN eoms.occurrences o ON o.id=m.occurrence_id AND o.estate_id=m.estate_id WHERE m.estate_id=$1 AND m.legal_company_id IS NULL AND ($2::uuid IS NULL OR m.id>$2) AND (m.id::text||' '||m.business_date::text||' '||m.status||' '||o.block_code||' '||o.task_code) ILIKE $3 ORDER BY m.id LIMIT $4`,
                [id, page?.key ?? null, literalPattern(q.q), q.limit + 1],
              )
            ).rows;
            return {
              ...pageResult(rows, q.limit, binding, (r) => r.id),
              canLink: access?.can_link === true,
            };
          }),
        );
      },
    );
  app.get(
    "/api/estates/:estateId/legacy-review/tasks/:id",
    async (req, res) => {
      const task = z.string().uuid().parse(req.params.id);
      res.json(
        await estateTx(req, res, false, async (c, id) => {
          const row = (
            await c.query(
              `SELECT ${taskProjection},e.active AND m.role='manager' AS can_link FROM eoms.occurrences o JOIN eoms.estates e ON e.id=o.estate_id JOIN eoms.memberships m ON m.estate_id=e.id AND m.user_id=eoms.actor_id() LEFT JOIN eoms.operating_units u ON u.id=o.block_unit_id AND u.estate_id=o.estate_id WHERE o.estate_id=$1 AND o.id=$2`,
              [id, task],
            )
          ).rows[0];
          if (!row)
            throw new ApiError(
              404,
              "This task is not available in your current estate scope. Refresh the review queue.",
            );
          const event =
            (
              await c.query(
                "SELECT h.id,h.actor_id,u.display_name AS actor,h.reason,h.request_id,h.created_at,h.before_state,h.after_state FROM eoms.hierarchy_history h LEFT JOIN eoms.users u ON u.id=h.actor_id WHERE h.estate_id=$1 AND h.record_id=$2 AND h.record_type='task-link' ORDER BY h.id DESC LIMIT 1",
                [id, task],
              )
            ).rows[0] ?? null;
          return { ...row, linkEvent: event };
        }),
      );
    },
  );
}
