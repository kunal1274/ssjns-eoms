import "../apps/api/src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import {
  independentSourceReviewer,
  freshSyntheticSession,
} from "./source-review-fixture";
async function fixture(run: (x: any) => Promise<void>) {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const peer = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    await f.root.query("DELETE FROM eoms.memberships WHERE user_id=$1", [
      peer.id,
    ]);
    const division = f.company,
      block = randomUUID();
    await f.root.query(
      "INSERT INTO eoms.operating_units(id,customer_id,estate_id,kind,code,name) VALUES($1,$2,$3,'division','SCOPE-DIV','Synthetic scope division')",
      [division, f.customer, f.estate],
    );
    await f.root.query(
      "INSERT INTO eoms.operating_units(id,customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,$3,'block','SCOPE-BLOCK','Synthetic descendant block',$4)",
      [block, f.customer, f.estate, division],
    );
    const call = (path: string, body?: any, raw = f.raw) =>
        fetch(f.apiURL + "/api/" + path, {
          method: body ? "POST" : "GET",
          headers: {
            Cookie: "eoms_session=" + raw,
            Origin: "http://localhost:5284",
            "Content-Type": "application/json",
            "X-CSRF-Token": "synthetic-history-ui",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      path = "customers/" + f.customer + "/hierarchy-scopes";
    const input = (
      nodeKind = "unit",
      nodeId = division,
      inheritance = "none",
      expectedRevision = 0,
      action = "granted",
    ) => ({
      key: randomUUID(),
      subjectId: peer.id,
      nodeKind,
      nodeId,
      inheritance,
      expectedRevision,
      action,
      reference: "Synthetic explicit hierarchy visibility authority",
      reason: "Metadata-only scope without operational memberships",
    });
    const post = async (body: any) => {
      const r = await call(path, body);
      assert.equal(r.status, 200);
      return await r.json();
    };
    await run({ f, peer, division, block, call, path, input, post });
  } finally {
    await f.close();
  }
}
test("node-only and descendant assignments enforce metadata scope without upward sibling work or setup authority", async () =>
  fixture(async (x) => {
    assert.equal(
      (await x.call(x.path + "/read", undefined, x.peer.raw)).status,
      403,
    );
    await x.post(x.input());
    let r = await x.call(x.path + "/read", undefined, x.peer.raw);
    assert.equal(r.status, 200);
    let body: any = await r.json();
    assert.deepEqual(
      body.items.map((n: any) => n.id),
      [x.division],
    );
    assert.equal(body.workAccessGranted, false);
    assert.equal(
      (
        await x.call(
          "estates/" + x.f.estate + "/musters",
          undefined,
          x.peer.raw,
        )
      ).status,
      403,
    );
    assert.equal(
      (await x.call(x.path + "/nodes?nodeKind=unit", undefined, x.peer.raw))
        .status,
      403,
    );
    assert.equal((await x.call(x.path, undefined, x.peer.raw)).status, 403);
    await x.post(x.input("unit", x.division, "descendants", 1));
    body = await (await x.call(x.path + "/read", undefined, x.peer.raw)).json();
    assert.deepEqual(
      new Set(body.items.map((n: any) => n.id)),
      new Set([x.division, x.block]),
    );
    assert.equal(
      body.items.some((n: any) => n.kind === "estate"),
      false,
    );
    const contexts: any = await (
      await x.call("hierarchy-scopes/contexts", undefined, x.peer.raw)
    ).json();
    assert.equal(contexts.items[0].id, x.f.customer);
    assert.equal(
      (
        await x.f.root.query(
          "SELECT * FROM eoms.memberships WHERE user_id=$1",
          [x.peer.id],
        )
      ).rowCount,
      0,
    );
  }));
test("explicit company descendants include only matching customer graph and composite cursor preserves equal UUIDs across node kinds", async () =>
  fixture(async (x) => {
    await x.post(x.input("customer", x.f.customer, "descendants"));
    const pairs: string[] = [],
      query = x.path + "/read?limit=1";
    let cursor: string | null = null;
    do {
      const r: Response = await x.call(
        query + (cursor ? "&cursor=" + cursor : ""),
        undefined,
        x.peer.raw,
      );
      assert.equal(r.status, 200);
      const data: any = await r.json();
      pairs.push(...data.items.map((n: any) => n.kind + "/" + n.id));
      cursor = data.nextCursor;
    } while (cursor);
    assert.equal(new Set(pairs).size, pairs.length);
    assert.ok(pairs.includes("company/" + x.f.company));
    assert.ok(pairs.includes("unit/" + x.division));
    assert.ok(pairs.includes("estate/" + x.f.hidden));
    const first: any = await (
      await x.call(query, undefined, x.peer.raw)
    ).json();
    assert.equal(
      (
        await x.call(
          x.path + "/read?limit=2&cursor=" + first.nextCursor,
          undefined,
          x.peer.raw,
        )
      ).status,
      422,
    );
    assert.equal(
      (await x.call(query + "&cursor=" + first.nextCursor, undefined, x.f.raw))
        .status,
      403,
    );
    const literal: any = await (
      await x.call(x.path + "/read?q=%25_", undefined, x.peer.raw)
    ).json();
    assert.equal(literal.items.length, 0);
  }));
test("concurrent scope retries keep one immutable head and changed payload or foreign node cannot create access", async () =>
  fixture(async (x) => {
    const body = x.input(),
      rs = await Promise.all([x.call(x.path, body), x.call(x.path, body)]);
    assert.deepEqual(
      rs.map((r: any) => r.status),
      [200, 200],
    );
    const a: any = await rs[0].json(),
      b: any = await rs[1].json();
    assert.equal(a.grant.id, b.grant.id);
    assert.equal([a, b].filter((v) => v.replayed).length, 1);
    assert.equal(a.grant.actor_id, x.f.user);
    assert.match(a.grant.request_id, /^[a-f0-9-]{36}$/);
    assert.equal(
      (await x.call(x.path, { ...body, inheritance: "descendants" })).status,
      409,
    );
    assert.equal(
      (await x.call(x.path, { ...x.input(), nodeId: randomUUID() })).status,
      403,
    );
    assert.equal(
      (await x.call(x.path, { ...x.input(), permission: "work.read" })).status,
      422,
    );
    const history: any = await (
      await x.call(
        x.path +
          "?subjectId=" +
          x.peer.id +
          "&nodeKind=unit&nodeId=" +
          x.division,
      )
    ).json();
    assert.equal(history.head.id, a.grant.id);
    assert.equal(history.items.length, 1);
    await assert.rejects(
      () =>
        x.f.root.query(
          "UPDATE eoms.hierarchy_read_grants SET inheritance='descendants' WHERE id=$1",
          [a.grant.id],
        ),
      (e: any) => e.code === "23514",
    );
    await assert.rejects(
      () => x.f.runtime.query("SELECT * FROM eoms.hierarchy_scope_nodes"),
      (e: any) => e.code === "42501",
    );
  }));
test("revocation grantor setup restoration and subject activation restoration never resurrect stale inherited rights", async () =>
  fixture(async (x) => {
    await x.post(x.input("unit", x.division, "descendants"));
    await x.post(x.input("unit", x.division, "descendants", 1, "revoked"));
    assert.equal(
      (await x.call(x.path + "/read", undefined, x.peer.raw)).status,
      403,
    );
    await x.post(x.input("unit", x.division, "descendants", 2));
    await x.f.root.query(
      "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
      [x.f.customer, x.f.user],
    );
    assert.equal(
      (await x.call(x.path + "/read", undefined, x.peer.raw)).status,
      403,
    );
    await x.f.root.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [x.f.customer, x.f.user],
    );
    assert.equal(
      (await x.call(x.path + "/read", undefined, x.peer.raw)).status,
      403,
    );
    await x.post(x.input("unit", x.division, "descendants", 3));
    assert.equal(
      (await x.call(x.path + "/read", undefined, x.peer.raw)).status,
      200,
    );
    await x.f.root.query("UPDATE eoms.users SET active=false WHERE id=$1", [
      x.peer.id,
    ]);
    await x.f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
      x.peer.id,
    ]);
    assert.equal(
      (await x.call(x.path + "/read", undefined, x.peer.raw)).status,
      401,
    );
    x.peer.raw = await freshSyntheticSession(x.f, x.peer.id);
    assert.equal(
      (await x.call(x.path + "/read", undefined, x.peer.raw)).status,
      403,
    );
  }));
test("separate root assignments form an explicit union and revoking one preserves only the other named root", async () =>
  fixture(async (x) => {
    await x.post(x.input("unit", x.division, "descendants"));
    await x.post(x.input("estate", x.f.hidden, "none"));
    let b: any = await (
      await x.call(x.path + "/read", undefined, x.peer.raw)
    ).json();
    assert.equal(b.items.length, 3);
    await x.post(x.input("unit", x.division, "descendants", 1, "revoked"));
    b = await (await x.call(x.path + "/read", undefined, x.peer.raw)).json();
    assert.deepEqual(
      b.items.map((n: any) => n.id),
      [x.f.hidden],
    );
    assert.equal(
      (
        await x.call(
          "estates/" + x.f.hidden + "/musters",
          undefined,
          x.peer.raw,
        )
      ).status,
      403,
    );
    const privilege = (
      await x.f.runtime.query(
        "SELECT has_table_privilege(current_user,'eoms.hierarchy_read_grants','INSERT') AS ins",
      )
    ).rows[0];
    assert.equal(privilege.ins, false);
  }));
