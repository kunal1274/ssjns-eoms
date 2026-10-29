import type { Express } from "express";
import { z } from "zod";
import { ApiError } from "./http";
import { estateContext, visibleCustomer } from "./hierarchy";
import { literalPattern, pageFields } from "./navigation-page";
import type { Transaction } from "./organization";
const uuid = z.string().uuid();
const point = z
  .object({
    at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
      .refine((v) => {
        const d = new Date(v);
        return !isNaN(+d) && d.toISOString().slice(0, 23) === v.slice(0, 23);
      }),
    id: uuid,
  })
  .strict();
const cursorSchema = z
  .object({
    v: z.literal(1),
    binding: z.string().max(1800),
    key: point,
    upper: point,
  })
  .strict();
export function readLedgerPage(raw: string | undefined, binding: object) {
  if (!raw) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
    const p = cursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (
      p.binding !== JSON.stringify(binding) ||
      p.key.at > p.upper.at ||
      (p.key.at === p.upper.at && p.key.id > p.upper.id)
    )
      throw Error();
    return p;
  } catch {
    throw new ApiError(
      422,
      "This ledger page reference is invalid or belongs to different filters or account. Search again from the first page.",
    );
  }
}
const profiles = [
  {
    kind: "responsibility",
    route: "/api/navigation/estates/:estateId/responsibilities",
    customer: false,
    statuses: ["all", "active", "cancelled"] as const,
    sql: `SELECT r.id,r.estate_id,r.company_id,r.previous_company_id,r.replaces_responsibility_id,r.effective_from::text AS effective_from,r.revision,r.reason,r.actor_id,r.request_id,r.created_at,c.name AS company_name,p.name AS previous_company_name,u.display_name AS actor,
      CASE WHEN a.id IS NULL THEN 'cancelled' ELSE 'active' END AS status,
      (a.id IS NULL AND NOT EXISTS(SELECT 1 FROM eoms.estate_responsibilities replacement WHERE replacement.replaces_responsibility_id=r.id)) AS can_choose,
      ('Revision '||r.revision||' · '||r.effective_from||' · '||c.name) AS name,
      NULL::uuid AS decision_reference,
      to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_time,
      concat_ws(' ',r.id,r.reason,r.effective_from,r.revision,c.name,p.name,u.display_name,r.request_id,r.replaces_responsibility_id) AS searchtext
      FROM eoms.estate_responsibilities r JOIN eoms.companies c ON c.id=r.company_id JOIN eoms.companies p ON p.id=r.previous_company_id LEFT JOIN eoms.users u ON u.id=r.actor_id LEFT JOIN eoms.active_estate_responsibilities a ON a.id=r.id WHERE r.estate_id=$1 AND $2::uuid IS NOT NULL`,
  },
  {
    kind: "cancellation",
    route: "/api/navigation/estates/:estateId/cancellations",
    customer: false,
    statuses: ["all", "pending", "approved", "rejected"] as const,
    sql: `SELECT q.id,q.estate_id,q.responsibility_id,q.requester_id,q.reason,q.expected_revision,q.request_id,q.created_at,u.display_name AS requester,d.id AS decision_id,d.decision,d.reason AS decision_reason,d.reviewer_id,d.request_id AS decision_reference,d.created_at AS decided_at,v.display_name AS reviewer,
      coalesce(d.decision,'pending') AS status,(d.id IS NULL AND q.requester_id<>$2) AS can_choose,
      (u.display_name||' · '||q.reason) AS name,
      to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_time,
      concat_ws(' ',q.id,q.reason,q.responsibility_id,u.display_name,v.display_name,d.reason,q.request_id,d.request_id) AS searchtext
      FROM eoms.responsibility_cancel_requests q LEFT JOIN eoms.users u ON u.id=q.requester_id LEFT JOIN eoms.responsibility_cancel_decisions d ON d.cancel_request_id=q.id LEFT JOIN eoms.users v ON v.id=d.reviewer_id WHERE q.estate_id=$1`,
  },
  {
    kind: "move",
    route: "/api/navigation/customers/:customerId/moves",
    customer: true,
    statuses: ["all", "pending", "approved", "rejected"] as const,
    sql: `SELECT q.id,q.estate_id,q.from_area_id,q.to_area_id,q.expected_version,q.reason,q.requester_id,q.request_id,q.created_at,u.display_name AS requester,d.id AS decision_id,d.decision,d.reason AS decision_reason,d.reviewer_id,d.request_id AS decision_reference,d.created_at AS decided_at,v.display_name AS reviewer,e.name AS estate_name,e.code AS estate_code,f.name AS from_area_name,t.name AS to_area_name,
      coalesce(d.decision,'pending') AS status,(d.id IS NULL AND q.requester_id<>$2) AS can_choose,
      (e.code||' · '||e.name||' · '||q.reason) AS name,
      to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_time,
      concat_ws(' ',q.id,q.reason,e.code,e.name,u.display_name,v.display_name,d.reason,q.request_id,d.request_id,f.name,t.name) AS searchtext
      FROM eoms.placement_move_requests q JOIN eoms.estates e ON e.id=q.estate_id LEFT JOIN eoms.users u ON u.id=q.requester_id LEFT JOIN eoms.placement_move_decisions d ON d.move_request_id=q.id LEFT JOIN eoms.users v ON v.id=d.reviewer_id LEFT JOIN eoms.operating_areas f ON f.id=q.from_area_id LEFT JOIN eoms.operating_areas t ON t.id=q.to_area_id WHERE q.customer_id=$1 AND EXISTS(SELECT 1 FROM eoms.memberships m WHERE m.estate_id=q.estate_id AND m.user_id=$2)`,
  },
];
export function decisionLedgerRoutes(app: Express, tx: Transaction) {
  for (const profile of profiles)
    app.get(profile.route, async (req, res) => {
      const scope = uuid.parse(
        profile.customer ? req.params.customerId : req.params.estateId,
      );
      const q = z
        .object({
          ...pageFields,
          cursor: z.string().max(4000).optional(),
          status: z.enum(profile.statuses).default("all"),
          purpose: z.enum(["all", "choice"]).default("all"),
          selectedId: uuid.optional(),
          requestId: uuid.optional(),
          ...(profile.customer ? { estateId: uuid.optional() } : {}),
        })
        .strict()
        .parse(req.query);
      const estateId =
        "estateId" in q ? (q.estateId as string | undefined) : undefined;
      const binding = {
        route: profile.kind,
        scope,
        actor: res.locals.user.id,
        q: q.q,
        status: q.status,
        purpose: q.purpose,
        requestId: q.requestId ?? null,
        estateId: estateId ?? null,
      };
      const page = readLedgerPage(q.cursor, binding);
      res.json(
        await tx(res, async (c) => {
          if (profile.customer) {
            await visibleCustomer(c, scope);
            if (estateId) {
              const e = await estateContext(c, estateId);
              if (e.customer_id !== scope)
                throw new ApiError(
                  404,
                  "Estate is not available in this customer.",
                );
            }
          } else await estateContext(c, scope);
          const cte = `WITH records AS (${profile.sql})`;
          const rows = (
            await c.query(
              `${cte} SELECT * FROM records r WHERE ($3::text='%%' OR r.searchtext ILIKE $3) AND ($4='all' OR r.status=$4) AND ($5='all' OR r.can_choose) AND ($6::uuid IS NULL OR r.request_id=$6 OR r.decision_reference=$6) AND ($7::timestamptz IS NULL OR (r.created_at,r.id)<($7::timestamptz,$8::uuid)) AND ($9::timestamptz IS NULL OR (r.created_at,r.id)<=($9::timestamptz,$10::uuid)) AND ($12::uuid IS NULL OR r.estate_id=$12) ORDER BY r.created_at DESC,r.id DESC LIMIT $11`,
              [
                scope,
                res.locals.user.id,
                literalPattern(q.q),
                q.status,
                q.purpose,
                q.requestId ?? null,
                page?.key.at ?? null,
                page?.key.id ?? null,
                page?.upper.at ?? null,
                page?.upper.id ?? null,
                q.limit + 1,
                estateId ?? null,
              ],
            )
          ).rows;
          const pin = q.selectedId
            ? (
                await c.query(
                  `${cte} SELECT * FROM records WHERE id=$3 AND ($4::uuid IS NULL OR estate_id=$4)`,
                  [scope, res.locals.user.id, q.selectedId, estateId ?? null],
                )
              ).rows[0]
            : null;
          if (q.selectedId && !pin)
            throw new ApiError(
              404,
              "Selected ledger record is not available in this scope and account. Review access and choose again.",
            );
          const eligible = (r: any) =>
            (q.status === "all" || q.status === r.status) &&
            (q.purpose === "all" || r.can_choose);
          const project = (r: any) => {
            const { searchtext, page_time, can_choose, ...publicRow } = r;
            return {
              ...publicRow,
              eligible: eligible(r),
              choice_eligible: can_choose,
            };
          };
          const items = rows.slice(0, q.limit),
            upper =
              page?.upper ??
              (rows[0] ? { at: rows[0].page_time, id: rows[0].id } : null),
            last = items.at(-1);
          return {
            items: items.map(project),
            selected: pin ? project(pin) : null,
            nextCursor:
              rows.length > q.limit
                ? Buffer.from(
                    JSON.stringify({
                      v: 1,
                      binding: JSON.stringify(binding),
                      upper,
                      key: { at: last.page_time, id: last.id },
                    }),
                  ).toString("base64url")
                : null,
            newerRequestsRequireRefresh: true,
          };
        }),
      );
    });
}
