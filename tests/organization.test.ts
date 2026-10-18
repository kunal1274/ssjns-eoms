import "../apps/api/src/config";
import { seedDecisionLedger } from "./ledger-fixture";
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
  if (ledgerFixture) {
    await admin.query(
      "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id IN ($2,$3)",
      [supervisor.id, ledgerFixture.own.id, ledgerFixture.other.id],
    );
    await admin.query(
      "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
      [ledgerFixture.customer, supervisor.id],
    );
  }
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

test("estate selector pins an assigned choice outside search without widening customer or account scope", async () => {
  const f = await navigationData();
  const page = await navGet("estates", {
    customerId: f.customer,
    q: "no-such-estate",
    selectedId: f.estate.id,
    limit: 1,
  });
  assert.deepEqual(page.items, []);
  assert.equal(page.selected.id, f.estate.id);
  assert.equal(page.selected.eligible, true);
  for (const selectedId of [foreignEstate, randomUUID()]) {
    assert.equal(
      (
        await manager.agent
          .get("/api/navigation/estates")
          .query({ customerId: f.customer, selectedId })
      ).status,
      404,
    );
  }
  assert.equal(
    (
      await supervisor.agent
        .get("/api/navigation/estates")
        .query({ selectedId: f.estate.id })
    ).status,
    404,
  );
  assert.equal(
    (
      await manager.agent
        .get("/api/navigation/estates")
        .query({ customerId: customer, selectedId: f.estate.id })
    ).status,
    404,
  );
});

test("unit selectors enforce parent types exact code exclusions and bound pagination while retaining ineligible pins", async () => {
  const f = await navigationData(),
    path = `estates/${f.estate.id}/units`;
  const parent = f.units[0];
  const field = (
    await admin.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,'field','SEL-F','Selector field',$3) RETURNING id",
      [f.customer, f.estate.id, parent.id],
    )
  ).rows[0];
  const block = (
    await admin.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,'block','ZZ-SEL-B','Selector block',$3) RETURNING id",
      [f.customer, f.estate.id, field.id],
    )
  ).rows[0];
  const fields = await navGet(path, {
    kind: "parent-field",
    status: "active",
    selectedId: field.id,
    limit: 5,
  });
  assert.ok(fields.items.every((r: any) => r.kind === "division"));
  assert.equal(fields.selected.id, field.id);
  assert.equal(fields.selected.eligible, false);
  const parents = await navGet(path, {
    kind: "parent-block",
    q: "SEL-F",
    excludeId: field.id,
    selectedId: field.id,
  });
  assert.deepEqual(parents.items, []);
  assert.equal(parents.selected.eligible, false);
  const exact = await navGet(path, {
    kind: "block",
    status: "active",
    exactCode: "ZZ-SEL-B",
  });
  assert.deepEqual(
    exact.items.map((r: any) => r.id),
    [block.id],
  );
  assert.deepEqual(
    (await navGet(path, { kind: "block", exactCode: "zz-sel-b" })).items,
    [],
  );
  const pin = await navGet(path, {
    kind: "block",
    q: "no-such-unit",
    selectedId: block.id,
  });
  assert.deepEqual(pin.items, []);
  assert.equal(pin.selected.eligible, true);
  for (const params of [
    { kind: "parent-block" },
    { exactCode: "ZZ-SEL-B" },
    { excludeId: parent.id },
  ]) {
    assert.equal(
      (
        await manager.agent.get("/api/navigation/" + path).query({
          kind: "parent-field",
          status: "active",
          limit: 5,
          cursor: fields.nextCursor,
          ...params,
        })
      ).status,
      422,
    );
  }
  assert.equal(
    (
      await manager.agent
        .get(`/api/navigation/estates/${f.estates[0].id}/units`)
        .query({ selectedId: block.id })
    ).status,
    404,
  );
  assert.equal(
    (
      await supervisor.agent
        .get("/api/navigation/" + path)
        .query({ selectedId: block.id })
    ).status,
    404,
  );
});

