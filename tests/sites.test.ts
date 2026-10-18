import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createApp } from "../apps/api/src/app";
const runtime = new URL(process.env.DATABASE_URL!),
  root = new URL(process.env.ADMIN_DATABASE_URL!);
if (runtime.hostname !== "127.0.0.1" || root.hostname !== "127.0.0.1")
  throw Error("Local synthetic databases required");
runtime.pathname = root.pathname = "/eoms_test";
const pool = new pg.Pool({ connectionString: runtime.href }),
  admin = new pg.Pool({ connectionString: root.href }),
  app = createApp(pool);
let manager: any,
  supervisor: any,
  reviewer: any,
  customer: string,
  company: string,
  otherCompany: string,
  estate: string,
  hiddenEstate: string,
  foreignCompany: string,
  linked: any,
  unlinked: any;
const base = () => `/api/customers/${customer}/sites`;
function post(actor: any, path: string, body: any) {
  return actor.agent
    .post(path)
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", actor.csrf)
    .send(body);
}
function payload(overrides: any = {}) {
  return {
    kind: "mill",
    code: "S-" + randomUUID().slice(0, 15),
    name: "Fixture facility",
    companyId: company,
    estateId: estate,
    reason: "Approved synthetic site setup",
    ...overrides,
  };
}
before(async () => {
  const accounts = JSON.parse(
    await readFile(".local/test-accounts.json", "utf8"),
  );
  async function login(email: string) {
    const agent = request.agent(app),
      r = await agent
        .post("/api/auth/login")
        .set("Origin", "http://localhost:5174")
        .send({
          email,
          password: accounts.find((a: any) => a.email === email).password,
        });
    assert.equal(r.status, 200);
    return { agent, id: r.body.user.id, csrf: r.body.csrf };
  }
  manager = await login("manager@eoms.local");
  supervisor = await login("supervisor@eoms.local");
  reviewer = await login("reviewer@eoms.local");
  customer = (
    await admin.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,'Site fixture customer') RETURNING id",
      ["SITE-" + randomUUID()],
    )
  ).rows[0].id;
  company = (
    await admin.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Site responsible company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  otherCompany = (
    await admin.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Site-only company label') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  estate = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,'SITE-OWN','Assigned site estate') RETURNING id",
      [customer, company],
    )
  ).rows[0].id;
  hiddenEstate = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,'SITE-HIDDEN','Hidden sibling') RETURNING id",
      [customer, otherCompany],
    )
  ).rows[0].id;
  for (const actor of [manager, supervisor])
    await admin.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,$3)",
      [actor.id, estate, actor === manager ? "manager" : "supervisor"],
    );
  for (const actor of [manager, reviewer])
    await admin.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [customer, actor.id],
    );
  foreignCompany = (
    await admin.query(
      "WITH t AS (INSERT INTO eoms.customers(code,name) VALUES($1,'Foreign site customer') RETURNING id) INSERT INTO eoms.companies(customer_id,name) SELECT id,'Foreign company' FROM t RETURNING id",
      ["FOREIGN-SITE-" + randomUUID()],
    )
  ).rows[0].id;
});
after(async () => {
  // Preserve append-only records while removing this fixture's temporary authority.
  if (customer) {
    await admin.query(
      "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=ANY($2::uuid[])",
      [estate, [manager.id, supervisor.id]],
    );
    await admin.query(
      "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=ANY($2::uuid[])",
      [customer, [manager.id, reviewer.id]],
    );
  }
  await pool.end();
  await admin.end();
});
test("typed sites persist all types, explicit unlinked configuration and scoped labels without sibling work access", async () => {
  for (const kind of ["mill", "nursery", "warehouse", "workshop", "other"]) {
    const r = await post(
      manager,
      base(),
      payload({ kind, companyId: otherCompany }),
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.kind, kind);
    assert.equal(r.body.version, 1);
    if (kind === "mill") linked = r.body;
  }
  const u = await post(
    manager,
    base(),
    payload({ estateId: null, name: "Unlinked setup facility" }),
  );
  assert.equal(u.status, 201);
  unlinked = u.body;
  const foreignCustomer = (
    await admin.query("SELECT customer_id FROM eoms.companies WHERE id=$1", [
      foreignCompany,
    ])
  ).rows[0].customer_id;
  await admin.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [foreignCustomer, manager.id],
  );
  try {
    const reused = await post(
      manager,
      `/api/customers/${foreignCustomer}/sites`,
      payload({ companyId: foreignCompany, estateId: null, code: linked.code }),
    );
    assert.equal(reused.status, 201, JSON.stringify(reused.body));
  } finally {
    await admin.query(
      "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
      [foreignCustomer, manager.id],
    );
  }

  const own = await supervisor.agent.get(base() + "/" + linked.id);
  assert.equal(own.status, 200);
  assert.equal(own.body.company_name, "Site-only company label");
  assert.equal(own.body.can_configure, false);
  assert.equal(
    (await supervisor.agent.get(base() + "/" + unlinked.id)).status,
    404,
  );
  assert.equal(
    (await reviewer.agent.get(base() + "/" + unlinked.id)).status,
    200,
  );
  assert.equal(
    (await reviewer.agent.get(base() + "/" + linked.id)).status,
    404,
  );
  assert.equal(
    (await reviewer.agent.get(base() + "/context")).body.canConfigure,
    true,
  );
  assert.equal(
    (await supervisor.agent.get(`/api/estates/${hiddenEstate}/musters`)).status,
    403,
  );
  assert.equal((await request(app).get(base() + "/" + linked.id)).status, 401);
});
test("site writes reject foreign references, missing authority, invalid identity and paused linked estates", async () => {
  assert.equal((await post(supervisor, base(), payload())).status, 403);
  assert.equal((await post(reviewer, base(), payload())).status, 404);
  assert.equal(
    (await post(manager, base(), payload({ companyId: foreignCompany })))
      .status,
    404,
  );
  assert.equal(
    (await post(manager, base(), payload({ estateId: hiddenEstate }))).status,
    404,
  );
  for (const change of [
    { kind: "block" },
    { code: "bad space" },
    { reason: " " },
    { active: false },
  ])
    assert.equal((await post(manager, base(), payload(change))).status, 422);
  const paused = await post(manager, `/api/estates/${estate}/lifecycle`, {
    active: false,
    version: 1,
    reason: "Pause fixture estate for site validation",
  });
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  assert.equal((await post(manager, base(), payload())).status, 409);
  assert.equal(
    (
      await post(manager, `/api/estates/${estate}/lifecycle`, {
        active: true,
        version: 2,
        reason: "Resume fixture estate",
      })
    ).status,
    200,
  );
});
test("site edits retain immutable identity, audit provenance and prevent stale/no-op/duplicate writes", async () => {
  const r = await post(manager, base() + "/" + linked.id, {
    name: "Reviewed facility",
    active: false,
    version: 1,
    reason: "Pause and rename after review",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.version, 2);
  assert.equal(r.body.company_id, otherCompany);
  assert.equal(r.body.estate_id, estate);
  const stale = await post(manager, base() + "/" + linked.id, {
    name: "Stale value",
    active: true,
    version: 1,
    reason: "Stale edit must not save",
  });
  assert.equal(stale.status, 409);
  assert.equal(
    (
      await post(manager, base() + "/" + linked.id, {
        name: "Reviewed facility",
        active: false,
        version: 2,
        reason: "No actual change",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await post(manager, base() + "/" + linked.id, {
        name: "New",
        active: true,
        version: 2,
        companyId: company,
        reason: "Cannot move scope",
      })
    ).status,
    422,
  );
  assert.equal(
    (await post(manager, base(), payload({ code: linked.code }))).status,
    409,
  );
  const h = await manager.agent.get(base() + "/" + linked.id + "/history");
  assert.equal(h.status, 200);
  assert.equal(h.body.items.length, 2);
  const change = h.body.items[0];
  assert.equal(change.actor_id, manager.id);
  assert.equal(change.before.version, 1);
  assert.equal(change.after.version, 2);
  assert.equal(change.reason, "Pause and rename after review");
  assert.match(change.request_id, /^[0-9a-f-]{36}$/);
  assert.equal("detail" in change, false);
  assert.equal(
    (await supervisor.agent.get(base() + "/" + linked.id + "/history")).status,
    200,
  );
});
test("site navigation binds scope, filters, pins and literal search; history remains pageable across new changes", async () => {
  for (let i = 0; i < 28; i++)
    assert.equal(
      (
        await post(
          manager,
          base(),
          payload({
            kind: "warehouse",
            name: i === 0 ? "Literal %_ facility" : "Paged facility " + i,
          }),
        )
      ).status,
      201,
    );
  const nav = `/api/navigation/customers/${customer}/sites`;
  const first = await manager.agent.get(nav + "?limit=2");
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.nextCursor);
  const second = await manager.agent.get(
    nav + "?limit=2&cursor=" + first.body.nextCursor,
  );
  assert.equal(second.status, 200);
  assert.ok(
    !second.body.items.some((x: any) =>
      first.body.items.some((y: any) => y.id === x.id),
    ),
  );
  assert.equal(
    (
      await manager.agent.get(
        nav + "?status=active&cursor=" + first.body.nextCursor,
      )
    ).status,
    422,
  );
  assert.equal(
    (await supervisor.agent.get(nav + "?cursor=" + first.body.nextCursor))
      .status,
    422,
  );
  const pin = await manager.agent.get(
    nav + "?q=nonmatching&selectedId=" + linked.id,
  );
  assert.equal(pin.body.items.length, 0);
  assert.equal(pin.body.selected.id, linked.id);
  const literal = await manager.agent.get(
    nav + "?q=" + encodeURIComponent("%_"),
  );
  assert.equal(literal.body.items.length, 1);
  assert.equal(literal.body.items[0].name, "Literal %_ facility");
  assert.equal(
    (await supervisor.agent.get(nav + "?selectedId=" + unlinked.id)).status,
    404,
  );
  const h = await manager.agent.get(
    base() + "/" + linked.id + "/history?limit=1",
  );
  assert.ok(h.body.nextCursor);
  assert.equal(
    (
      await post(manager, base() + "/" + linked.id, {
        name: "Reviewed facility",
        active: true,
        version: 2,
        reason: "Resume fixture site",
      })
    ).status,
    200,
  );
  const old = await manager.agent.get(
    base() + "/" + linked.id + "/history?cursor=" + h.body.nextCursor,
  );
  assert.equal(old.status, 200);
  assert.equal(old.body.items.length, 1);
  assert.equal(old.body.items[0].action, "created");
  assert.equal(
    (
      await manager.agent.get(
        base() +
          "/" +
          linked.id +
          "/history?q=other&cursor=" +
          h.body.nextCursor,
      )
    ).status,
    422,
  );
});
test("direct site database scope, history immutability and actor switching fail closed", async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    assert.equal(
      (await c.query("SELECT * FROM eoms.operational_sites")).rowCount,
      0,
    );
    await c.query("SELECT set_config('app.user_id',$1,true)", [manager.id]);
    assert.ok(
      (
        await c.query(
          "SELECT * FROM eoms.operational_sites WHERE customer_id=$1",
          [customer],
        )
      ).rowCount! > 0,
    );
    let n = 0;
    async function denied(sql: string, args: any[] = [], code?: string) {
      const save = "site_check_" + n++;
      await c.query("SAVEPOINT " + save);
      try {
        if (code) await assert.rejects(c.query(sql, args), { code });
        else await assert.rejects(c.query(sql, args));
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT " + save);
      }
    }
    await denied(
      "UPDATE eoms.site_history SET reason=$1 WHERE site_id=$2",
      ["tamper", linked.id],
      "42501",
    );
    await denied(
      "DELETE FROM eoms.operational_sites WHERE id=$1",
      [linked.id],
      "42501",
    );
    await denied(
      "UPDATE eoms.operational_sites SET company_id=$1 WHERE id=$2",
      [company, linked.id],
      "42501",
    );
    await denied(
      "UPDATE eoms.operational_sites SET name=$1,version=version+1 WHERE id=$2",
      ["No reason", linked.id],
      "23514",
    );
    await c.query(
      "SELECT set_config('app.change_reason','Direct constraint fixture',true)",
    );
    await denied(
      "UPDATE eoms.operational_sites SET name=$1,version=99 WHERE id=$2",
      ["Wrong version", linked.id],
      "23514",
    );
    await denied(
      "INSERT INTO eoms.operational_sites(customer_id,company_id,kind,code,name) VALUES($1,$2,'mill','FOREIGN-FK','Foreign FK')",
      [customer, foreignCompany],
      "23503",
    );
    await c.query("SELECT set_config('app.user_id',$1,true)", [supervisor.id]);
    assert.equal(
      (
        await c.query("SELECT * FROM eoms.operational_sites WHERE id=$1", [
          unlinked.id,
        ])
      ).rowCount,
      0,
    );
    await c.query("SELECT set_config('app.user_id','',true)");
    assert.equal(
      (await c.query("SELECT * FROM eoms.site_history")).rowCount,
      0,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
});
test("revoked site scope is rechecked on pins, detail, history and edits", async () => {
  await admin.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [customer, manager.id],
  );
  try {
    assert.equal(
      (await manager.agent.get(base() + "/" + unlinked.id)).status,
      404,
    );
    assert.equal(
      (await manager.agent.get(base() + "/" + unlinked.id + "/history")).status,
      404,
    );
    assert.equal(
      (
        await post(manager, base() + "/" + linked.id, {
          name: "Forbidden",
          active: true,
          version: 3,
          reason: "Grant was revoked",
        })
      ).status,
      403,
    );
  } finally {
    await admin.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [customer, manager.id],
    );
  }
  await admin.query(
    "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
    [supervisor.id, estate],
  );
  assert.equal(
    (
      await supervisor.agent.get(
        `/api/navigation/customers/${customer}/sites?selectedId=${linked.id}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await supervisor.agent.get(base() + "/" + linked.id + "/history")).status,
    404,
  );
});
