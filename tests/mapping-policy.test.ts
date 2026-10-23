import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
let f: Awaited<ReturnType<typeof upgradedWorkFixture>>,
  peer: Awaited<ReturnType<typeof independentSourceReviewer>>,
  p: any;
const content = {
  version: 1,
  basis: "mapping-policy-r0",
  scope: "design-review-only",
  custodyCriteria: "Controlled original with explicit archive lineage",
  approverCriteria: "Separately scoped independent named mapping approver",
  evidenceCriteria: "Every source and current concern explicitly resolved",
};
async function call(path = "", body?: any, raw?: string, estate?: string) {
  return fetch(
    f.apiURL +
      `/api/estates/${estate ?? f.estate}/reconciliation/policies` +
      path,
    {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: "eoms_session=" + (raw ?? f.raw),
        Origin: "http://localhost:5284",
        "X-CSRF-Token": "synthetic-history-ui",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}
const proposal = (expectedRevision = 0) => ({
  key: randomUUID(),
  expectedRevision,
  reason: "Propose explicit design criteria",
  content,
});
const review = (expectedRevision = 0) => ({
  key: randomUUID(),
  expectedRevision,
  policySha256: p.sha256,
  outcome: "changes-requested",
  reference: "Synthetic review meeting",
  reason: "Clarify custody responsibility before acceptance",
});
before(async () => {
  f = await upgradedWorkFixture({ setupAdmin: true });
  peer = await independentSourceReviewer(f);
});
after(async () => {
  await f?.close();
});
test("proposal saves canonical immutable content real actor request and digest without mutating historical facts; concurrent retries recover one version", async () => {
  const baseline = await f.snapshot(),
    input = proposal();
  const responses = await Promise.all([call("", input), call("", input)]);
  for (const r of responses) assert.equal(r.status, 200);
  const values = (await Promise.all(responses.map((r) => r.json()))) as any[];
  p = values[0].policy;
  assert.equal(values[1].policy.id, p.id);
  assert.equal(values.filter((v) => v.replayed).length, 1);
  assert.equal(p.revision, 1);
  assert.equal(p.actor_id, f.user);
  assert.match(p.request_id, /^[a-f0-9-]{36}$/);
  assert.equal(p.content.guardrails.length, 8);
  assert.equal(p.approval_enabled, false);
  assert.equal(p.application_enabled, false);
  const computed = (
    await f.root.query(
      "SELECT encode(public.digest(convert_to(content::text,'UTF8'),'sha256'),'hex') AS hash FROM eoms.mapping_policy_versions WHERE id=$1",
      [p.id],
    )
  ).rows[0].hash;
  assert.equal(p.sha256, computed);
  assert.equal(
    (await call("", { ...input, reason: "Different retry payload" })).status,
    409,
  );
  assert.equal((await call("", proposal())).status, 409);
  assert.equal(
    (
      await call("", {
        ...proposal(1),
        content: { ...content, applicationEnabled: true },
      })
    ).status,
    422,
  );
  assert.deepEqual(await f.snapshot(), baseline);
});
test("review requires independent scoped actor and exact version digest; retries and append-only corrections preserve audit", async () => {
  const input = review();
  assert.equal((await call("/" + p.id + "/reviews", input)).status, 403);
  assert.equal(
    (
      await call(
        "/" + p.id + "/reviews",
        { ...input, policySha256: "b".repeat(64) },
        peer.raw,
      )
    ).status,
    422,
  );
  const responses = await Promise.all([
    call("/" + p.id + "/reviews", input, peer.raw),
    call("/" + p.id + "/reviews", input, peer.raw),
  ]);
  for (const r of responses) assert.equal(r.status, 200);
  const a: any = await responses[0].json(),
    b: any = await responses[1].json();
  assert.equal(a.review.id, b.review.id);
  assert.equal(a.review.actor_id, peer.id);
  assert.equal(
    (
      await call(
        "/" + p.id + "/reviews",
        { ...input, reason: "Changed retry reason" },
        peer.raw,
      )
    ).status,
    409,
  );
  assert.equal(
    (await call("/" + p.id + "/reviews", review(), peer.raw)).status,
    409,
  );
  const r = await call(
    "/" + p.id + "/reviews",
    {
      ...review(1),
      outcome: "support-for-design",
      reason: "Support design with clarified custody reference",
    },
    peer.raw,
  );
  assert.equal(r.status, 200);
  const v: any = await r.json();
  assert.equal(v.review.previous_id, a.review.id);
  const list: any = await (await call("/" + p.id + "/reviews")).json();
  assert.equal(list.ownRevision, 0);
  assert.equal(list.canReview, false);
  assert.equal(list.items.length, 2);
  assert.equal(list.items.filter((v: any) => v.is_current).length, 1);
  assert.deepEqual(list.totals, [{ outcome: "support-for-design", count: 1 }]);
  const d: any = await (await call("/" + p.id)).json();
  assert.equal(d.approvalEnabled, false);
  assert.equal(d.applicationEnabled, false);
  await assert.rejects(
    f.root.query(
      "UPDATE eoms.mapping_policy_reviews SET reason='rewrite' WHERE id=$1",
      [a.review.id],
    ),
    /append only/,
  );
});
test("competing new proposals serialize and supersede without moving earlier reviews; old exact retries still recover", async () => {
  const one = proposal(1),
    two = {
      ...proposal(1),
      content: {
        ...content,
        custodyCriteria: "Revised controlled archive with named custodian",
      },
    };
  const responses = await Promise.all([call("", one), call("", two)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const win = responses[0].status === 200 ? one : two;
  const latest: any = await (await call("", win)).json();
  assert.equal(latest.replayed, true);
  assert.equal(latest.policy.previous_id, p.id);
  assert.equal(latest.policy.revision, 2);
  assert.equal(
    (await call("/" + p.id + "/reviews", review(2), peer.raw)).status,
    409,
  );
  const d: any = await (await call("/" + p.id)).json();
  assert.equal(d.isLatest, false);
  assert.equal(d.latest.id, latest.policy.id);
  const list: any = await (await call("?limit=1")).json();
  assert.equal(list.items.length, 1);
  assert.ok(list.nextCursor);
  const next: any = await (
    await call("?limit=1&cursor=" + list.nextCursor)
  ).json();
  assert.notEqual(next.items[0].id, list.items[0].id);
  assert.equal((await call("?limit=2&cursor=" + list.nextCursor)).status, 422);
  const baseline = await f.snapshot();
  await assert.rejects(
    f.root.query("DELETE FROM eoms.mapping_policy_versions WHERE id=$1", [
      p.id,
    ]),
    /append only/,
  );
  assert.deepEqual(await f.snapshot(), baseline);
});
test("foreign anonymous revoked clerk and direct SQL callers cannot bypass scoped policy functions or append-only tables", async () => {
  assert.equal(
    (await fetch(f.apiURL + `/api/estates/${f.estate}/reconciliation/policies`))
      .status,
    401,
  );
  assert.equal(
    (await call("/" + p.id, undefined, undefined, f.hidden)).status,
    403,
  );
  assert.equal((await call("/" + randomUUID())).status, 404);
  assert.equal((await call("?apply=true")).status, 422);
  const c = await f.runtime.connect();
  try {
    await c.query("BEGIN");
    assert.equal(
      (await c.query("SELECT * FROM eoms.mapping_policy_versions")).rowCount,
      0,
    );
    await assert.rejects(
      c.query(
        "SELECT eoms.propose_mapping_policy($1,$2,2,'{}'::jsonb,'unauthorized')",
        [f.estate, randomUUID()],
      ),
      /scope required/,
    );
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    await c.query("SELECT set_config('app.request_id',$1,true)", [
      randomUUID(),
    ]);
    await assert.rejects(
      c.query(
        "SELECT eoms.propose_mapping_policy($1,$2,2,$3,'direct forged policy')",
        [
          f.estate,
          randomUUID(),
          JSON.stringify({ ...content, guardrails: [] }),
        ],
      ),
      /Bounded design proposal/,
    );
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    await assert.rejects(
      c.query("INSERT INTO eoms.mapping_policy_versions DEFAULT VALUES"),
      /permission denied/,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, peer.id],
  );
  assert.equal(
    (await call("/" + p.id + "/reviews", review(2), peer.raw)).status,
    403,
  );
  // Recorded statements remain visible to authorized readers after reviewer revocation.
  assert.equal(
    ((await (await call("/" + p.id + "/reviews")).json()) as any).items.length,
    2,
  );
  await f.root.query(
    "UPDATE eoms.memberships SET role='clerk' WHERE estate_id=$1 AND user_id=$2",
    [f.estate, f.user],
  );
  assert.equal((await call()).status, 403);
  assert.equal((await call("", proposal(2))).status, 403);
});