test("selected unit reads report current revision availability and revoked membership without mutating history", async () => {
  const f = await navigationData(),
    selected = f.units[1],
    path = `estates/${f.estate.id}/units`;
  await admin.query(
    "UPDATE eoms.operating_units SET name='Selector refreshed revision',version=version+1 WHERE id=$1",
    [selected.id],
  );
  const before = (
    await admin.query(
      "SELECT count(*)::int AS n FROM eoms.hierarchy_history WHERE estate_id=$1",
      [f.estate.id],
    )
  ).rows[0].n;
  const live = await navGet(path, {
    selectedId: selected.id,
    kind: "parent-field",
    status: "active",
    q: "unmatched",
  });
  assert.equal(live.selected.name, "Selector refreshed revision");
  assert.equal(live.selected.version, 2);
  assert.equal(live.selected.eligible, true);
  const inactive = await navGet(path, {
    selectedId: f.units[500].id,
    status: "active",
  });
  assert.equal(inactive.selected.active, false);
  assert.equal(inactive.selected.eligible, false);
  await admin.query(
    "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
    [manager.id, f.estate.id],
  );
  try {
    assert.equal(
      (
        await manager.agent
          .get("/api/navigation/" + path)
          .query({ selectedId: selected.id })
      ).status,
      404,
    );
    assert.equal(
      (
        await manager.agent
          .get("/api/navigation/estates")
          .query({ selectedId: f.estate.id })
      ).status,
      404,
    );
  } finally {
    await admin.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [manager.id, f.estate.id],
    );
  }
  const after = (
    await admin.query(
      "SELECT count(*)::int AS n FROM eoms.hierarchy_history WHERE estate_id=$1",
      [f.estate.id],
    )
  ).rows[0].n;
  assert.equal(after, before);
});

