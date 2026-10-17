import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
const runtime = new URL(process.env.DATABASE_URL!),
  root = new URL(process.env.ADMIN_DATABASE_URL!);
if (root.hostname !== "127.0.0.1" || runtime.hostname !== "127.0.0.1")
  throw Error("Local test databases required");
runtime.pathname = root.pathname = "/eoms_test";
const pool = new pg.Pool({ connectionString: runtime.href }),
  admin = new pg.Pool({ connectionString: root.href }),
  app = createApp(pool);
let manager: any,
  supervisor: any,
  customer: string,
  foreignCustomer: string,
  foreignEstate: string;
before(async () => {
  const accounts = JSON.parse(
    await readFile(".local/test-accounts.json", "utf8"),
  );
  async function login(email: string) {
    const account = accounts.find((a: any) => a.email === email),
      agent = request.agent(app);
    const result = await agent
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5174")
      .send({ email, password: account.password });
    assert.equal(result.status, 200);
    return { agent, id: result.body.user.id, csrf: result.body.csrf };
  }
  manager = await login("manager@eoms.local");
  supervisor = await login("supervisor@eoms.local");
  customer = (
    await admin.query(
      "SELECT customer_id FROM eoms.estates WHERE id='20000000-0000-4000-8000-000000000001'",
    )
  ).rows[0].customer_id;
  foreignCustomer = (
    await admin.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,'Isolated test customer') RETURNING id",
      ["TEST-" + randomUUID()],
    )
  ).rows[0].id;
  const company = (
    await admin.query(
      "INSERT INTO eoms.companies(name,customer_id) VALUES('Isolated test company',$1) RETURNING id",
      [foreignCustomer],
    )
  ).rows[0].id;
  foreignEstate = (
    await admin.query(
      "INSERT INTO eoms.estates(company_id,customer_id,code,name) VALUES($1,$2,$3,'Isolated test estate') RETURNING id",
      [company, foreignCustomer, randomUUID()],
    )
  ).rows[0].id;
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("organization requires authentication and exposes only assigned estates, not sibling/customer roll-up access", async () => {
  assert.equal((await request(app).get("/api/organization")).status, 401);
  const own = await supervisor.agent.get("/api/organization");
  assert.equal(own.status, 200);
  assert.equal(own.body.items.length, 1);
  assert.equal(
    own.body.items[0].estate_id,
    "20000000-0000-4000-8000-000000000001",
  );
  assert.equal(own.body.items[0].customer_id, customer);
  const broader = await manager.agent.get("/api/organization");
  const authorized = (
    await admin.query(
      "SELECT estate_id FROM eoms.memberships WHERE user_id=$1 ORDER BY estate_id",
      [manager.id],
    )
  ).rows.map((row: any) => row.estate_id);
  assert.deepEqual(
    broader.body.items.map((row: any) => row.estate_id).sort(),
    authorized,
  );
  assert.ok(authorized.includes("20000000-0000-4000-8000-000000000001"));
  assert.ok(authorized.includes("20000000-0000-4000-8000-000000000002"));
  assert.ok(broader.body.items.every((r: any) => r.customer_id === customer));
  assert.ok(!JSON.stringify(broader.body).includes(foreignCustomer));
});
test("customer history is scoped, append-only for runtime and limited to projected public display fields", async () => {
  const own = await manager.agent.get(`/api/customers/${customer}/history`);
  assert.equal(own.status, 200);
  assert.ok(own.body.items.some((r: any) => r.action === "customer.created"));
  assert.ok(!JSON.stringify(own.body).includes('"detail"'));
  assert.equal(
    (await manager.agent.get(`/api/customers/${foreignCustomer}/history`))
      .status,
    404,
  );
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [manager.id]);
    assert.equal(
      (
        await c.query("SELECT * FROM eoms.customers WHERE id=$1", [
          foreignCustomer,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await c.query(
          "SELECT * FROM eoms.customer_history WHERE customer_id=$1",
          [foreignCustomer],
        )
      ).rowCount,
      0,
    );
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
  for (const sql of [
    "DELETE FROM eoms.customer_history",
    "UPDATE eoms.customer_history SET action='customer.updated'",
    "INSERT INTO eoms.customers(code,name) VALUES('FORBIDDEN','Forbidden')",
  ]) {
    await assert.rejects(
      () => pool.query(sql),
      (e: any) => e.code === "42501",
    );
  }
  assert.equal((await pool.query("SELECT * FROM eoms.customers")).rowCount, 0);
});
test("composite tenant keys reject mixed customer/company estates and customer changes create before/after history", async () => {
  await assert.rejects(
    () =>
      admin.query("UPDATE eoms.estates SET customer_id=$1 WHERE id=$2", [
        customer,
        foreignEstate,
      ]),
    (e: any) => e.code === "23503",
  );
  await admin.query(
    "UPDATE eoms.customers SET name='Renamed isolated customer' WHERE id=$1",
    [foreignCustomer],
  );
  const events = await admin.query(
    "SELECT action,detail FROM eoms.customer_history WHERE customer_id=$1 ORDER BY id",
    [foreignCustomer],
  );
  assert.deepEqual(
    events.rows.map((r) => r.action),
    ["customer.created", "customer.updated"],
  );
  assert.equal(events.rows[1].detail.before.name, "Isolated test customer");
  assert.equal(events.rows[1].detail.after.name, "Renamed isolated customer");
});

let navigationFixture: any;
async function navigationData() {
  if (navigationFixture) return navigationFixture;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
    code = "NAV-" + suffix;
  const customer = (
    await admin.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,$2) RETURNING id",
      [code, "ZZZ Navigation fixture " + suffix],
    )
  ).rows[0].id;
  const company = (
    await admin.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Navigation company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const estates = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,$2,$3||'-'||lpad(i::text,3,'0'),'Explorer estate '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,code,name",
      [customer, company, code],
    )
  ).rows;
  for (const row of estates)
    await admin.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [manager.id, row.id],
    );
  await admin.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [customer, manager.id],
  );
  const estate = estates.find((e: any) => e.code.endsWith("-201"));
  const units = (
    await admin.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) SELECT $1,$2,'division','NU-'||lpad(i::text,3,'0'),'Explorer unit '||lpad(i::text,3,'0') FROM generate_series(1,501) i RETURNING id,code,name",
      [customer, estate.id],
    )
  ).rows;
  units.sort((a: any, b: any) => a.code.localeCompare(b.code));
  navigationFixture = { customer, company, estates, estate, units, code };
  return navigationFixture;
}
async function navGet(path: string, query: object = {}, actor = manager) {
  const r = await actor.agent.get("/api/navigation/" + path).query(query);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function navRename(f: any, name: string) {
  const row = (
    await admin.query("SELECT * FROM eoms.operating_units WHERE id=$1", [
      f.units[500].id,
    ])
  ).rows[0];
  const r = await manager.agent
    .post(`/api/estates/${f.estate.id}/units/${row.id}`)
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", manager.csrf)
    .send({
      kind: row.kind,
      code: row.code,
      name,
      parentId: null,
      version: row.version,
      reason: "Navigation fixture display correction",
    });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
}
test("navigation reaches every assigned estate beyond the overview cap with scoped bound cursors", async () => {
  const f = await navigationData(),
    ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await navGet("estates", {
      q: f.code,
      limit: 37,
      ...(cursor ? { cursor } : {}),
    });
    assert.ok(page.items.length <= 37);
    ids.push(...page.items.map((e: any) => e.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(new Set(ids).size, 201);
  assert.deepEqual(ids.sort(), f.estates.map((e: any) => e.id).sort());
  const old = await manager.agent.get("/api/organization");
  assert.equal(old.body.truncated, true);
  assert.ok(!old.body.items.some((e: any) => e.estate_id === f.estate.id));
  const found = await navGet("estates", { q: f.estate.code });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].id, f.estate.id);
  const first = await navGet("estates", { q: f.code, limit: 5 });
  for (const params of [
    { q: f.code + "other", cursor: first.nextCursor },
    { q: f.code, cursor: "bad===page" },
    { q: f.code, limit: 101 },
  ])
    assert.equal(
      (await manager.agent.get("/api/navigation/estates").query(params)).status,
      422,
    );
  assert.equal(
    (
      await supervisor.agent
        .get("/api/navigation/estates")
        .query({ q: f.code, cursor: first.nextCursor })
    ).status,
    422,
  );
  assert.deepEqual(
    (await navGet("estates", { q: f.code }, supervisor)).items,
    [],
  );
  assert.equal(
    (
      await manager.agent
        .get("/api/navigation/estates")
        .query({ customerId: foreignCustomer })
    ).status,
    404,
  );
  assert.equal((await request(app).get("/api/navigation/estates")).status, 401);
});
test("unit navigation spans 501 records with literal search filters and stable ID order", async () => {
  const f = await navigationData(),
    ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await navGet(`estates/${f.estate.id}/units`, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map((u: any) => u.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(new Set(ids).size, 501);
  assert.deepEqual(ids.sort(), f.units.map((u: any) => u.id).sort());
  const old = await manager.agent.get(`/api/estates/${f.estate.id}/units`);
  assert.equal(old.body.truncated, true);
  assert.ok(!old.body.items.some((u: any) => u.id === f.units[500].id));
  await navRename(f, "Literal 50% _ slash\\ fixture");
  for (const q of ["%", "_", "\\"]) {
    const found = await navGet(`estates/${f.estate.id}/units`, { q });
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].id, f.units[500].id);
  }
  const paused = await manager.agent
    .post(`/api/estates/${f.estate.id}/units/${f.units[500].id}/lifecycle`)
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", manager.csrf)
    .send({
      active: false,
      version: 2,
      reason: "Navigation inactive filter fixture",
    });
  assert.equal(paused.status, 200);
  const filtered = await navGet(`estates/${f.estate.id}/units`, {
    kind: "division",
    status: "inactive",
  });
  assert.deepEqual(
    filtered.items.map((u: any) => u.id),
    [f.units[500].id],
  );
  const first = await navGet(`estates/${f.estate.id}/units`, { limit: 5 });
  assert.equal(
    (
      await manager.agent
        .get(`/api/navigation/estates/${f.estates[0].id}/units`)
        .query({ cursor: first.nextCursor })
    ).status,
    422,
  );
  assert.equal(
    (await supervisor.agent.get(`/api/navigation/estates/${f.estate.id}/units`))
      .status,
    404,
  );
});
test("history paging retains its upper event boundary and exposes safe record and support filters", async () => {
  const f = await navigationData(),
    path = `customers/${f.customer}/history`,
    query = { estateId: f.estate.id, limit: 41 };
  const first = await navGet(path, query),
    upper = JSON.parse(
      Buffer.from(first.nextCursor, "base64url").toString(),
    ).upper;
  const updated = await navRename(f, "Changed after first history page");
  const expected = (
    await admin.query(
      "SELECT id::text FROM eoms.hierarchy_history WHERE customer_id=$1 AND estate_id=$2 AND id<=$3 ORDER BY id DESC",
      [f.customer, f.estate.id, upper],
    )
  ).rows.map((r: any) => r.id);
  const ids = first.items.map((h: any) => h.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await navGet(path, { ...query, cursor });
    ids.push(...page.items.map((h: any) => h.id));
    cursor = page.nextCursor;
  }
  assert.deepEqual(ids, expected);
  assert.equal(new Set(ids).size, expected.length);
  const refreshed = await navGet(path, query);
  assert.ok(BigInt(refreshed.items[0].id) > BigInt(upper));
  const support = await navGet(path, {
    requestId: updated.headers["x-request-id"],
    recordId: f.units[500].id,
    recordType: "unit",
    estateId: f.estate.id,
  });
  assert.equal(support.items.length, 1);
  assert.equal(support.items[0].actor_id, manager.id);
  assert.equal(support.items[0].after.name, "Changed after first history page");
  assert.ok(!JSON.stringify(support).includes("after_state"));
  assert.ok(!JSON.stringify(support).includes('"detail"'));
  const keys = [
    "active",
    "code",
    "groupId",
    "kind",
    "moveDecisionId",
    "name",
    "parentId",
    "version",
  ];
  assert.deepEqual(Object.keys(support.items[0].after).sort(), keys.sort());
  for (const params of [
    { ...query, cursor: first.nextCursor, q: "different" },
    { recordType: "unknown" },
    { recordId: "not-a-uuid" },
    { source: "customer", estateId: f.estate.id },
  ])
    assert.equal(
      (await manager.agent.get("/api/navigation/" + path).query(params)).status,
      422,
    );
  const malformed = JSON.parse(
    Buffer.from(first.nextCursor, "base64url").toString(),
  );
  malformed.key = "9999999999999999999";
  assert.equal(
    (
      await manager.agent.get("/api/navigation/" + path).query({
        ...query,
        cursor: Buffer.from(JSON.stringify(malformed)).toString("base64url"),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await manager.agent
        .get("/api/navigation/" + path)
        .query({ estateId: foreignEstate })
    ).status,
    404,
  );
  assert.equal(
    (await supervisor.agent.get("/api/navigation/" + path)).status,
    404,
  );
});
test("customer display history is searchable beyond the recent window with precise creation evidence", async () => {
  const f = await navigationData();
  for (let i = 0; i < 52; i++)
    await admin.query("UPDATE eoms.customers SET name=$2 WHERE id=$1", [
      f.customer,
      "ZZZ Navigation display " + f.code + " " + i,
    ]);
  const old = await manager.agent.get(`/api/customers/${f.customer}/history`);
  assert.equal(old.body.truncated, true);
  assert.ok(!old.body.items.some((h: any) => h.action === "customer.created"));
  const path = `customers/${f.customer}/history`,
    ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await navGet(path, {
      source: "customer",
      limit: 9,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map((h: any) => h.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.length, 53);
  assert.equal(new Set(ids).size, 53);
  const creation = await navGet(path, {
    source: "customer",
    q: "customer.created",
  });
  assert.equal(creation.items.length, 1);
  assert.equal(creation.items[0].before.name, null);
  assert.match(creation.items[0].after.name, /ZZZ Navigation fixture/);
});
