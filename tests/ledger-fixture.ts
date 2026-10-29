import type pg from "pg";
import { randomUUID } from "node:crypto";
// Synthetic fixture through real, reasoned writes. No forged business history or disabled guards.
export async function seedDecisionLedger(
  db: pg.Pool,
  manager: string,
  reviewer: string,
  post: (
    actor: "manager" | "reviewer",
    path: string,
    data: object,
  ) => Promise<any>,
) {
  const code = "LED-" + randomUUID().slice(0, 8).toUpperCase();
  const customer = (
    await db.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,$2) RETURNING id",
      [code, "ZZZZ Decision ledger " + code],
    )
  ).rows[0].id;
  const company = (
    await db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Ledger baseline company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const target = (
    await db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Ledger second company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const own = (
    await db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Ledger principal estate') RETURNING id,code,name",
      [customer, company, code + "-OWN"],
    )
  ).rows[0];
  const other = (
    await db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Ledger anchor estate') RETURNING id",
      [customer, target, code + "-OTHER"],
    )
  ).rows[0];
  for (const actor of [manager, reviewer]) {
    await db.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [customer, actor],
    );
    for (const estate of [own.id, other.id])
      await db.query(
        "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
        [actor, estate],
      );
  }
  const area = await post("manager", `/customers/${customer}/areas`, {
    kind: "region",
    code: code + "-R",
    name: "Ledger destination",
    parentId: null,
    reason: "Prepare ledger destination",
  });
  const base = `/estates/${own.id}`,
    responsibilities: any[] = [],
    cancellations: any[] = [],
    moves: any[] = [];
  for (let i = 0; i < 56; i++) {
    const date = new Date(Date.UTC(2110, 0, 1 + i)).toISOString().slice(0, 10);
    const row = await post("manager", base + "/responsibility", {
      companyId: i === 0 ? target : company,
      effectiveFrom: date,
      revision: i,
      reason: `Ledger responsibility ${i} %_ exact`,
    });
    responsibilities.push(row);
    const request = await post(
      "manager",
      `${base}/responsibility/${row.id}/cancellation`,
      { revision: i + 1, reason: `Ledger cancellation ${i} %_ exact` },
    );
    cancellations.push(request);
    if (i > 0)
      await post(
        "reviewer",
        `${base}/responsibility/requests/${request.id}/decision`,
        {
          decision: "approved",
          revision: i + 1,
          reason: `Independent ledger cancellation ${i}`,
        },
      );
    const estate = i === 0 ? own.id : other.id;
    const move = await post("manager", `/estates/${estate}/placement-moves`, {
      toAreaId: area.id,
      version: 1,
      reason: `Ledger move ${i} %_ exact`,
    });
    moves.push(move);
    if (i > 0)
      await post(
        "reviewer",
        `/estates/${estate}/placement-moves/${move.id}/decision`,
        {
          decision: "rejected",
          version: 1,
          reason: `Independent ledger move ${i}`,
        },
      );
  }
  return {
    code,
    customer,
    company,
    target,
    own,
    other,
    area,
    responsibilities,
    cancellations,
    moves,
    base,
  };
}