let contextFixture: any;
async function contextData() {
  if (contextFixture) return contextFixture;
  const code = "CTX-" + randomUUID().slice(0, 8).toUpperCase();
  const customers = (
    await admin.query(
      "INSERT INTO eoms.customers(code,name) SELECT $1||'-'||lpad(i::text,3,'0'),'ZZZ Directory '||$1||' '||i FROM generate_series(1,201) i RETURNING id,code",
      [code],
    )
  ).rows;
  await admin.query(
    "INSERT INTO eoms.companies(customer_id,name) SELECT id,'Anchor '||code FROM eoms.customers WHERE code LIKE $1",
    [code + "-%"],
  );
  const estates = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT c.customer_id,c.id,t.code,'Directory anchor '||t.code FROM eoms.companies c JOIN eoms.customers t ON t.id=c.customer_id WHERE t.code LIKE $1 RETURNING id,customer_id",
      [code + "-%"],
    )
  ).rows;
  await admin.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,e.id,'manager' FROM eoms.estates e WHERE e.code LIKE $2",
    [manager.id, code + "-%"],
  );
  const own = customers.find((r: any) => r.code.endsWith("-201"));
  await admin.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [own.id, manager.id],
  );
  const companies = (
    await admin.query(
      "INSERT INTO eoms.companies(customer_id,name) SELECT $1,$2||' Company '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,name",
      [own.id, code],
    )
  ).rows;
  await admin.query(
    "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,id,$2||'-C-'||right(name,3),'Directory company anchor '||name FROM eoms.companies WHERE customer_id=$1 AND name LIKE $3",
    [own.id, code, code + " Company %"],
  );
  await admin.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,e.id,'manager' FROM eoms.estates e WHERE e.code LIKE $2",
    [manager.id, code + "-C-%"],
  );
  const groups = (
    await admin.query(
      "INSERT INTO eoms.customer_groups(customer_id,code,name) SELECT $1,'CG-'||lpad(i::text,3,'0'),'Directory group '||i FROM generate_series(1,201) i RETURNING id,code,name",
      [own.id],
    )
  ).rows;
  companies.sort((a: any, b: any) => a.name.localeCompare(b.name));
  groups.sort((a: any, b: any) => a.code.localeCompare(b.code));
  return (contextFixture = {
    code,
    customers,
    own,
    companies,
    groups,
    estates,
  });
}
test("context navigation pages all permitted customers with literal search bound cursors and scoped pins", async () => {
  const f = await contextData(),
    ids: string[] = [];
  let cursor: string | undefined;
  do {
    const p = await navGet("customers", {
      q: f.code,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...p.items.map((r: any) => r.id));
    cursor = p.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.length, 201);
  assert.equal(new Set(ids).size, 201);
  const pin = await navGet("customers", {
    q: "unmatched-context",
    selectedId: f.own.id,
  });
  assert.deepEqual(pin.items, []);
  assert.equal(pin.selected.id, f.own.id);
  const first = await navGet("customers", { q: f.code, limit: 5 });
  for (const actor of [manager, supervisor])
    assert.equal(
      (
        await actor.agent
          .get("/api/navigation/customers")
          .query({ q: "changed", cursor: first.nextCursor })
      ).status,
      422,
    );
  assert.equal(
    (
      await supervisor.agent
        .get("/api/navigation/customers")
        .query({ selectedId: f.own.id })
    ).status,
    404,
  );
  assert.equal(
    (
      await manager.agent
        .get("/api/navigation/customers")
        .query({ selectedId: foreignCustomer })
    ).status,
    404,
  );
  assert.equal(
    (await request(app).get("/api/navigation/customers")).status,
    401,
  );
});
test("company and group selectors reach deep rows while enforcing tenant account and route cursor scope", async () => {
  const f = await contextData();
  for (const kind of ["companies", "groups"]) {
    const path = `customers/${f.own.id}/${kind}`,
      ids: string[] = [];
    let cursor: string | undefined;
    do {
      const p = await navGet(path, {
        limit: 100,
        ...(kind === "companies" ? { q: f.code + " Company" } : {}),
        ...(cursor ? { cursor } : {}),
      });
      ids.push(...p.items.map((r: any) => r.id));
      cursor = p.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(ids.length, 201);
    assert.equal(new Set(ids).size, 201);
    const chosen = kind === "companies" ? f.companies[200] : f.groups[200];
    const pin = await navGet(path, {
      q: "unmatched-context",
      selectedId: chosen.id,
    });
    assert.equal(pin.selected.id, chosen.id);
    assert.deepEqual(pin.items, []);
    const first = await navGet(path, { limit: 5 });
    assert.equal(
      (
        await manager.agent
          .get(
            `/api/navigation/customers/${f.own.id}/${kind === "groups" ? "companies" : "groups"}`,
          )
          .query({ cursor: first.nextCursor })
      ).status,
      422,
    );
    assert.equal(
      (
        await supervisor.agent
          .get("/api/navigation/" + path)
          .query({ selectedId: chosen.id })
      ).status,
      404,
    );
    assert.equal(
      (
        await manager.agent
          .get(`/api/navigation/customers/${customer}/${kind}`)
          .query({ selectedId: chosen.id })
      ).status,
      404,
    );
  }
  await admin.query("UPDATE eoms.companies SET name=$2 WHERE id=$1", [
    f.companies[200].id,
    "Literal 50% _ slash\\ company",
  ]);
  for (const q of ["%", "_", "\\"]) {
    const found = await navGet(`customers/${f.own.id}/companies`, { q });
    assert.deepEqual(
      found.items.map((r: any) => r.id),
      [f.companies[200].id],
    );
  }
});
test("deep company group writes retain optimistic versions actor references and audit while rejecting stale and cross-tenant choices", async () => {
  const f = await contextData(),
    company = f.companies[200],
    group = f.groups[200],
    path = `/api/customers/${f.own.id}/companies/${company.id}/group`;
  const initial = await navGet(`customers/${f.own.id}/companies`, {
    selectedId: company.id,
  });
  const version = initial.selected.hierarchy_version;
  async function save(groupId: string | null, v: number) {
    return manager.agent
      .post(path)
      .set("Origin", "http://localhost:5174")
      .set("X-CSRF-Token", manager.csrf)
      .send({
        groupId,
        version: v,
        reason: "Reviewed deep company group assignment",
      });
  }
  const saved = await save(group.id, version);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.id, company.id);
  assert.equal(saved.body.group_id, group.id);
  assert.equal((await save(null, version)).status, 409);
  const pin = await navGet(`customers/${f.own.id}/companies`, {
    selectedId: company.id,
  });
  assert.equal(pin.selected.hierarchy_version, version + 1);
  assert.equal(pin.selected.group_id, group.id);
  const foreign = (
    await admin.query(
      "INSERT INTO eoms.customer_groups(customer_id,code,name) VALUES($1,'CTX-FOREIGN','Foreign directory group') RETURNING id",
      [foreignCustomer],
    )
  ).rows[0];
  assert.equal((await save(foreign.id, version + 1)).status, 422);
  const history = await navGet(`customers/${f.own.id}/history`, {
    recordId: company.id,
    recordType: "company",
    requestId: saved.headers["x-request-id"],
  });
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].actor_id, manager.id);
  assert.equal(history.items[0].before.groupId, null);
  assert.equal(history.items[0].after.groupId, group.id);
  const anchor = f.estates.find(
    (e: any) =>
      e.customer_id === f.customers.find((r: any) => r.id !== f.own.id).id,
  );
  await admin.query(
    "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
    [manager.id, anchor.id],
  );
  try {
    assert.equal(
      (
        await manager.agent
          .get("/api/navigation/customers")
          .query({ selectedId: anchor.customer_id })
      ).status,
      404,
    );
  } finally {
    await admin.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [manager.id, anchor.id],
    );
  }
});

