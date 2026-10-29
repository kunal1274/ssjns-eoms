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
  viewer: any,
  customer: string,
  estate: string,
  hidden: string,
  block: any,
  tasks: any[];
const prefix = "LR-" + randomUUID().slice(0, 8);
const path = () => `/api/estates/${estate}`;
function post(actor: any, url: string, body: any) {
  return actor.agent
    .post(url)
    .set("Origin", "http://localhost:5174")
    .set("X-CSRF-Token", actor.csrf)
    .send(body);
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
    return { agent, csrf: r.body.csrf, id: r.body.user.id };
  }
  manager = await login("manager@eoms.local");
  viewer = await login("supervisor@eoms.local");
  customer = (
    await admin.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,'ZZZZ legacy review fixture') RETURNING id",
      [prefix],
    )
  ).rows[0].id;
  const company = (
    await admin.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Review fixture company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  estate = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Review fixture estate') RETURNING id",
      [customer, company, prefix],
    )
  ).rows[0].id;
  hidden = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Hidden review sibling') RETURNING id",
      [customer, company, prefix + "-H"],
    )
  ).rows[0].id;
  for (const actor of [manager, viewer])
    await admin.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,$3)",
      [actor.id, estate, actor === manager ? "manager" : "supervisor"],
    );
  await admin.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [customer, manager.id],
  );
  const d = await post(manager, path() + "/units", {
    kind: "division",
    code: prefix + "-D",
    name: "Review division",
    parentId: null,
    reason: "Prepare review fixture",
  });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const b = await post(manager, path() + "/units", {
    kind: "block",
    code: prefix + "-B",
    name: "Reviewed block",
    parentId: d.body.id,
    reason: "Prepare explicit block mapping",
  });
  assert.equal(b.status, 201);
  block = b.body;
  tasks = (
    await admin.query(
      "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) SELECT $1,$2,$3||i::text,'Literal %_ review','R',2 FROM generate_series(1,27) i RETURNING *",
      [estate, block.code, prefix],
    )
  ).rows;
});
after(async () => {
  if (estate)
    await admin.query("DELETE FROM eoms.memberships WHERE estate_id=$1", [
      estate,
    ]);
  if (customer)
    await admin.query(
      "DELETE FROM eoms.organization_admins WHERE customer_id=$1",
      [customer],
    );
  await pool.end();
  await admin.end();
});
test("legacy task queues page unresolved records with literal filters and bound scope/account cursors", async () => {
  const first = await manager.agent.get(
    path() + "/legacy-review/tasks?q=" + encodeURIComponent("%_") + "&limit=25",
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 25);
  assert.equal(first.body.canLink, true);
  const second = await manager.agent.get(
    path() +
      "/legacy-review/tasks?q=" +
      encodeURIComponent("%_") +
      "&limit=25&cursor=" +
      first.body.nextCursor,
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.items.length, 2);
  assert.equal(
    new Set([...first.body.items, ...second.body.items].map((x) => x.id)).size,
    27,
  );
  for (const [actor, url] of [
    [
      viewer,
      path() +
        "/legacy-review/tasks?q=" +
        encodeURIComponent("%_") +
        "&cursor=" +
        first.body.nextCursor,
    ],
    [
      manager,
      path() + "/legacy-review/tasks?q=changed&cursor=" + first.body.nextCursor,
    ],
    [
      manager,
      path() +
        "/legacy-review/work?q=" +
        encodeURIComponent("%_") +
        "&cursor=" +
        first.body.nextCursor,
    ],
    [manager, path() + "/legacy-review/tasks?cursor=bad"],
    [manager, path() + "/legacy-review/tasks?limit=101"],
    [manager, path() + "/legacy-review/tasks?unsupported=true"],
  ] as const)
    assert.equal((await actor.agent.get(url)).status, 422);
  assert.equal(
    (await viewer.agent.get(path() + "/legacy-review/tasks")).body.canLink,
    false,
  );
  for (const suffix of ["tasks", "work", `tasks/${tasks[0].id}`])
    assert.equal(
      (
        await manager.agent.get(
          `/api/estates/${hidden}/legacy-review/${suffix}`,
        )
      ).status,
      403,
    );
  assert.equal(
    (await request(app).get(path() + "/legacy-review/tasks")).status,
    401,
  );
});
test("legacy review refreshes real versions and shows only the actual reasoned link audit without rewriting work", async () => {
  const task = tasks[0],
    url = path() + "/legacy-review/tasks/" + task.id;
  const initial = await manager.agent.get(url);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.block_unit_id, null);
  assert.equal(initial.body.linkEvent, null);
  assert.equal((await viewer.agent.get(url)).body.can_link, false);
  const write = path() + `/occurrences/${task.id}/block-link`,
    body = {
      blockId: block.id,
      version: 1,
      reason: "Reviewed explicit legacy block mapping",
    };
  assert.equal((await post(viewer, write, body)).status, 403);
  assert.equal(
    (await post(manager, write, { ...body, blockId: randomUUID() })).status,
    422,
  );
  const ok = await post(manager, write, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await post(manager, write, body)).status, 409);
  const detail = await manager.agent.get(url);
  assert.equal(detail.body.block_unit_id, block.id);
  assert.equal(detail.body.version, 2);
  assert.equal(detail.body.linkEvent.reason, body.reason);
  assert.equal(detail.body.linkEvent.actor_id, manager.id);
  assert.ok(detail.body.linkEvent.request_id);
  assert.equal(detail.body.linkEvent.before_state.parentId, null);
  assert.equal(detail.body.linkEvent.after_state.parentId, block.id);
  const remaining = await manager.agent.get(
    path() + "/legacy-review/tasks?q=" + task.id,
  );
  assert.deepEqual(remaining.body.items, []);
  const count = async () =>
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM eoms.hierarchy_history WHERE record_type='task-link' AND record_id=$1",
        [task.id],
      )
    ).rows[0].n;
  assert.equal(await count(), 1);
  await manager.agent.get(url);
  await manager.agent.get(path() + "/legacy-review/work");
  assert.equal(await count(), 1);
  assert.equal(
    (await manager.agent.get(path() + "/legacy-review/tasks/" + randomUUID()))
      .status,
    404,
  );
});
test("legacy queues do not classify new attributed work as missing and deny both pages and review after revocation", async () => {
  const before = (await manager.agent.get(path() + "/legacy-review/work")).body;
  assert.deepEqual(before.items, []);
  await admin.query(
    "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'SYNTHETIC','Synthetic review gang')",
    [estate],
  );
  await admin.query(
    "INSERT INTO eoms.musters(estate_id,occurrence_id,business_date,gang_code,quantity_ha,created_by) VALUES($1,$2,'8800-01-15','SYNTHETIC',0.1,$3)",
    [estate, tasks[1].id, manager.id],
  );
  assert.deepEqual(
    (await manager.agent.get(path() + "/legacy-review/work")).body.items,
    [],
  );
  const first = await manager.agent.get(
    path() + "/legacy-review/tasks?limit=1",
  );
  await admin.query(
    "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
    [manager.id, estate],
  );
  for (const suffix of [
    "tasks",
    "work",
    `tasks/${tasks[1].id}`,
    "tasks?limit=1&cursor=" + first.body.nextCursor,
  ])
    assert.equal(
      (await manager.agent.get(path() + "/legacy-review/" + suffix)).status,
      403,
    );
});
