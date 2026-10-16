import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { passwordHash } from "../apps/api/src/security";
const url = new URL(process.env.DATABASE_URL!),
  root = new URL(process.env.ADMIN_DATABASE_URL!);
if (url.hostname !== "127.0.0.1" || root.hostname !== "127.0.0.1")
  throw Error("Local synthetic database required");
url.pathname = root.pathname = "/eoms_test";
const pool = new pg.Pool({ connectionString: url.href }),
  admin = new pg.Pool({ connectionString: root.href }),
  app = createApp(pool),
  estate = "20000000-0000-4000-8000-000000000001",
  otherEstate = "20000000-0000-4000-8000-000000000002",
  origin = "http://localhost:5174";
let manager: any,
  supervisor: any,
  readonlyManager: any,
  customer: string,
  foreignCustomer: string,
  foreignEstate: string,
  foreignGroup: string;
const suffix = () =>
  randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
async function login(email: string, password: string) {
  const agent = request.agent(app);
  const result = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email, password });
  assert.equal(result.status, 200);
  return { agent, csrf: result.body.csrf, id: result.body.user.id };
}
function post(actor: any, path: string, body: object) {
  return actor.agent
    .post("/api" + path)
    .set("Origin", origin)
    .set("X-CSRF-Token", actor.csrf)
    .send(body);
}
async function createUnit(
  kind: string,
  parentId: string | null = null,
  target = estate,
  code = kind[0].toUpperCase() + suffix(),
) {
  const response = await post(manager, `/estates/${target}/units`, {
    kind,
    code,
    name: "Test " + kind,
    parentId,
    reason: "Create test hierarchy",
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}
before(async () => {
  const accounts = JSON.parse(
    await readFile(".local/test-accounts.json", "utf8"),
  );
  for (const email of ["manager@eoms.local", "supervisor@eoms.local"]) {
    const account = accounts.find((a: any) => a.email === email);
    const actor = await login(email, account.password);
    if (email.startsWith("manager")) manager = actor;
    else supervisor = actor;
  }
  customer = (
    await admin.query("SELECT customer_id FROM eoms.estates WHERE id=$1", [
      estate,
    ])
  ).rows[0].customer_id;
  const id = randomUUID(),
    email = "readonly-" + suffix() + "@fixture.local",
    password = "Synthetic-only-" + suffix();
  await admin.query(
    "INSERT INTO eoms.users(id,email,display_name,password_hash) VALUES($1,$2,'Read-only manager',$3)",
    [id, email, await passwordHash(password)],
  );
  await admin.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [id, estate],
  );
  readonlyManager = await login(email, password);
  foreignCustomer = (
    await admin.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,'Foreign hierarchy customer') RETURNING id",
      ["FOREIGN-" + suffix()],
    )
  ).rows[0].id;
  const company = (
    await admin.query(
      "INSERT INTO eoms.companies(name,customer_id) VALUES('Foreign hierarchy company',$1) RETURNING id",
      [foreignCustomer],
    )
  ).rows[0].id;
  foreignEstate = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,'SN','Foreign estate') RETURNING id",
      [foreignCustomer, company],
    )
  ).rows[0].id;
  foreignGroup = (
    await admin.query(
      "INSERT INTO eoms.customer_groups(customer_id,code,name) VALUES($1,'FOREIGN','Foreign group') RETURNING id",
      [foreignCustomer],
    )
  ).rows[0].id;
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("hierarchy setup needs an explicit grant, not just a manager role", async () => {
  assert.equal(
    (await request(app).get(`/api/customers/${customer}/hierarchy`)).status,
    401,
  );
  for (const actor of [supervisor, readonlyManager]) {
    const view = await actor.agent.get(`/api/customers/${customer}/hierarchy`);
    assert.equal(view.status, 200);
    assert.equal(view.body.canConfigure, false);
    assert.equal(
      (
        await post(actor, `/customers/${customer}/groups`, {
          code: "DENIED",
          name: "Denied",
          reason: "No setup permission",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post(actor, `/estates/${estate}/units`, {
          kind: "division",
          code: "DENIED",
          name: "Denied",
          parentId: null,
          reason: "No setup permission",
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (await manager.agent.get(`/api/customers/${customer}/hierarchy`)).body
      .canConfigure,
    true,
  );
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [
      readonlyManager.id,
    ]);
    await assert.rejects(
      () =>
        c.query(
          "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) VALUES($1,$2,'division','DENIED','Denied')",
          [customer, estate],
        ),
      (e: any) => e.code === "42501",
    );
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
test("group assignment is scoped/versioned and records actor reason and request reference", async () => {
  const code = "G" + suffix(),
    created = await post(manager, `/customers/${customer}/groups`, {
      code: code.toLowerCase(),
      name: "Test group",
      reason: "Group organization test",
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.code, code);
  assert.equal(
    (
      await post(manager, `/customers/${customer}/groups`, {
        code,
        name: "Duplicate",
        reason: "Duplicate group test",
      })
    ).status,
    409,
  );
  const company = (
    await manager.agent.get(`/api/customers/${customer}/hierarchy`)
  ).body.companies[0];
  const changed = await post(
    manager,
    `/customers/${customer}/companies/${company.id}/group`,
    {
      groupId: created.body.id,
      version: company.hierarchy_version,
      reason: "Assign company test",
    },
  );
  assert.equal(changed.status, 200);
  assert.equal(changed.body.hierarchy_version, company.hierarchy_version + 1);
  assert.equal(
    (
      await post(
        manager,
        `/customers/${customer}/companies/${company.id}/group`,
        {
          groupId: null,
          version: company.hierarchy_version,
          reason: "Stale assignment test",
        },
      )
    ).status,
    409,
  );
  const audit = (
    await admin.query(
      "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1",
      [created.body.id],
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, manager.id);
  assert.equal(audit[0].reason, "Group organization test");
  assert.equal(audit[0].request_id, created.headers["x-request-id"]);
});
test("division field block rules reject cycles invalid types and cross-estate parents", async () => {
  const division = await createUnit("division"),
    field = await createUnit("field", division.id),
    block = await createUnit("block", field.id),
    other = await createUnit("division", null, otherEstate);
  for (const body of [
    { kind: "field", parentId: block.id },
    { kind: "block", parentId: other.id },
    { kind: "division", parentId: field.id },
  ]) {
    const result = await post(manager, `/estates/${estate}/units`, {
      ...body,
      code: "X" + suffix(),
      name: "Invalid relation",
      reason: "Invalid relation test",
    });
    assert.equal(result.status, 422, JSON.stringify(result.body));
  }
  assert.equal(
    (
      await post(manager, `/estates/${estate}/units/${block.id}`, {
        kind: "block",
        code: block.code,
        name: block.name,
        parentId: block.id,
        version: 1,
        reason: "Reject self parent",
      })
    ).status,
    422,
  );
  await assert.rejects(
    () =>
      admin.query(
        "UPDATE eoms.operating_units SET parent_id=$2,version=version+1 WHERE id=$1",
        [division.id, block.id],
      ),
    (e: any) => e.code === "23514",
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM eoms.hierarchy_history WHERE record_id=$1",
        [block.id],
      )
    ).rows[0].n,
    1,
  );
});
test("unit edits preserve optimistic version and before/after audit without stale overwrite", async () => {
  const division = await createUnit("division"),
    block = await createUnit("block", division.id);
  const body = {
    kind: "block",
    code: block.code,
    name: "Edited block",
    parentId: division.id,
    version: 1,
    reason: "Rename block test",
  };
  const result = await post(
    manager,
    `/estates/${estate}/units/${block.id}`,
    body,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 2);
  assert.equal(
    (
      await post(manager, `/estates/${estate}/units/${block.id}`, {
        ...body,
        name: "Stale overwrite",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(manager, `/estates/${estate}/units/${block.id}`, {
        ...body,
        kind: "field",
        version: 2,
      })
    ).status,
    409,
  );
  const events = (
    await admin.query(
      "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1 ORDER BY id",
      [block.id],
    )
  ).rows;
  assert.equal(events.length, 2);
  assert.equal(events[1].before_state.name, block.name);
  assert.equal(events[1].after_state.name, "Edited block");
  assert.equal(events[1].request_id, result.headers["x-request-id"]);
});
test("foreign customer estate and group references are denied and codes remain tenant/estate local", async () => {
  assert.equal(
    (await manager.agent.get(`/api/customers/${foreignCustomer}/hierarchy`))
      .status,
    404,
  );
  assert.equal(
    (await manager.agent.get(`/api/estates/${foreignEstate}/units`)).status,
    404,
  );
  assert.equal(
    (
      await manager.agent.get(
        `/api/customers/${foreignCustomer}/hierarchy/history`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(manager, `/customers/${foreignCustomer}/groups`, {
        code: "DENIED",
        name: "Denied",
        reason: "Foreign test",
      })
    ).status,
    403,
  );
  const company = (
    await manager.agent.get(`/api/customers/${customer}/hierarchy`)
  ).body.companies[0];
  assert.equal(
    (
      await post(
        manager,
        `/customers/${customer}/companies/${company.id}/group`,
        {
          groupId: foreignGroup,
          version: company.hierarchy_version,
          reason: "Reject foreign group",
        },
      )
    ).status,
    422,
  );
  const code = "D" + suffix();
  await createUnit("division", null, estate, code);
  await createUnit("division", null, otherEstate, code);
  assert.equal(
    (
      await post(manager, `/estates/${estate}/units`, {
        kind: "division",
        code,
        name: "Duplicate",
        parentId: null,
        reason: "Duplicate unit test",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await admin.query("SELECT code FROM eoms.estates WHERE id=$1", [
        foreignEstate,
      ])
    ).rows[0].code,
    "SN",
  );
});
test("runtime cannot self grant mutate audit or rewrite hierarchy scope", async () => {
  for (const sql of [
    "DELETE FROM eoms.hierarchy_history",
    "UPDATE eoms.hierarchy_history SET reason='rewrite'",
    "DELETE FROM eoms.operating_units",
    "INSERT INTO eoms.organization_admins(customer_id,user_id) SELECT id,gen_random_uuid() FROM eoms.customers",
    "UPDATE eoms.operating_units SET customer_id=gen_random_uuid()",
  ]) {
    await assert.rejects(
      () => pool.query(sql),
      (e: any) => e.code === "42501",
    );
  }
  assert.equal(
    (await pool.query("SELECT * FROM eoms.operating_units")).rowCount,
    0,
  );
  const bootstrap = (
    await admin.query(
      "SELECT * FROM eoms.hierarchy_history WHERE customer_id=$1 AND record_type='setup-grant'",
      [customer],
    )
  ).rows;
  assert.ok(bootstrap.length >= 1);
  assert.equal(bootstrap[0].actor_id, null);
});