let areaFixture: any;
async function areaData() {
  if (areaFixture) return areaFixture;
  const code = "AP-" + randomUUID().slice(0, 8).toUpperCase();
  const customer = (
    await admin.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,$2) RETURNING id",
      [code, "ZZZ Area pages " + code],
    )
  ).rows[0].id;
  const company = (
    await admin.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Area pages company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const estates = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,$2,$3||'-'||lpad(i::text,3,'0'),'Area page estate '||i FROM generate_series(1,201) i RETURNING id,code",
      [customer, company, code],
    )
  ).rows;
  await admin.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,id,'manager' FROM eoms.estates WHERE customer_id=$2",
    [manager.id, customer],
  );
  await admin.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [customer, manager.id],
  );
  const areas = (
    await admin.query(
      "INSERT INTO eoms.operating_areas(customer_id,kind,code,name) SELECT $1,'region','PR-'||lpad(i::text,3,'0'),'Paged area '||i FROM generate_series(1,201) i RETURNING id,code",
      [customer],
    )
  ).rows;
  areas.sort((a: any, b: any) => a.code.localeCompare(b.code));
  return (areaFixture = { customer, company, estates, areas });
}
test("operating area pages reach all 201 permitted records and pinned records do not widen scope", async () => {
  const f = await areaData(),
    path = `customers/${f.customer}/areas`,
    ids: string[] = [];
  let cursor: string | undefined;
  do {
    const p = await navGet(path, { limit: 100, ...(cursor ? { cursor } : {}) });
    ids.push(...p.items.map((r: any) => r.id));
    cursor = p.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.length, 201);
  assert.equal(new Set(ids).size, 201);
  const pin = await navGet(path, {
    q: "unmatched",
    selectedId: f.areas[200].id,
  });
  assert.deepEqual(pin.items, []);
  assert.equal(pin.selected.id, f.areas[200].id);
  assert.equal(
    (await supervisor.agent.get("/api/navigation/" + path)).status,
    404,
  );
  assert.equal(
    (
      await manager.agent
        .get(`/api/navigation/customers/${customer}/areas`)
        .query({ selectedId: f.areas[200].id })
    ).status,
    404,
  );
});
test("area kind availability exclusion and literal filters bind cursors and retain ineligible current pins", async () => {
  const f = await areaData(),
    path = `customers/${f.customer}/areas`;
  const areaPath = `/api/customers/${f.customer}/areas/${f.areas[200].id}`;
  const renamed = await manager.agent
    .post(areaPath)
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", manager.csrf)
    .send({
      code: f.areas[200].code,
      name: "Literal 50% _ slash\\ area",
      version: 1,
      reason: "Authorized literal area search fixture",
    });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  const paused = await manager.agent
    .post(areaPath + "/lifecycle")
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", manager.csrf)
    .send({
      active: false,
      version: 2,
      reason: "Authorized inactive area selector fixture",
    });
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  for (const q of ["%", "_", "\\"])
    assert.deepEqual(
      (await navGet(path, { q })).items.map((r: any) => r.id),
      [f.areas[200].id],
    );
  const pin = await navGet(path, {
    status: "active",
    selectedId: f.areas[200].id,
  });
  assert.equal(pin.selected.eligible, false);
  assert.equal(pin.selected.version, 3);
  const excluded = await navGet(path, {
    q: f.areas[0].code,
    excludeId: f.areas[0].id,
    selectedId: f.areas[0].id,
  });
  assert.deepEqual(excluded.items, []);
  assert.equal(excluded.selected.eligible, false);
  assert.equal(
    (await navGet(path, { kind: "business-unit", selectedId: f.areas[0].id }))
      .selected.eligible,
    false,
  );
  const first = await navGet(path, { kind: "region", limit: 5 });
  for (const filters of [
    { kind: "business-unit" },
    { status: "inactive" },
    { excludeId: f.areas[0].id },
  ])
    assert.equal(
      (
        await manager.agent
          .get("/api/navigation/" + path)
          .query({ kind: "region", cursor: first.nextCursor, ...filters })
      ).status,
      422,
    );
  assert.equal(
    (
      await supervisor.agent
        .get("/api/navigation/" + path)
        .query({ kind: "region", cursor: first.nextCursor })
    ).status,
    422,
  );
});
test("estate pins supply current placement versions and excluded companies remain explicit ineligible choices", async () => {
  const f = await areaData(),
    own = f.estates.find((r: any) => r.code.endsWith("-201"));
  const placed = await manager.agent
    .post(`/api/estates/${own.id}/placement`)
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", manager.csrf)
    .send({
      areaId: f.areas[0].id,
      version: 1,
      reason: "Authorized estate placement pin fixture",
    });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const pin = await navGet("estates", {
    customerId: f.customer,
    selectedId: own.id,
    q: "unmatched",
  });
  assert.equal(pin.selected.area_id, f.areas[0].id);
  assert.equal(pin.selected.placement_version, 2);
  assert.equal(pin.selected.company_id, f.company);
  const path = `customers/${f.customer}/companies`;
  const excluded = await navGet(path, {
    excludeId: f.company,
    selectedId: f.company,
  });
  assert.deepEqual(excluded.items, []);
  assert.equal(excluded.selected.eligible, false);
  const other = await contextData();
  const first = await navGet(`customers/${other.own.id}/companies`, {
    limit: 5,
  });
  assert.equal(
    (
      await manager.agent
        .get(`/api/navigation/customers/${other.own.id}/companies`)
        .query({ cursor: first.nextCursor, excludeId: other.companies[0].id })
    ).status,
    422,
  );
});

