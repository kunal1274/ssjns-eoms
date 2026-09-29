import "../apps/api/src/config.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app.ts";
const url = new URL(process.env.DATABASE_URL!);
url.pathname = "/eoms_test";
const adminURL = new URL(process.env.ADMIN_DATABASE_URL!);
adminURL.pathname = "/eoms_test";
if (url.hostname !== "127.0.0.1") throw Error("Tests require loopback test DB");
const pool = new pg.Pool({ connectionString: url.href, max: 4 });
const admin = new pg.Pool({ connectionString: adminURL.href });
const app = createApp(pool);
const origin = "http://localhost:5174";
let accounts: any[] = [];
const estate = "20000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000002";
async function login(email = "supervisor@eoms.local") {
  const agent = request.agent(app);
  const acct = accounts.find((a) => a.email === email);
  const res = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email, password: acct.password });
  assert.equal(res.status, 200);
  return { agent, csrf: res.body.csrf, user: res.body.user };
}
async function fixture() {
  const occurrence = (
    await admin.query(
      "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'TEST',$2,'Circle spraying',$3,2) RETURNING id",
      [estate, randomUUID(), randomUUID()],
    )
  ).rows[0].id;
  const workers = (
    await admin.query(
      "SELECT id FROM eoms.workers WHERE estate_id=$1 ORDER BY code LIMIT 2",
      [estate],
    )
  ).rows.map((r) => r.id);
  return {
    occurrenceId: occurrence,
    businessDate: "2026-09-28",
    gangCode: "UG-01",
    quantityHa: 1.5,
    workerIds: workers,
  };
}
async function create(
  session: Awaited<ReturnType<typeof login>>,
  body: object,
  key = randomUUID(),
) {
  return session.agent
    .post(`/api/estates/${estate}/musters`)
    .set("Origin", origin)
    .set("X-CSRF-Token", session.csrf)
    .set("Idempotency-Key", key)
    .send(body);
}
before(async () => {
  accounts = JSON.parse(await readFile(".local/test-accounts.json", "utf8"));
  await admin.query(
    "UPDATE eoms.periods SET locked=false WHERE estate_id=$1 AND month='2026-09-01'",
    [estate],
  );
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("unauthenticated API access fails", async () =>
  assert.equal((await request(app).get("/api/estates")).status, 401));
test("session is real, scoped and invalidated on logout", async () => {
  const s = await login();
  const r = await s.agent.get("/api/estates");
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.map((e: any) => e.id),
    [estate],
  );
  assert.equal(
    (
      await s.agent
        .post("/api/auth/logout")
        .set("Origin", origin)
        .set("X-CSRF-Token", s.csrf)
    ).status,
    204,
  );
  assert.equal((await s.agent.get("/api/estates")).status, 401);
});
test("wrong password, cross-origin write and missing CSRF are rejected", async () => {
  assert.equal(
    (
      await request(app)
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email: accounts[0].email, password: "incorrect-password" })
    ).status,
    401,
  );
  const s = await login();
  assert.equal(
    (
      await s.agent
        .post(`/api/estates/${estate}/musters`)
        .set("Origin", "https://evil.invalid")
        .send(await fixture())
    ).status,
    403,
  );
  assert.equal(
    (
      await s.agent
        .post(`/api/estates/${estate}/musters`)
        .set("Origin", origin)
        .send(await fixture())
    ).status,
    403,
  );
});
test("cross-estate routes are denied; database RLS also filters unscoped SQL", async () => {
  const s = await login();
  assert.equal(
    (await s.agent.get(`/api/estates/${other}/workers`)).status,
    403,
  );
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [s.user.id]);
    const rows = await c.query("SELECT DISTINCT estate_id FROM eoms.workers");
    assert.deepEqual(
      rows.rows.map((r) => r.estate_id),
      [estate],
    );
    await c.query("COMMIT");
    const unscoped = await c.query("SELECT * FROM eoms.workers");
    assert.equal(unscoped.rowCount, 0);
  } finally {
    c.release();
  }
});
test("create is persistent and idempotent; changed payload conflicts", async () => {
  const s = await login(),
    body = await fixture(),
    key = randomUUID();
  const a = await create(s, body, key),
    b = await create(s, body, key);
  assert.equal(a.status, 201);
  assert.equal(a.body.id, b.body.id);
  assert.equal((await create(s, { ...body, quantityHa: 1 }, key)).status, 409);
  const read = await s.agent.get(`/api/estates/${estate}/musters/${a.body.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.shares.length, 2);
  assert.equal(read.body.quantity_ha, "1.50");
});
test("cross-estate worker IDs fail reference validation", async () => {
  const s = await login(),
    body = await fixture();
  const worker = (
    await admin.query(
      "SELECT id FROM eoms.workers WHERE estate_id=$1 LIMIT 1",
      [other],
    )
  ).rows[0].id;
  assert.equal((await create(s, { ...body, workerIds: [worker] })).status, 422);
});
test("clerk cannot create or confirm work", async () => {
  const s = await login("clerk@eoms.local");
  assert.equal((await create(s, await fixture())).status, 403);
});
test("concurrent confirmations cannot exceed task cap", async () => {
  const s = await login(),
    body = await fixture();
  const a = await create(s, body),
    b = await create(s, body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const confirm = (id: string) =>
    s.agent
      .post(`/api/estates/${estate}/musters/${id}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", s.csrf)
      .send({ version: 1 });
  const replies = await Promise.all([confirm(a.body.id), confirm(b.body.id)]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  const winner = replies.find((r) => r.status === 200)!;
  assert.equal((await confirm(winner.body.id)).status, 200);
  const audit = await admin.query(
    "SELECT count(*) FROM eoms.audit WHERE record_id=$1 AND action='muster.confirmed'",
    [winner.body.id],
  );
  assert.equal(audit.rows[0].count, "1");
  const outbox = await admin.query(
    "SELECT count(*) FROM eoms.outbox WHERE aggregate_id=$1",
    [winner.body.id],
  );
  assert.equal(outbox.rows[0].count, "1");
});
test("stale version and locked period reject confirmations", async () => {
  const s = await login(),
    body = await fixture();
  const a = await create(s, body);
  const confirm = (v: number) =>
    s.agent
      .post(`/api/estates/${estate}/musters/${a.body.id}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", s.csrf)
      .send({ version: v });
  assert.equal((await confirm(7)).status, 409);
  await admin.query(
    "UPDATE eoms.periods SET locked=true WHERE estate_id=$1 AND month='2026-09-01'",
    [estate],
  );
  try {
    assert.equal((await confirm(1)).status, 409);
    assert.equal((await create(s, body)).status, 409);
  } finally {
    await admin.query(
      "UPDATE eoms.periods SET locked=false WHERE estate_id=$1 AND month='2026-09-01'",
      [estate],
    );
  }
});
test("runtime cannot modify audit and has no RLS bypass privileges", async () => {
  const roles = await pool.query(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  assert.deepEqual(roles.rows[0], { rolsuper: false, rolbypassrls: false });
  await assert.rejects(
    () => pool.query("DELETE FROM eoms.audit"),
    /permission denied/,
  );
});
test("list uses bounded keyset pages", async () => {
  const s = await login();
  const page = await s.agent.get(`/api/estates/${estate}/musters?limit=2`);
  assert.equal(page.status, 200);
  assert.ok(page.body.items.length <= 2);
  assert.ok(page.body.nextCursor);
  const next = await s.agent
    .get(`/api/estates/${estate}/musters`)
    .query({ limit: 2, cursor: page.body.nextCursor });
  assert.equal(next.status, 200);
  assert.ok(
    next.body.items.every(
      (x: any) => !page.body.items.some((y: any) => x.id === y.id),
    ),
  );
  assert.equal(
    (await s.agent.get(`/api/estates/${estate}/musters?limit=999999`)).status,
    422,
  );
});
