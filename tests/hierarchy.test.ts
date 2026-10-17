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
    email = "readonly-" + suffix().toLowerCase() + "@fixture.local",
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
  assert.equal(
    (await supervisor.agent.get(`/api/estates/${otherEstate}/units`)).status,
    404,
  );
  const scopedHistory = await supervisor.agent.get(
    `/api/customers/${customer}/hierarchy/history`,
  );
  assert.equal(scopedHistory.status, 200);
  assert.ok(
    scopedHistory.body.items.some((event: any) => event.record_id === block.id),
  );
  assert.ok(
    scopedHistory.body.items.every(
      (event: any) =>
        event.record_type === "unit" && event.record_id !== other.id,
    ),
  );
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

async function newTask(blockCode: string, blockId?: string) {
  const result = await post(manager, `/estates/${estate}/occurrences`, {
    ...(blockId
      ? { blockId, reason: "Reviewed configured task block" }
      : { blockCode }),
    taskCode: "TASK-" + suffix(),
    activity: "Synthetic block linkage",
    roundCode: "LINK",
    capacityHa: 2,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result;
}
test("configured task creation uses the block identity and records projected link history", async () => {
  const division = await createUnit("division"),
    block = await createUnit("block", division.id);
  const result = await newTask("unused", block.id);
  assert.equal(result.body.block_unit_id, block.id);
  assert.equal(result.body.block_code, block.code);
  const history = (
    await admin.query(
      "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1 AND record_type='task-link'",
      [result.body.id],
    )
  ).rows;
  assert.equal(history.length, 1);
  assert.equal(history[0].action, "created");
  assert.equal(history[0].actor_id, manager.id);
  assert.equal(history[0].request_id, result.headers["x-request-id"]);
  assert.equal(history[0].after_state.parentId, block.id);
  const renamed = await post(manager, `/estates/${estate}/units/${block.id}`, {
    kind: "block",
    code: "R" + suffix(),
    name: "Renamed configured block",
    parentId: division.id,
    version: 1,
    reason: "Rename after task creation",
  });
  assert.equal(renamed.status, 200);
  const catalog = await manager.agent
    .get(`/api/estates/${estate}/catalog/occurrences`)
    .query({ q: result.body.task_code });
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.items[0].block_code, block.code);
  assert.equal(catalog.body.items[0].linked_block_code, renamed.body.code);
  assert.equal(catalog.body.items[0].block_unit_id, block.id);
});
test("legacy tasks link only after matching review and retain existing identity and quantities", async () => {
  const division = await createUnit("division"),
    block = await createUnit("block", division.id),
    task = (await newTask(block.code)).body;
  assert.equal(task.block_unit_id, null);
  await admin.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'8801-01-01') ON CONFLICT DO NOTHING",
    [estate],
  );
  const worker = (
    await admin.query(
      "SELECT id FROM eoms.workers WHERE estate_id=$1 AND active LIMIT 1",
      [estate],
    )
  ).rows[0].id;
  const work = await manager.agent
    .post(`/api/estates/${estate}/musters`)
    .set("Origin", origin)
    .set("X-CSRF-Token", manager.csrf)
    .set("Idempotency-Key", randomUUID())
    .send({
      occurrenceId: task.id,
      businessDate: "8801-01-15",
      gangCode: "G-01",
      quantityHa: 0.1,
      workerIds: [worker],
    });
  assert.equal(work.status, 201, JSON.stringify(work.body));
  const priorWork = (
    await admin.query("SELECT * FROM eoms.musters WHERE id=$1", [work.body.id])
  ).rows;
  const priorAllocation = (
    await admin.query("SELECT * FROM eoms.muster_shares WHERE muster_id=$1", [
      work.body.id,
    ])
  ).rows;
  const payload = {
    blockId: block.id,
    version: task.version,
    reason: "Review legacy block attribution",
  };
  const linked = await post(
    manager,
    `/estates/${estate}/occurrences/${task.id}/block-link`,
    payload,
  );
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.id, task.id);
  assert.deepEqual(
    (
      await admin.query("SELECT * FROM eoms.musters WHERE id=$1", [
        work.body.id,
      ])
    ).rows,
    priorWork,
  );
  assert.deepEqual(
    (
      await admin.query("SELECT * FROM eoms.muster_shares WHERE muster_id=$1", [
        work.body.id,
      ])
    ).rows,
    priorAllocation,
  );
  assert.equal(linked.body.capacity_ha, task.capacity_ha);
  assert.equal(linked.body.block_code, task.block_code);
  assert.equal(linked.body.version, task.version + 1);
  assert.equal(
    (
      await post(
        manager,
        `/estates/${estate}/occurrences/${task.id}/block-link`,
        payload,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await post(
        manager,
        `/estates/${estate}/occurrences/${task.id}/block-link`,
        { ...payload, version: linked.body.version },
      )
    ).status,
    409,
  );
  const history = (
    await admin.query(
      "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1 AND record_type='task-link'",
      [task.id],
    )
  ).rows;
  assert.equal(history.length, 1);
  assert.equal(history[0].before_state.parentId, null);
  assert.equal(history[0].after_state.parentId, block.id);
  assert.equal(history[0].reason, payload.reason);
  assert.equal(history[0].request_id, linked.headers["x-request-id"]);
  const audit = (
    await admin.query(
      "SELECT detail FROM eoms.audit WHERE record_id=$1 AND action='task.block-linked'",
      [task.id],
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].detail.blockId, block.id);
  // A capacity edit after linking does not rewrite or duplicate the recorded relationship.
  assert.equal(
    (
      await post(manager, `/estates/${estate}/occurrences/${task.id}`, {
        capacityHa: 3,
        version: linked.body.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1 AND record_type='task-link'",
        [task.id],
      )
    ).rowCount,
    1,
  );
});
test("block link API rejects foreign wrong-kind mismatched missing-reason and unauthorized requests", async () => {
  const division = await createUnit("division"),
    block = await createUnit("block", division.id),
    task = (await newTask(block.code)).body;
  const otherDivision = await createUnit("division", null, otherEstate),
    otherBlock = await createUnit(
      "block",
      otherDivision.id,
      otherEstate,
      block.code,
    );
  const payload = {
    blockId: block.id,
    version: task.version,
    reason: "Reviewed matching block",
  };
  assert.equal(
    (
      await post(
        supervisor,
        `/estates/${estate}/occurrences/${task.id}/block-link`,
        payload,
      )
    ).status,
    403,
  );
  for (const actor of [manager, supervisor])
    assert.equal(
      (
        await post(
          actor,
          `/estates/${foreignEstate}/occurrences/${task.id}/block-link`,
          payload,
        )
      ).status,
      403,
    );
  for (const invalid of [
    { ...payload, blockId: division.id },
    { ...payload, blockId: otherBlock.id },
    { ...payload, reason: "" },
  ])
    assert.equal(
      (
        await post(
          manager,
          `/estates/${estate}/occurrences/${task.id}/block-link`,
          invalid,
        )
      ).status,
      422,
    );
  const mismatch = (await newTask("UNMATCHED-" + suffix())).body;
  assert.equal(
    (
      await post(
        manager,
        `/estates/${estate}/occurrences/${mismatch.id}/block-link`,
        { ...payload, version: mismatch.version },
      )
    ).status,
    422,
  );
  const create = {
    taskCode: "BAD-" + suffix(),
    activity: "Invalid block link",
    roundCode: "LINK",
    capacityHa: 1,
  };
  for (const invalid of [
    { blockId: otherBlock.id, reason: "Foreign block" },
    { blockId: division.id, reason: "Wrong kind" },
    { blockId: block.id },
    { blockId: block.id, blockCode: block.code, reason: "Ambiguous source" },
  ])
    assert.equal(
      (
        await post(manager, `/estates/${estate}/occurrences`, {
          ...create,
          ...invalid,
        })
      ).status,
      422,
    );
  assert.equal(
    (
      await admin.query(
        "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1 AND record_type='task-link'",
        [task.id],
      )
    ).rowCount,
    0,
  );
});
test("database enforces block kind estate reason version manager authority and immutable saved links", async () => {
  const division = await createUnit("division"),
    block = await createUnit("block", division.id),
    task = (await newTask(block.code)).body;
  const c = await pool.connect();
  async function rejected(
    sql: string,
    args: unknown[],
    code: string,
    actor = manager.id,
    reason = "Direct guard test",
  ) {
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.change_reason',$2,true)",
        [actor, reason],
      );
      await assert.rejects(
        () => c.query(sql, args),
        (e: any) => e.code === code,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  }
  try {
    const update =
      "UPDATE eoms.occurrences SET block_unit_id=$2,version=version+1 WHERE id=$1";
    await rejected(update, [task.id, division.id], "23514");
    await rejected(update, [task.id, block.id], "23514", manager.id, "");
    await rejected(update, [task.id, block.id], "42501", supervisor.id);
    await rejected(
      "UPDATE eoms.occurrences SET block_unit_id=$2 WHERE id=$1",
      [task.id, block.id],
      "23514",
    );
    const linked = await post(
      manager,
      `/estates/${estate}/occurrences/${task.id}/block-link`,
      {
        blockId: block.id,
        version: task.version,
        reason: "Lock reviewed relationship",
      },
    );
    assert.equal(linked.status, 200);
    await rejected(update, [task.id, null], "23514");
  } finally {
    c.release();
  }
});