test("header estate pages and pins report only the actor's actual membership role including inactive estates", async () => {
  const f = await navigationData();
  const first = await navGet("estates", { limit: 25 });
  assert.equal(first.items.length, 25);
  assert.ok(first.nextCursor);
  assert.ok(first.items.every((r: any) => r.role === "manager"));
  const narrow = await navGet("estates", {}, supervisor);
  assert.equal(narrow.items.length, 1);
  assert.equal(narrow.items[0].role, "supervisor");
  const own = f.estates[0];
  await admin.query(
    "UPDATE eoms.memberships SET role='clerk' WHERE user_id=$1 AND estate_id=$2",
    [manager.id, own.id],
  );
  try {
    const pin = await navGet("estates", {
      selectedId: own.id,
      q: "no matching record",
    });
    assert.deepEqual(pin.items, []);
    assert.equal(pin.selected.role, "clerk");
    assert.equal(pin.selected.eligible, true);
    assert.equal(pin.selected.lifecycle_version, 1);
    assert.equal(
      (
        await supervisor.agent
          .get("/api/navigation/estates")
          .query({ selectedId: own.id })
      ).status,
      404,
    );
  } finally {
    await admin.query(
      "UPDATE eoms.memberships SET role='manager' WHERE user_id=$1 AND estate_id=$2",
      [manager.id, own.id],
    );
  }
});

