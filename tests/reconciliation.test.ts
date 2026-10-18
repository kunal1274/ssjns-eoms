import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
let f: Awaited<ReturnType<typeof upgradedWorkFixture>>,
  block: string,
  division: string,
  foreign: string;
const manifest = (rows: any[]) => ({
  version: 1,
  source: {
    system: "Legacy source export",
    documentRef: "Synthetic evidence document / sheet A",
    sha256: "a".repeat(64),
  },
  rows,
});
function row(kind = "task-block", overrides: any = {}) {
  return {
    sourceRow: randomUUID(),
    kind,
    recordId: kind === "task-block" ? f.task : f.target,
    recordVersion: 1,
    targetId: kind === "task-block" ? block : f.company,
    reason: "Reviewed source evidence reference",
    ...overrides,
  };
}
async function post(
  value: any,
  headers: Record<string, string> = {},
  estate?: string,
) {
  return fetch(
    f.apiURL + `/api/estates/${estate || f.estate}/reconciliation/preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5284",
        Cookie: "eoms_session=" + f.raw,
        "X-CSRF-Token": "synthetic-history-ui",
        ...headers,
      },
      body: JSON.stringify(value),
    },
  );
}
before(async () => {
  f = await upgradedWorkFixture({ setupAdmin: true });
  division = (
    await f.root.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) VALUES($1,$2,'division','PREVIEW-D','Preview division') RETURNING id",
      [f.customer, f.estate],
    )
  ).rows[0].id;
  block = (
    await f.root.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,'block','OLD-BLOCK','Reviewed configured block',$3) RETURNING id",
      [f.customer, f.estate, division],
    )
  ).rows[0].id;
  foreign = (
    await f.root.query(
      "WITH t AS (INSERT INTO eoms.customers(code,name) VALUES($1,'Foreign preview customer') RETURNING id) INSERT INTO eoms.companies(customer_id,name) SELECT id,'Hidden foreign proposal company' FROM t RETURNING id",
      ["F-" + randomUUID()],
    )
  ).rows[0].id;
});
after(async () => {
  await f?.close();
});
test("source preview classifies scoped historical mappings duplicates stale and unavailable targets without changing business records", async () => {
  const before = await f.snapshot(),
    modern = before.work.find((r) => r.legal_company_id !== null);
  const input = manifest([
    row(),
    row("work-company"),
    row("work-company", { targetId: foreign }),
    row("work-company", { recordVersion: 99 }),
    row("work-company", { recordId: modern.id }),
    row("task-block", { recordId: randomUUID(), targetId: division }),
  ]);
  // Separate proposals for the same record all block, even if one looks valid.
  const r = await post(input);
  assert.equal(r.status, 200);
  const v: any = await r.json();
  assert.equal(v.applied, false);
  assert.equal(v.sourceEvidenceVerified, false);
  assert.equal(v.summary.blocked, 5);
  assert.ok(v.rows[1].issues.some((i: any) => i.code === "DUPLICATE_RECORD"));
  assert.equal(v.rows[2].target, null);
  assert.ok(v.rows[3].issues.some((i: any) => i.code === "STALE_VERSION"));
  assert.ok(v.rows[4].issues.some((i: any) => i.code === "ALREADY_RECORDED"));
  assert.ok(v.rows[5].issues.some((i: any) => i.code === "BLOCK_REQUIRED"));
  assert.doesNotMatch(JSON.stringify(v), /Hidden foreign proposal company/);
  const clean = manifest([row(), row("work-company")]),
    one: any = await (await post(clean)).json(),
    two: any = await (await post(clean)).json();
  assert.equal(one.summary.reviewRequired, 2);
  assert.equal(one.summary.blocked, 0);
  assert.equal(one.manifestSha256, two.manifestSha256);
  assert.notEqual(one.requestId, two.requestId);
  assert.equal(one.actorId, f.user);
  assert.equal(one.rows[1].current.recorded_target, null);
  assert.equal(one.rows[1].target.id, f.company);
  assert.match(one.rows[1].action, /remains unchanged/);
  assert.deepEqual(await f.snapshot(), before);
  assert.equal(
    (
      await f.root.query(
        "SELECT block_unit_id FROM eoms.occurrences WHERE id=$1",
        [f.task],
      )
    ).rows[0].block_unit_id,
    null,
  );
});
test("preview rejects malformed manifests and preserves origin csrf anonymous and inactive or wrong-code safeguards", async () => {
  const value = manifest([row()]);
  for (const bad of [
    { ...value, version: 2 },
    { ...value, source: { ...value.source, sha256: "bad" } },
    { ...value, rows: [] },
    { ...value, rows: Array.from({ length: 51 }, () => row()) },
    { ...value, apply: true },
  ])
    assert.equal((await post(bad)).status, 422);
  assert.equal(
    (await post(value, { Origin: "https://untrusted.invalid" })).status,
    403,
  );
  assert.equal((await post(value, { "X-CSRF-Token": "invalid" })).status, 403);
  assert.equal((await post(value, { Cookie: "" })).status, 401);
  assert.equal((await post(value, {}, f.hidden)).status, 403);
  const wrong = (
    await f.root.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,'block','OTHER-CODE','Other code',$3) RETURNING id",
      [f.customer, f.estate, division],
    )
  ).rows[0].id;
  const mismatch: any = await (
    await post(manifest([row("task-block", { targetId: wrong })]))
  ).json();
  assert.ok(
    mismatch.rows[0].issues.some((i: any) => i.code === "CODE_MISMATCH"),
  );
  const pause = await fetch(
    f.apiURL + `/api/estates/${f.estate}/units/${block}/lifecycle`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5284",
        Cookie: "eoms_session=" + f.raw,
        "X-CSRF-Token": "synthetic-history-ui",
      },
      body: JSON.stringify({
        active: false,
        version: 1,
        reason: "Synthetic preview lifecycle check",
      }),
    },
  );
  assert.equal(pause.status, 200, await pause.text());
  const paused: any = await (await post(value)).json();
  assert.ok(paused.rows[0].issues.some((i: any) => i.code === "INACTIVE_PATH"));
});
test("preview rechecks setup authority membership and role on every request without retaining approval authority", async () => {
  const value = manifest([row("work-company")]);
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, f.user],
  );
  assert.equal((await post(value)).status, 403);
  const context = await fetch(
    f.apiURL + `/api/estates/${f.estate}/reconciliation/context`,
    { headers: { Cookie: "eoms_session=" + f.raw } },
  );
  assert.equal(((await context.json()) as any).canPreview, false);
  await f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [f.customer, f.user],
  );
  await f.root.query(
    "UPDATE eoms.memberships SET role='clerk' WHERE user_id=$1 AND estate_id=$2",
    [f.user, f.estate],
  );
  assert.equal((await post(value)).status, 403);
  await f.root.query(
    "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
    [f.user, f.estate],
  );
  assert.equal((await post(value)).status, 403);
});
