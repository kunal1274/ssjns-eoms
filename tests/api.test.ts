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
      "SELECT id FROM eoms.workers WHERE estate_id=$1 AND active ORDER BY code LIMIT 2",
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
    .send(body)
    .timeout({ deadline: 5000 });
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

test("manager maintains workers; stale updates and supervisor writes fail", async () => {
  const manager = await login("manager@eoms.local"),
    supervisor = await login();
  const payload = { code: "QA-" + randomUUID(), name: "Maintenance Worker" };
  const post = (s: any, path: string, body: object) =>
    s.agent
      .post(`/api/estates/${estate}${path}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", s.csrf)
      .send(body)
      .timeout({ deadline: 5000 });
  assert.equal((await post(supervisor, "/workers", payload)).status, 403);
  const made = await post(manager, "/workers", payload);
  assert.equal(made.status, 201);
  assert.equal((await post(manager, "/workers", payload)).status, 409);
  const changed = await post(manager, `/workers/${made.body.id}`, {
    name: "Updated Worker",
    active: false,
    version: 1,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.version, 2);
  assert.equal(
    (
      await post(manager, `/workers/${made.body.id}`, {
        name: "Stale",
        active: true,
        version: 1,
      })
    ).status,
    409,
  );
  const list = await manager.agent
    .get(`/api/estates/${estate}/catalog/workers`)
    .query({ q: payload.code, includeInactive: "true", limit: 1 });
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].active, false);
  const active = await supervisor.agent
    .get(`/api/estates/${estate}/catalog/workers`)
    .query({ q: payload.code });
  assert.equal(active.body.items.length, 0);
  assert.equal(
    (
      await manager.agent
        .get(`/api/estates/${other}/catalog/workers`)
        .query({ q: payload.code })
    ).body.items.length,
    0,
  );
  const logs = await admin.query(
    "SELECT action FROM eoms.audit WHERE record_id=$1 ORDER BY id",
    [made.body.id],
  );
  assert.deepEqual(
    logs.rows.map((r) => r.action),
    ["worker.created", "worker.updated"],
  );
});

test("task maintenance validates capacity, duplicate identity and confirmed work", async () => {
  const s = await login("manager@eoms.local");
  const post = (path: string, body: object) =>
    s.agent
      .post(`/api/estates/${estate}${path}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", s.csrf)
      .send(body)
      .timeout({ deadline: 5000 });
  const body = {
    blockCode: "QA",
    taskCode: randomUUID(),
    activity: "Circle spraying",
    roundCode: "QA-R1",
    capacityHa: 2,
  };
  assert.equal(
    (await post("/occurrences", { ...body, capacityHa: 0 })).status,
    422,
  );
  const made = await post("/occurrences", body);
  assert.equal(made.status, 201);
  assert.equal((await post("/occurrences", body)).status, 409);
  const muster = await create(s, {
    ...(await fixture()),
    occurrenceId: made.body.id,
    quantityHa: 1.5,
  });
  assert.equal(muster.status, 201);
  assert.equal(
    (await post(`/musters/${muster.body.id}/confirm`, { version: 1 })).status,
    200,
  );
  assert.equal(
    (await post(`/occurrences/${made.body.id}`, { capacityHa: 1, version: 1 }))
      .status,
    409,
  );
  assert.equal(
    (await post(`/occurrences/${made.body.id}`, { capacityHa: 3, version: 1 }))
      .status,
    200,
  );
  assert.equal(
    (await post(`/occurrences/${made.body.id}`, { capacityHa: 4, version: 1 }))
      .status,
    409,
  );
  const list = await s.agent
    .get(`/api/estates/${estate}/catalog/occurrences`)
    .query({ q: body.taskCode });
  assert.equal(list.body.items[0].capacity_ha, "3.00");
});

test("period lifecycle is manager-only, versioned, audited and enforces lock", async () => {
  const s = await login("manager@eoms.local"),
    clerk = await login("clerk@eoms.local");
  const month = `${3000 + Math.floor(Math.random() * 5000)}-01-01`;
  const post = (who: any, path: string, body: object) =>
    who.agent
      .post(`/api/estates/${estate}${path}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", who.csrf)
      .send(body)
      .timeout({ deadline: 5000 });
  assert.equal((await post(clerk, "/periods", { month })).status, 403);
  assert.equal(
    (await post(s, "/periods", { month: "2026-13-01" })).status,
    422,
  );
  const made = await post(s, "/periods", { month });
  assert.equal(made.status, 201);
  assert.equal((await post(s, "/periods", { month })).status, 409);
  const locked = await post(s, `/periods/${month}`, {
    locked: true,
    version: 1,
    reason: "Month closed after review",
  });
  assert.equal(locked.status, 200);
  assert.equal(
    (await create(s, { ...(await fixture()), businessDate: month })).status,
    409,
  );
  assert.equal(
    (
      await post(s, `/periods/${month}`, {
        locked: false,
        version: 1,
        reason: "Stale change",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(s, `/periods/${month}`, {
        locked: false,
        version: 2,
        reason: "Correction authorised",
      })
    ).status,
    200,
  );
  assert.equal(
    (await create(s, { ...(await fixture()), businessDate: month })).status,
    201,
  );
  const log = await admin.query(
    "SELECT detail FROM eoms.audit WHERE estate_id=$1 AND action='period.updated' AND detail->>'month'=$2",
    [estate, month],
  );
  assert.equal(log.rowCount, 2);
});

test("catalog pagination is bounded and preserves search and tenant filters", async () => {
  const s = await login();
  const endpoint = `/api/estates/${estate}/catalog/workers`;
  const a = await s.agent.get(endpoint).query({ limit: 2 });
  assert.equal(a.status, 200);
  assert.equal(a.body.items.length, 2);
  assert.ok(a.body.nextCursor);
  const b = await s.agent
    .get(endpoint)
    .query({ limit: 2, cursor: a.body.nextCursor });
  assert.equal(b.status, 200);
  assert.ok(
    b.body.items.every(
      (r: any) => !a.body.items.some((v: any) => v.id === r.id),
    ),
  );
  assert.equal(
    (await s.agent.get(endpoint).query({ limit: 1000 })).status,
    422,
  );
  assert.equal(
    (await s.agent.get(endpoint).query({ cursor: "bad" })).status,
    422,
  );
  assert.equal(
    (await s.agent.get(`/api/estates/${other}/catalog/workers`)).status,
    403,
  );
});