test("deep availability pins support reasoned optimistic writes and real history while rejecting stale and foreign requests", async () => {
  const f = await navigationData(),
    unit = f.units[499],
    path = `estates/${f.estate.id}/units`;
  const read = await navGet(path, {
    selectedId: unit.id,
    q: "no matching unit",
    status: "all",
  });
  assert.equal(read.selected.id, unit.id);
  assert.equal(read.selected.parent_code, null);
  const version = read.selected.version;
  async function change(actor: any, v: number, active: boolean) {
    return actor.agent
      .post(`/api/estates/${f.estate.id}/units/${unit.id}/lifecycle`)
      .set("Origin", "http://localhost:5174")
      .set("X-CSRF-Token", actor.csrf)
      .send({
        version: v,
        active,
        reason: "Review deep availability revision",
      });
  }
  const saved = await change(manager, version, false);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.version, version + 1);
  const latest = await navGet(path, {
    selectedId: unit.id,
    q: "no matching unit",
    status: "all",
  });
  assert.equal(latest.selected.active, false);
  assert.equal(latest.selected.eligible, true);
  assert.equal(latest.selected.version, version + 1);
  assert.equal((await change(manager, version, true)).status, 409);
  assert.equal((await change(supervisor, version + 1, true)).status, 404);
  const restored = await change(manager, version + 1, true);
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const events = (
    await manager.agent.get(`/api/estates/${f.estate.id}/lifecycle`)
  ).body.history.filter((h: any) => h.record_id === unit.id);
  assert.equal(events.length, 2);
  assert.equal(events[0].after.version, version + 2);
  assert.equal(events[0].before.active, false);
  assert.ok(
    events.every(
      (h: any) =>
        h.reason === "Review deep availability revision" &&
        h.request_id &&
        h.actor,
    ),
  );
});

let ledgerFixture: any;
async function ledgerData() {
  if (ledgerFixture) return ledgerFixture;
  ledgerFixture = await seedDecisionLedger(
    admin,
    manager.id,
    supervisor.id,
    async (actor, path, data) => {
      const a = actor === "manager" ? manager : supervisor;
      const r = await a.agent
        .post("/api" + path)
        .set("Origin", "http://localhost:5174")
        .set("X-CSRF-Token", a.csrf)
        .send(data);
      assert.ok(
        r.status === 200 || r.status === 201,
        JSON.stringify({ path, status: r.status, body: r.body }),
      );
      return r.body;
    },
  );
  return ledgerFixture;
}
test("decision ledgers page complete permitted history beyond 50 with literal filters provenance and filter-bound cursors", async () => {
  const f = await ledgerData();
  for (const path of [
    `estates/${f.own.id}/responsibilities`,
    `estates/${f.own.id}/cancellations`,
    `customers/${f.customer}/moves`,
  ]) {
    let cursor: any = undefined,
      seen: string[] = [];
    do {
      const r = await navGet(path, { limit: 7, ...(cursor ? { cursor } : {}) });
      seen.push(...r.items.map((x: any) => x.id));
      cursor = r.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 56);
    assert.equal(new Set(seen).size, 56);
    const r = await navGet(path, { q: "%_ exact", limit: 5 });
    assert.equal(r.items.length, 5);
    assert.ok(r.nextCursor);
    assert.ok(
      r.items.every(
        (x: any) =>
          x.request_id &&
          x.estate_id &&
          x.reason &&
          !("searchtext" in x) &&
          !("page_time" in x),
      ),
    );
    assert.equal(
      (
        await manager.agent
          .get("/api/navigation/" + path)
          .query({ cursor: r.nextCursor, q: "other" })
      ).status,
      422,
    );
    assert.equal(
      (
        await supervisor.agent
          .get("/api/navigation/" + path)
          .query({ cursor: r.nextCursor, q: "%_ exact" })
      ).status,
      422,
    );
  }
  const moves = await navGet(`customers/${f.customer}/moves`, {
    status: "rejected",
    q: "Independent ledger move 1",
  });
  assert.ok(
    moves.items.some(
      (r: any) =>
        r.decision_reference &&
        r.reviewer_id === supervisor.id &&
        r.requester_id === manager.id,
    ),
  );
});
test("ledger selected records reach old correction and review choices but do not grant self review or cross-estate access", async () => {
  const f = await ledgerData(),
    source = f.responsibilities[1];
  const correction = await navGet(`estates/${f.own.id}/responsibilities`, {
    purpose: "choice",
    status: "cancelled",
    selectedId: source.id,
    q: "unmatched",
  });
  assert.equal(correction.selected.eligible, true);
  assert.equal(correction.selected.revision, 2);
  assert.deepEqual(correction.items, []);
  for (const [path, id] of [
    [`estates/${f.own.id}/cancellations`, f.cancellations[0].id],
    [`customers/${f.customer}/moves`, f.moves[0].id],
  ]) {
    const own = await navGet(path, {
      purpose: "choice",
      status: "pending",
      selectedId: id,
    });
    assert.equal(own.selected.eligible, false);
    const review = await navGet(
      path,
      { purpose: "choice", status: "pending", selectedId: id },
      supervisor,
    );
    assert.equal(review.selected.eligible, true);
  }
  assert.equal(
    (
      await manager.agent
        .get(`/api/navigation/estates/${f.other.id}/responsibilities`)
        .query({ selectedId: source.id })
    ).status,
    404,
  );
  assert.equal(
    (
      await supervisor.agent.get(
        `/api/navigation/estates/${foreignEstate}/cancellations`,
      )
    ).status,
    404,
  );
  const current = (
    await manager.agent.get(`/api/estates/${f.own.id}/responsibility`)
  ).body;
  assert.equal(current.lastActive.id, f.responsibilities[0].id);
  assert.equal(
    current.items.some((r: any) => r.id === current.lastActive.id),
    false,
  );
});
test("ledger page boundary excludes newer requests and scope is checked again after revocation", async () => {
  const f = await ledgerData(),
    path = `customers/${f.customer}/moves`,
    first = await navGet(path, { limit: 7, status: "rejected" });
  const request = await manager.agent
    .post(`/api/estates/${f.other.id}/placement-moves`)
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", manager.csrf)
    .send({
      toAreaId: f.area.id,
      version: 1,
      reason: "New request after ledger first page",
    });
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const decision = await supervisor.agent
    .post(
      `/api/estates/${f.other.id}/placement-moves/${request.body.id}/decision`,
    )
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", supervisor.csrf)
    .send({
      decision: "rejected",
      version: 1,
      reason: "New independent decision after boundary",
    });
  assert.equal(decision.status, 201, JSON.stringify(decision.body));
  let cursor = first.nextCursor,
    seen = first.items.map((r: any) => r.id);
  while (cursor) {
    const r = await navGet(path, { limit: 7, status: "rejected", cursor });
    seen.push(...r.items.map((x: any) => x.id));
    cursor = r.nextCursor;
  }
  assert.equal(seen.length, 55);
  assert.equal(seen.includes(request.body.id), false);
  const fresh = await navGet(path, { status: "rejected" });
  assert.equal(fresh.items[0].id, request.body.id);
  await admin.query(
    "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
    [manager.id, f.own.id],
  );
  try {
    assert.equal(
      (
        await manager.agent
          .get("/api/navigation/" + path)
          .query({ selectedId: f.moves[0].id })
      ).status,
      404,
    );
    assert.equal(
      (
        await manager.agent.get(
          `/api/navigation/estates/${f.own.id}/cancellations`,
        )
      ).status,
      404,
    );
  } finally {
    await admin.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [manager.id, f.own.id],
    );
  }
});

