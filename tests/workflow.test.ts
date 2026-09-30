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
const adm = new URL(process.env.ADMIN_DATABASE_URL!);
adm.pathname = "/eoms_test";
if (url.hostname !== "127.0.0.1") throw Error("Local test database only");
const pool = new pg.Pool({ connectionString: url.href }),
  admin = new pg.Pool({ connectionString: adm.href }),
  app = createApp(pool),
  estate = "20000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000002",
  origin = "http://localhost:5174";
let accounts: any[], manager: any, supervisor: any;
async function login(email: string) {
  const a = accounts.find((a) => a.email === email),
    agent = request.agent(app);
  const r = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email, password: a.password });
  assert.equal(r.status, 200);
  return { agent, csrf: r.body.csrf, id: r.body.user.id };
}
function post(s: any, path: string, body: object) {
  return s.agent
    .post(`/api/estates/${estate}${path}`)
    .set("Origin", origin)
    .set("X-CSRF-Token", s.csrf)
    .set("Idempotency-Key", randomUUID())
    .send(body)
    .timeout({ deadline: 5000 });
}
async function fixture(gangCode = "G-01") {
  const occurrence = (
    await admin.query(
      "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'WF',$2,'Spraying','WF',2) RETURNING id",
      [estate, randomUUID()],
    )
  ).rows[0].id;
  const workers = (
    await admin.query(
      "SELECT id FROM eoms.workers WHERE estate_id=$1 AND active LIMIT 2",
      [estate],
    )
  ).rows.map((r) => r.id);
  return {
    occurrenceId: occurrence,
    businessDate: "2026-09-28",
    gangCode,
    quantityHa: 1,
    workerIds: workers,
  };
}
before(async () => {
  accounts = JSON.parse(await readFile(".local/test-accounts.json", "utf8"));
  manager = await login("manager@eoms.local");
  supervisor = await login("supervisor@eoms.local");
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("manager registers gangs and assignments; unassigned supervisor cannot capture", async () => {
  const body = {
    code: "WF-" + randomUUID().slice(0, 12),
    name: "Workflow gang",
    supervisorIds: [],
  };
  assert.equal((await post(supervisor, "/gangs", body)).status, 403);
  const gang = await post(manager, "/gangs", body);
  assert.equal(gang.status, 201);
  assert.equal(
    (await post(supervisor, "/musters", await fixture(body.code))).status,
    403,
  );
  const updated = await post(manager, `/gangs/${gang.body.id}`, {
    name: body.name,
    active: true,
    supervisorIds: [supervisor.id],
    version: 1,
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (await post(supervisor, "/musters", await fixture(body.code))).status,
    201,
  );
  assert.equal(
    (
      await post(manager, `/gangs/${gang.body.id}`, {
        name: "Stale",
        active: true,
        supervisorIds: [],
        version: 1,
      })
    ).status,
    409,
  );
  const outsider = (
    await admin.query("SELECT id FROM eoms.users WHERE email='ibam@eoms.local'")
  ).rows[0].id;
  assert.equal(
    (
      await post(manager, "/gangs", {
        ...body,
        code: "BAD-" + randomUUID().slice(0, 8),
        supervisorIds: [outsider],
      })
    ).status,
    422,
  );
  assert.equal(
    (await supervisor.agent.get(`/api/estates/${other}/gangs`)).status,
    403,
  );
});
test("approval and reversal are manager-only, versioned, immutable and release area once", async () => {
  const body = await fixture();
  const made = await post(manager, "/musters", body);
  assert.equal(made.status, 201);
  const id = made.body.id;
  assert.equal(
    (
      await post(manager, `/musters/${id}/approve`, {
        version: 1,
        reason: "Reviewed field evidence",
      })
    ).status,
    409,
  );
  assert.equal(
    (await post(manager, `/musters/${id}/confirm`, { version: 1 })).status,
    200,
  );
  assert.equal(
    (
      await post(supervisor, `/musters/${id}/approve`, {
        version: 2,
        reason: "Supervisor review",
      })
    ).status,
    403,
  );
  const approved = await post(manager, `/musters/${id}/approve`, {
    version: 2,
    reason: "Reviewed field evidence",
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.review_status, "approved");
  assert.equal(
    (
      await post(manager, `/musters/${id}/reverse`, {
        version: 2,
        reason: "Wrong area recorded",
      })
    ).status,
    409,
  );
  assert.equal(
    (await post(manager, `/musters/${id}/reverse`, { version: 3, reason: "" }))
      .status,
    422,
  );
  const replies = await Promise.all([
    post(manager, `/musters/${id}/reverse`, {
      version: 3,
      reason: "Wrong area recorded",
    }),
    post(manager, `/musters/${id}/reverse`, {
      version: 3,
      reason: "Wrong area recorded",
    }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  const detail = await manager.agent.get(
    `/api/estates/${estate}/musters/${id}`,
  );
  assert.equal(detail.body.status, "reversed");
  assert.equal(detail.body.quantity_ha, "1.00");
  assert.equal(detail.body.shares.length, 2);
  assert.equal(
    (await post(manager, `/musters/${id}/confirm`, { version: 4 })).status,
    409,
  );
  const replacement = await post(manager, "/musters", {
    ...body,
    quantityHa: 2,
  });
  assert.equal(replacement.status, 201);
  assert.equal(
    (
      await post(manager, `/musters/${replacement.body.id}/confirm`, {
        version: 1,
      })
    ).status,
    200,
  );
  const events = await admin.query(
    "SELECT count(*) FROM eoms.outbox WHERE aggregate_id=$1 AND event_type='muster.reversed'",
    [id],
  );
  assert.equal(events.rows[0].count, "1");
});
test("locked periods reject review and reversal; assignment removal blocks confirmation", async () => {
  const gang = await post(manager, "/gangs", {
    code: "LOCK-" + randomUUID().slice(0, 8),
    name: "Scoped gang",
    supervisorIds: [supervisor.id],
  });
  assert.equal(gang.status, 201);
  const draft = await post(
    supervisor,
    "/musters",
    await fixture(gang.body.code),
  );
  assert.equal(draft.status, 201);
  await post(manager, `/gangs/${gang.body.id}`, {
    name: "Scoped gang",
    active: true,
    supervisorIds: [],
    version: 1,
  });
  assert.equal(
    (
      await post(supervisor, `/musters/${draft.body.id}/confirm`, {
        version: 1,
      })
    ).status,
    403,
  );
  await post(manager, `/musters/${draft.body.id}/confirm`, { version: 1 });
  await admin.query(
    "UPDATE eoms.periods SET locked=true WHERE estate_id=$1 AND month='2026-09-01'",
    [estate],
  );
  try {
    for (const action of ["approve", "reverse"])
      assert.equal(
        (
          await post(manager, `/musters/${draft.body.id}/${action}`, {
            version: 2,
            reason: "Period protection test",
          })
        ).status,
        409,
      );
  } finally {
    await admin.query(
      "UPDATE eoms.periods SET locked=false WHERE estate_id=$1 AND month='2026-09-01'",
      [estate],
    );
  }
});
