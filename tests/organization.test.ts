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
    return { agent, id: result.body.user.id };
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
  assert.equal(broader.body.items.length, 2);
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