test("older correction sources remain governed by revision and replacement-once guards with current eligibility pins", async () => {
  const f = await ledgerData(),
    source = f.responsibilities[1];
  const data = {
    companyId: f.company,
    effectiveFrom: source.effective_from,
    revision: 56,
    reason: "Explicit older approved-cancelled correction",
    replacesId: source.id,
  };
  const save = () =>
    manager.agent
      .post(`/api/estates/${f.own.id}/responsibility`)
      .set("Origin", "http://localhost:5174")
      .set("X-CSRF-Token", manager.csrf)
      .send(data);
  const saved = await save();
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.revision, 57);
  const used = await navGet(`estates/${f.own.id}/responsibilities`, {
    purpose: "choice",
    status: "cancelled",
    selectedId: source.id,
  });
  assert.equal(used.selected.eligible, false);
  assert.equal((await save()).status, 409);
  const support = await navGet(`estates/${f.own.id}/responsibilities`, {
    requestId: saved.body.request_id,
  });
  assert.deepEqual(
    support.items.map((r: any) => r.id),
    [saved.body.id],
  );
  assert.equal(support.items[0].replaces_responsibility_id, source.id);
  const ownReview = await manager.agent
    .post(`/api/estates/${f.own.id}/placement-moves/${f.moves[0].id}/decision`)
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", manager.csrf)
    .send({
      decision: "approved",
      version: 1,
      reason: "Self review must remain denied",
    });
  assert.equal(ownReview.status, 403);
});