async function areaNode(
  kind: string,
  parentId: string | null = null,
  code = "AR-" + suffix(),
) {
  const response = await post(manager, `/customers/${customer}/areas`, {
    kind,
    code,
    name: "Test operating " + kind,
    parentId,
    reason: "Create synthetic operating area",
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}
async function placementEstate(withReadonly = false) {
  const company = (
    await admin.query("SELECT company_id FROM eoms.estates WHERE id=$1", [
      estate,
    ])
  ).rows[0].company_id;
  const row = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Placement fixture estate') RETURNING *",
      [customer, company, "PL-" + suffix()],
    )
  ).rows[0];
  await admin.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [manager.id, row.id],
  );
  if (withReadonly)
    await admin.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [readonlyManager.id, row.id],
    );
  return row;
}
test("optional regions and business units enforce type scope codes and attributable display edits", async () => {
  const region = await areaNode("region"),
    business = await areaNode("business-unit", region.id),
    rootBusiness = await areaNode("business-unit");
  assert.equal(business.parent_id, region.id);
  assert.equal(rootBusiness.parent_id, null);
  assert.equal(
    (
      await post(manager, `/customers/${customer}/areas`, {
        kind: "region",
        code: region.code,
        name: "Duplicate",
        parentId: null,
        reason: "Duplicate area",
      })
    ).status,
    409,
  );
  for (const input of [
    { kind: "region", parentId: business.id },
    { kind: "business-unit", parentId: business.id },
  ])
    assert.equal(
      (
        await post(manager, `/customers/${customer}/areas`, {
          ...input,
          code: "BAD-" + suffix(),
          name: "Invalid",
          reason: "Invalid parent type",
        })
      ).status,
      422,
    );
  const updated = await post(
    manager,
    `/customers/${customer}/areas/${business.id}`,
    {
      code: business.code,
      name: "Reviewed operating unit",
      version: 1,
      reason: "Correct operating label",
    },
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.version, 2);
  assert.equal(
    (
      await post(manager, `/customers/${customer}/areas/${business.id}`, {
        code: business.code,
        name: "Stale",
        version: 1,
        reason: "Stale label edit",
      })
    ).status,
    409,
  );
  const history = (
    await admin.query(
      "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1 AND record_type='area' ORDER BY id",
      [business.id],
    )
  ).rows;
  assert.equal(history.length, 2);
  assert.equal(history[1].before_state.name, business.name);
  assert.equal(history[1].after_state.name, "Reviewed operating unit");
  assert.equal(history[1].actor_id, manager.id);
  assert.equal(history[1].request_id, updated.headers["x-request-id"]);
});
test("initial estate placement preserves legal ownership and scope with no sibling visibility", async () => {
  const region = await areaNode("region"),
    business = await areaNode("business-unit", region.id),
    hiddenRegion = await areaNode("region"),
    own = await placementEstate(true),
    sibling = await placementEstate();
  const first = await post(manager, `/estates/${own.id}/placement`, {
    areaId: business.id,
    version: 1,
    reason: "Initial operating placement",
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.company_id, own.company_id);
  assert.equal(first.body.placement_version, 2);
  assert.equal(
    (
      await post(manager, `/estates/${sibling.id}/placement`, {
        areaId: hiddenRegion.id,
        version: 1,
        reason: "Sibling initial placement",
      })
    ).status,
    200,
  );
  const view = await readonlyManager.agent.get(
    `/api/customers/${customer}/placements`,
  );
  assert.equal(view.status, 200);
  assert.equal(view.body.canConfigure, false);
  assert.ok(view.body.areas.some((row: any) => row.id === region.id));
  assert.ok(view.body.areas.some((row: any) => row.id === business.id));
  assert.ok(!view.body.areas.some((row: any) => row.id === hiddenRegion.id));
  assert.ok(!view.body.estates.some((row: any) => row.id === sibling.id));
  assert.equal(
    (await readonlyManager.agent.get(`/api/estates/${sibling.id}/units`))
      .status,
    404,
  );
  const events = (
    await readonlyManager.agent.get(
      `/api/customers/${customer}/hierarchy/history`,
    )
  ).body.items;
  assert.ok(
    events.some(
      (row: any) =>
        row.record_id === own.id && row.record_type === "estate-placement",
    ),
  );
  assert.ok(
    !events.some(
      (row: any) => row.record_id === sibling.id || row.record_type === "area",
    ),
  );
  const recorded = (
    await admin.query(
      "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1 AND record_type='estate-placement'",
      [own.id],
    )
  ).rows;
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].before_state.parentId, null);
  assert.equal(recorded[0].after_state.parentId, business.id);
  assert.equal(recorded[0].request_id, first.headers["x-request-id"]);
  for (const version of [1, 2])
    assert.equal(
      (
        await post(manager, `/estates/${own.id}/placement`, {
          areaId: region.id,
          version,
          reason: "Reject placement move",
        })
      ).status,
      409,
    );
});
test("placement rejects foreign areas unauthorized writes and missing reasons", async () => {
  const own = await placementEstate(),
    region = await areaNode("region");
  const foreign = (
    await admin.query(
      "INSERT INTO eoms.operating_areas(customer_id,kind,code,name) VALUES($1,'region',$2,'Foreign operating area') RETURNING id",
      [foreignCustomer, "FR-" + suffix()],
    )
  ).rows[0].id;
  assert.equal(
    (await request(app).get(`/api/customers/${customer}/placements`)).status,
    401,
  );
  assert.equal(
    (await manager.agent.get(`/api/customers/${foreignCustomer}/placements`))
      .status,
    404,
  );
  assert.equal(
    (
      await post(manager, `/estates/${own.id}/placement`, {
        areaId: foreign,
        version: 1,
        reason: "Reject foreign area",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await post(manager, `/customers/${customer}/areas`, {
        kind: "business-unit",
        code: "XF-" + suffix(),
        name: "Foreign parent",
        parentId: foreign,
        reason: "Reject foreign region",
      })
    ).status,
    422,
  );
  for (const actor of [supervisor, readonlyManager])
    assert.equal(
      (
        await post(actor, `/customers/${customer}/areas`, {
          kind: "region",
          code: "DENIED",
          name: "Denied",
          parentId: null,
          reason: "No setup grant",
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await post(supervisor, `/estates/${estate}/placement`, {
        areaId: region.id,
        version: 1,
        reason: "No setup grant",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(manager, `/estates/${foreignEstate}/placement`, {
        areaId: region.id,
        version: 1,
        reason: "Reject foreign estate",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post(manager, `/estates/${own.id}/placement`, {
        areaId: region.id,
        version: 1,
        reason: "",
      })
    ).status,
    422,
  );
});
test("database prevents area scope changes cycles moves unaudited edits and runtime deletes", async () => {
  const region = await areaNode("region"),
    business = await areaNode("business-unit", region.id),
    own = await placementEstate();
  const c = await pool.connect();
  async function rejected(
    sql: string,
    args: unknown[],
    expected: string,
    actor = manager.id,
    reason = "Direct placement guard",
  ) {
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.change_reason',$2,true)",
        [actor, reason],
      );
      await assert.rejects(
        () => c.query(sql, args),
        (e: any) => e.code === expected,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  }
  try {
    await rejected(
      "UPDATE eoms.operating_areas SET name='Silent',version=version+1 WHERE id=$1",
      [region.id],
      "23514",
      manager.id,
      "",
    );
    await rejected(
      "UPDATE eoms.operating_areas SET parent_id=$2,version=version+1 WHERE id=$1",
      [region.id, business.id],
      "42501",
    );
    await assert.rejects(
      () =>
        admin.query(
          "UPDATE eoms.operating_areas SET parent_id=$2,version=version+1 WHERE id=$1",
          [region.id, business.id],
        ),
      (e: any) => e.code === "23514",
    );
    await rejected(
      "UPDATE eoms.estates SET area_id=$2 WHERE id=$1",
      [own.id, region.id],
      "23514",
    );
    assert.equal(
      (
        await post(manager, `/estates/${own.id}/placement`, {
          areaId: region.id,
          version: 1,
          reason: "Initial placement for guard",
        })
      ).status,
      200,
    );
    await rejected(
      "UPDATE eoms.estates SET area_id=NULL,placement_version=placement_version+1 WHERE id=$1",
      [own.id],
      "23514",
    );
    await assert.rejects(
      () => pool.query("DELETE FROM eoms.operating_areas"),
      (e: any) => e.code === "42501",
    );
    assert.equal(
      (await pool.query("SELECT * FROM eoms.operating_areas")).rowCount,
      0,
    );
  } finally {
    c.release();
  }
});

async function legalFixture() {
  const own = await placementEstate();
  const target = (
    await admin.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,$2) RETURNING id,name",
      [customer, "ZZ legal successor " + suffix()],
    )
  ).rows[0];
  const anchor = (
    await admin.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Legal target anchor') RETURNING id",
      [customer, target.id, "LA-" + suffix()],
    )
  ).rows[0];
  await admin.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [manager.id, anchor.id],
  );
  const worker = (
    await admin.query(
      "INSERT INTO eoms.workers(estate_id,code,name) VALUES($1,'LW','Legal work fixture') RETURNING id",
      [own.id],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'G-01','Legal fixture gang')",
    [own.id],
  );
  const occurrence = (
    await admin.query(
      "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'LW','LEGAL-WORK','Attribution test','L',10) RETURNING id",
      [own.id],
    )
  ).rows[0].id;
  return { own, target, anchor, worker, occurrence };
}
async function legalWork(f: any, day: string) {
  await admin.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [f.own.id, day.slice(0, 7) + "-01"],
  );
  const result = await manager.agent
    .post(`/api/estates/${f.own.id}/musters`)
    .set("Origin", origin)
    .set("X-CSRF-Token", manager.csrf)
    .set("Idempotency-Key", randomUUID())
    .send({
      occurrenceId: f.occurrence,
      businessDate: day,
      gangCode: "G-01",
      quantityHa: 0.1,
      workerIds: [f.worker],
    });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result;
}
test("responsibility timeline resolves boundary dates and preserves baseline legal ownership", async () => {
  const f = await legalFixture();
  const initial = await manager.agent.get(
    `/api/estates/${f.own.id}/responsibility`,
  );
  assert.equal(initial.status, 200);
  assert.equal(initial.body.revision, 0);
  assert.equal(initial.body.responsible.id, f.own.company_id);
  const created = await post(manager, `/estates/${f.own.id}/responsibility`, {
    companyId: f.target.id,
    effectiveFrom: "2100-01-10",
    revision: 0,
    reason: "Reviewed prospective responsibility",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.revision, 1);
  assert.equal(created.body.previous_company_id, f.own.company_id);
  assert.equal(created.body.request_id, created.headers["x-request-id"]);
  for (const [on, expected] of [
    ["2100-01-09", f.own.company_id],
    ["2100-01-10", f.target.id],
    ["2100-02-01", f.target.id],
  ]) {
    const view = await manager.agent
      .get(`/api/estates/${f.own.id}/responsibility`)
      .query({ on });
    assert.equal(view.body.responsible.id, expected);
    assert.equal(view.body.asOf, on);
  }
  assert.equal(
    (
      await admin.query("SELECT company_id FROM eoms.estates WHERE id=$1", [
        f.own.id,
      ])
    ).rows[0].company_id,
    f.own.company_id,
  );
  const evidence = (
    await admin.query(
      "SELECT actor_id,reason,request_id FROM eoms.estate_responsibilities WHERE id=$1",
      [created.body.id],
    )
  ).rows[0];
  assert.equal(evidence.actor_id, manager.id);
  assert.equal(evidence.reason, "Reviewed prospective responsibility");
});
test("new work captures immutable business-date attribution and existing future work blocks scheduling", async () => {
  const f = await legalFixture(),
    baselineWork = await legalWork(f, "2099-12-15");
  assert.equal(baselineWork.body.legal_company_id, f.own.company_id);
  assert.equal(baselineWork.body.legal_responsibility_id, null);
  const assignment = await post(
    manager,
    `/estates/${f.own.id}/responsibility`,
    {
      companyId: f.target.id,
      effectiveFrom: "2100-01-10",
      revision: 0,
      reason: "Future legal attribution",
    },
  );
  assert.equal(assignment.status, 201);
  const work = await legalWork(f, "2100-01-15");
  assert.equal(work.body.legal_company_id, f.target.id);
  assert.equal(work.body.legal_company_name, f.target.name);
  assert.equal(work.body.legal_responsibility_id, assignment.body.id);
  const blocked = await post(manager, `/estates/${f.own.id}/responsibility`, {
    companyId: f.own.company_id,
    effectiveFrom: "2100-01-12",
    revision: 1,
    reason: "Would rewrite recorded work",
  });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Work already exists/);
  const later = await post(manager, `/estates/${f.own.id}/responsibility`, {
    companyId: f.own.company_id,
    effectiveFrom: "2100-02-01",
    revision: 1,
    reason: "Later responsibility returns",
  });
  assert.equal(later.status, 201);
  await admin.query(
    "UPDATE eoms.companies SET name='Renamed company after capture' WHERE id=$1",
    [f.target.id],
  );
  const saved = (
    await manager.agent.get(`/api/estates/${f.own.id}/musters/${work.body.id}`)
  ).body;
  assert.equal(saved.legal_company_name, f.target.name);
  assert.equal(saved.legal_company_id, f.target.id);
  await assert.rejects(
    () =>
      admin.query("UPDATE eoms.musters SET legal_company_id=$2 WHERE id=$1", [
        work.body.id,
        f.own.company_id,
      ]),
    (e: any) => e.code === "23514",
  );
  const audit = (
    await admin.query(
      "SELECT detail FROM eoms.audit WHERE record_id=$1 AND action='muster.created'",
      [work.body.id],
    )
  ).rows[0].detail;
  assert.equal(audit.legalCompanyId, f.target.id);
  assert.equal(audit.legalResponsibilityId, assignment.body.id);
});
test("responsibility permissions and dated labels never grant sibling estate access", async () => {
  const f = await legalFixture();
  await admin.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [readonlyManager.id, f.own.id],
  );
  const payload = {
    companyId: f.target.id,
    effectiveFrom: "2100-01-10",
    revision: 0,
    reason: "Scoped legal responsibility",
  };
  assert.equal(
    (await request(app).get(`/api/estates/${f.own.id}/responsibility`)).status,
    401,
  );
  assert.equal(
    (
      await post(
        readonlyManager,
        `/estates/${f.own.id}/responsibility`,
        payload,
      )
    ).status,
    403,
  );
  assert.equal(
    (await post(manager, `/estates/${foreignEstate}/responsibility`, payload))
      .status,
    404,
  );
  const foreignCompany = (
    await admin.query("SELECT company_id FROM eoms.estates WHERE id=$1", [
      foreignEstate,
    ])
  ).rows[0].company_id;
  assert.equal(
    (
      await post(manager, `/estates/${f.own.id}/responsibility`, {
        ...payload,
        companyId: foreignCompany,
      })
    ).status,
    422,
  );
  assert.equal(
    (await post(manager, `/estates/${f.own.id}/responsibility`, payload))
      .status,
    201,
  );
  const view = await readonlyManager.agent
    .get(`/api/estates/${f.own.id}/responsibility`)
    .query({ on: "2100-01-10" });
  assert.equal(view.status, 200);
  assert.equal(view.body.canConfigure, false);
  assert.equal(view.body.responsible.id, f.target.id);
  assert.equal(view.body.items.length, 1);
  assert.equal(
    (await readonlyManager.agent.get(`/api/estates/${f.anchor.id}/units`))
      .status,
    404,
  );
  const org = (await readonlyManager.agent.get("/api/organization")).body;
  assert.ok(!org.items.some((row: any) => row.estate_id === f.anchor.id));
});
test("responsibility rejects stale duplicate backwards and direct unaudited changes", async () => {
  const f = await legalFixture(),
    path = `/estates/${f.own.id}/responsibility`,
    payload = {
      companyId: f.target.id,
      effectiveFrom: "2100-01-10",
      revision: 0,
      reason: "First legal schedule",
    };
  assert.equal(
    (await post(manager, path, { ...payload, effectiveFrom: "2000-01-01" }))
      .status,
    422,
  );
  assert.equal(
    (await post(manager, path, { ...payload, reason: "" })).status,
    422,
  );
  assert.equal((await post(manager, path, payload)).status, 201);
  assert.equal((await post(manager, path, payload)).status, 409);
  assert.equal(
    (
      await post(manager, path, {
        ...payload,
        revision: 1,
        companyId: f.own.company_id,
      })
    ).status,
    422,
  );
  for (const sql of [
    "UPDATE eoms.estate_responsibilities SET reason='rewrite'",
    "DELETE FROM eoms.estate_responsibilities",
  ]) {
    await assert.rejects(
      () => pool.query(sql),
      (e: any) => e.code === "42501",
    );
  }
  assert.equal(
    (await pool.query("SELECT * FROM eoms.estate_responsibilities")).rowCount,
    0,
  );
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [manager.id]);
    await assert.rejects(
      () =>
        c.query(
          "INSERT INTO eoms.estate_responsibilities(estate_id,customer_id,company_id,effective_from,revision,reason) VALUES($1,$2,$3,'2100-01-09',2,'Reject earlier schedule')",
          [f.own.id, customer, f.own.company_id],
        ),
      (e: any) => e.code === "23514",
    );
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});

let independentReviewer: any;
async function reviewerFor(id: string) {
  if (!independentReviewer) {
    const accounts = JSON.parse(
      await readFile(".local/test-accounts.json", "utf8"),
    );
    const account = accounts.find(
      (row: any) => row.email === "reviewer@eoms.local",
    );
    assert.ok(account, "Seed the explicit independent setup reviewer");
    independentReviewer = await login(account.email, account.password);
  }
  await admin.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager') ON CONFLICT DO NOTHING",
    [independentReviewer.id, id],
  );
  return independentReviewer;
}
async function scheduleForCancellation(f: any, date = "2100-01-10") {
  const saved = await post(manager, `/estates/${f.own.id}/responsibility`, {
    companyId: f.target.id,
    effectiveFrom: date,
    revision: 0,
    reason: "Schedule for governed review",
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  return saved.body;
}
async function cancellation(f: any, assignment: any) {
  const created = await post(
    manager,
    `/estates/${f.own.id}/responsibility/${assignment.id}/cancellation`,
    {
      revision: assignment.revision,
      reason: "Request cancellation after setup review",
    },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created;
}
function decide(
  actor: any,
  estate: string,
  request: string,
  revision: number,
  decision = "approved",
) {
  return post(
    actor,
    `/estates/${estate}/responsibility/requests/${request}/decision`,
    { revision, decision, reason: "Independent review decision" },
  );
}
test("cancellation requires independent review; rejection preserves schedule and approval preserves originals", async () => {
  const f = await legalFixture(),
    reviewer = await reviewerFor(f.own.id),
    assignment = await scheduleForCancellation(f),
    requested = await cancellation(f, assignment);
  assert.equal(
    (await decide(manager, f.own.id, requested.body.id, 1)).status,
    403,
  );
  const rejected = await decide(
    reviewer,
    f.own.id,
    requested.body.id,
    1,
    "rejected",
  );
  assert.equal(rejected.status, 201);
  assert.equal(
    (await decide(reviewer, f.own.id, requested.body.id, 1)).status,
    409,
  );
  let timeline = (
    await manager.agent
      .get(`/api/estates/${f.own.id}/responsibility`)
      .query({ on: "2100-01-10" })
  ).body;
  assert.equal(timeline.responsible.id, f.target.id);
  assert.equal(timeline.items[0].cancelled, false);
  const again = await cancellation(f, assignment),
    approved = await decide(reviewer, f.own.id, again.body.id, 1);
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  timeline = (
    await manager.agent
      .get(`/api/estates/${f.own.id}/responsibility`)
      .query({ on: "2100-01-10" })
  ).body;
  assert.equal(timeline.responsible.id, f.own.company_id);
  assert.equal(timeline.items[0].cancelled, true);
  assert.equal(timeline.items[0].id, assignment.id);
  assert.equal(timeline.requests.length, 2);
  const evidence = (
    await admin.query(
      "SELECT q.requester_id,q.request_id,d.reviewer_id,d.request_id AS decision_reference FROM eoms.responsibility_cancel_requests q JOIN eoms.responsibility_cancel_decisions d ON d.cancel_request_id=q.id WHERE q.id=$1",
      [again.body.id],
    )
  ).rows[0];
  assert.equal(evidence.requester_id, manager.id);
  assert.equal(evidence.reviewer_id, reviewer.id);
  assert.notEqual(evidence.requester_id, evidence.reviewer_id);
  assert.equal(evidence.request_id, again.headers["x-request-id"]);
  assert.equal(evidence.decision_reference, approved.headers["x-request-id"]);
  const captured = await legalWork(f, "2100-01-15");
  assert.equal(captured.body.legal_company_id, f.own.company_id);
  assert.equal(captured.body.legal_responsibility_id, null);
});
test("approved cancellation permits explicitly linked same-date replacement and preserves work attribution", async () => {
  const f = await legalFixture(),
    reviewer = await reviewerFor(f.own.id),
    original = await scheduleForCancellation(f),
    request = await cancellation(f, original);
  assert.equal(
    (await decide(reviewer, f.own.id, request.body.id, 1)).status,
    201,
  );
  const body = {
    companyId: f.target.id,
    effectiveFrom: "2100-01-10",
    revision: 1,
    reason: "Replace independently cancelled setup change",
  };
  assert.equal(
    (await post(manager, `/estates/${f.own.id}/responsibility`, body)).status,
    422,
  );
  assert.equal(
    (
      await post(manager, `/estates/${f.own.id}/responsibility`, {
        ...body,
        replacesId: randomUUID(),
      })
    ).status,
    422,
  );
  const replacement = await post(
    manager,
    `/estates/${f.own.id}/responsibility`,
    { ...body, replacesId: original.id },
  );
  assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
  assert.equal(replacement.body.revision, 2);
  const rows = (
    await admin.query(
      "SELECT id,replaces_responsibility_id FROM eoms.estate_responsibilities WHERE estate_id=$1 ORDER BY revision",
      [f.own.id],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, original.id);
  assert.equal(rows[1].replaces_responsibility_id, original.id);
  const captured = await legalWork(f, "2100-01-15");
  assert.equal(captured.body.legal_responsibility_id, replacement.body.id);
  assert.equal(captured.body.legal_company_id, f.target.id);
  assert.equal(
    (
      await post(
        manager,
        `/estates/${f.own.id}/responsibility/${replacement.body.id}/cancellation`,
        { revision: 2, reason: "Must protect replacement work" },
      )
    ).status,
    409,
  );
});
test("pending cancellation approval revalidates work dates revision and authorization", async () => {
  const f = await legalFixture(),
    reviewer = await reviewerFor(f.own.id),
    assignment = await scheduleForCancellation(f),
    request = await cancellation(f, assignment);
  assert.equal(
    (
      await post(
        manager,
        `/estates/${f.own.id}/responsibility/${assignment.id}/cancellation`,
        { revision: 1, reason: "Duplicate open request" },
      )
    ).status,
    409,
  );
  await legalWork(f, "2100-01-15");
  const blocked = await decide(reviewer, f.own.id, request.body.id, 1);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Work already exists/);
  assert.equal(
    (await decide(reviewer, f.own.id, request.body.id, 1, "rejected")).status,
    201,
  );
  assert.equal(
    (await decide(supervisor, f.own.id, request.body.id, 1)).status,
    404,
  );
  assert.equal(
    (await decide(reviewer, foreignEstate, request.body.id, 1)).status,
    404,
  );
  const other = await legalFixture(),
    otherReviewer = await reviewerFor(other.own.id),
    first = await scheduleForCancellation(other),
    pending = await cancellation(other, first);
  const next = await post(manager, `/estates/${other.own.id}/responsibility`, {
    companyId: other.own.company_id,
    effectiveFrom: "2100-02-01",
    revision: 1,
    reason: "Later schedule invalidates pending review",
  });
  assert.equal(next.status, 201);
  assert.equal(
    (await decide(otherReviewer, other.own.id, pending.body.id, 2)).status,
    409,
  );
  assert.equal(
    (await decide(otherReviewer, other.own.id, pending.body.id, 2, "rejected"))
      .status,
    201,
  );
  const todayFixture = await legalFixture(),
    today = (
      await manager.agent.get(
        `/api/estates/${todayFixture.own.id}/responsibility`,
      )
    ).body.today,
    current = await scheduleForCancellation(todayFixture, today);
  assert.equal(
    (
      await post(
        manager,
        `/estates/${todayFixture.own.id}/responsibility/${current.id}/cancellation`,
        { revision: 1, reason: "Already effective today" },
      )
    ).status,
    409,
  );
});
test("database cancellation guards enforce independent actor append-only history and same-date lineage", async () => {
  const f = await legalFixture(),
    reviewer = await reviewerFor(f.own.id),
    assignment = await scheduleForCancellation(f),
    request = await cancellation(f, assignment),
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [manager.id]);
    await assert.rejects(
      () =>
        c.query(
          "INSERT INTO eoms.responsibility_cancel_decisions(cancel_request_id,estate_id,customer_id,decision,reason) VALUES($1,$2,$3,'approved','Self approval is forbidden')",
          [request.body.id, f.own.id, customer],
        ),
      (e: any) => e.code === "42501",
    );
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
  assert.equal(
    (await decide(reviewer, f.own.id, request.body.id, 1)).status,
    201,
  );
  for (const table of [
    "responsibility_cancel_requests",
    "responsibility_cancel_decisions",
  ])
    for (const sql of [
      `DELETE FROM eoms.${table}`,
      `UPDATE eoms.${table} SET reason='rewrite'`,
    ])
      await assert.rejects(
        () => pool.query(sql),
        (e: any) => e.code === "42501",
      );
  assert.equal(
    (await pool.query("SELECT * FROM eoms.responsibility_cancel_requests"))
      .rowCount,
    0,
  );
  assert.equal(
    (await pool.query("SELECT * FROM eoms.active_estate_responsibilities"))
      .rowCount,
    0,
  );
  const direct = await pool.connect();
  try {
    await direct.query("BEGIN");
    await direct.query("SELECT set_config('app.user_id',$1,true)", [
      manager.id,
    ]);
    await assert.rejects(
      () =>
        direct.query(
          "INSERT INTO eoms.estate_responsibilities(estate_id,customer_id,company_id,effective_from,revision,reason) VALUES($1,$2,$3,'2100-01-10',2,'Missing lineage must fail')",
          [f.own.id, customer, f.target.id],
        ),
      (e: any) => e.code === "23514",
    );
  } finally {
    await direct.query("ROLLBACK");
    direct.release();
  }
});
