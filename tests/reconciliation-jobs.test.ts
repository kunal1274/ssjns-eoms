import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
let f: Awaited<ReturnType<typeof upgradedWorkFixture>>,
  saved: any,
  block: string;
const input = () => ({
  key: randomUUID(),
  reason: "Retain source proposal for governed review",
  manifest: {
    version: 1,
    source: {
      system: "Synthetic source",
      documentRef: "Original evidence still unverified",
      sha256: "b".repeat(64),
    },
    rows: [
      {
        sourceRow: "A:2",
        kind: "task-block",
        recordId: f.task,
        recordVersion: 1,
        targetId: block,
        reason: "Source referenced exact block",
      },
    ],
  },
});
async function call(
  path = "",
  body?: any,
  headers: Record<string, string> = {},
  estate?: string,
) {
  return fetch(
    f.apiURL + `/api/estates/${estate ?? f.estate}/reconciliation` + path,
    {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: "eoms_session=" + f.raw,
        Origin: "http://localhost:5284",
        "X-CSRF-Token": "synthetic-history-ui",
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}
before(async () => {
  f = await upgradedWorkFixture({ setupAdmin: true });
  const division = (
    await f.root.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) VALUES($1,$2,'division','JOB-D','Review division') RETURNING id",
      [f.customer, f.estate],
    )
  ).rows[0].id;
  block = (
    await f.root.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,'block','OLD-BLOCK','Review block',$3) RETURNING id",
      [f.customer, f.estate, division],
    )
  ).rows[0].id;
});
after(async () => {
  await f?.close();
});
test("concurrent review save and retry commit exactly one immutable job and real audit event without business changes", async () => {
  const before = await f.snapshot(),
    v = input(),
    responses = await Promise.all([
      call("/jobs", v),
      call("/jobs", { ...v, key: v.key.toUpperCase() }),
    ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const values: any[] = await Promise.all(responses.map((r) => r.json()));
  saved = values[0].job;
  assert.equal(values[0].job.id, values[1].job.id);
  assert.equal(values.filter((x) => x.replayed).length, 1);
  assert.equal(saved.snapshot.summary.reviewRequired, 1);
  assert.equal(saved.snapshot.applied, false);
  assert.equal(saved.snapshot.sourceEvidenceVerified, false);
  const detail: any = await (await call("/jobs/" + saved.id)).json();
  assert.equal(detail.audit.length, 1);
  assert.equal(detail.audit[0].action, "review-saved");
  assert.equal(detail.audit[0].actor_id, f.user);
  assert.equal(detail.audit[0].request_id, saved.request_id);
  assert.equal(detail.audit[0].manifest_sha256, saved.manifest_sha256);
  assert.equal(detail.audit[0].reason, v.reason);
  assert.equal(
    (await call("/jobs", { ...v, reason: "Different retry payload" })).status,
    409,
  );
  assert.deepEqual(await f.snapshot(), before);
});
test("save revalidates current lifecycle rather than trusting a previous browser preview and validates write protections", async () => {
  const value = input(),
    preview: any = await (await call("/preview", value.manifest)).json();
  assert.equal(preview.summary.blocked, 0);
  const pause = await fetch(
    f.apiURL + `/api/estates/${f.estate}/units/${block}/lifecycle`,
    {
      method: "POST",
      headers: {
        Cookie: "eoms_session=" + f.raw,
        Origin: "http://localhost:5284",
        "X-CSRF-Token": "synthetic-history-ui",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        active: false,
        version: 1,
        reason: "Pause before review save",
      }),
    },
  );
  assert.equal(pause.status, 200);
  const r = await call("/jobs", value);
  assert.equal(r.status, 200);
  const v: any = await r.json();
  assert.equal(v.job.snapshot.summary.blocked, 1);
  assert.ok(
    v.job.snapshot.rows[0].issues.some((x: any) => x.code === "INACTIVE_PATH"),
  );
  assert.notEqual(v.job.snapshot.requestId, preview.requestId);
  for (const bad of [
    { ...value, reason: "x" },
    { ...value, apply: true },
    { ...value, key: "invalid" },
    { ...value, snapshot: preview },
  ])
    assert.equal((await call("/jobs", bad)).status, 422);
  assert.equal(
    (await call("/jobs", input(), { Origin: "https://wrong.invalid" })).status,
    403,
  );
  assert.equal(
    (await call("/jobs", input(), { "X-CSRF-Token": "bad" })).status,
    403,
  );
  assert.equal((await call("/jobs", input(), { Cookie: "" })).status, 401);
});
test("saved jobs paginate with scoped cursors and enforce append-only runtime audit and actor provenance", async () => {
  const first: any = await (await call("/jobs?limit=1")).json();
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second: any = await (
    await call("/jobs?limit=1&cursor=" + first.nextCursor)
  ).json();
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal(
    (await call("/jobs?limit=2&cursor=" + first.nextCursor)).status,
    422,
  );
  assert.equal(
    (await call("/jobs/" + saved.id, undefined, {}, f.hidden)).status,
    403,
  );
  assert.equal((await call("/jobs/" + randomUUID())).status, 404);
  const c = await f.runtime.connect();
  try {
    await c.query("BEGIN");
    assert.equal(
      (await c.query("SELECT * FROM eoms.reconciliation_jobs")).rowCount,
      0,
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.reconciliation_job_history")).rowCount,
      0,
    );
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    assert.equal(
      (await c.query("SELECT * FROM eoms.reconciliation_jobs")).rowCount,
      2,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  for (const sql of [
    "UPDATE eoms.reconciliation_jobs SET reason='Tampered'",
    "DELETE FROM eoms.reconciliation_jobs",
    "UPDATE eoms.reconciliation_job_history SET reason='Tampered'",
    "DELETE FROM eoms.reconciliation_job_history",
  ])
    await assert.rejects(f.runtime.query(sql));
  await assert.rejects(
    f.root.query("UPDATE eoms.reconciliation_jobs SET reason='Tampered'"),
    /append only/,
  );
  await assert.rejects(
    f.root.query(
      "UPDATE eoms.reconciliation_job_history SET reason='Tampered'",
    ),
    /append only/,
  );
  const root = await f.root.connect();
  try {
    await root.query("BEGIN");
    await root.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    await assert.rejects(
      root.query(
        "INSERT INTO eoms.reconciliation_jobs(estate_id,created_by,retry_key,reason,manifest,manifest_sha256,snapshot,request_id) SELECT estate_id,created_by,$1,reason,manifest,manifest_sha256,snapshot,$2 FROM eoms.reconciliation_jobs WHERE id=$3",
        [randomUUID(), randomUUID(), saved.id],
      ),
      /provenance/,
    );
    await root.query("ROLLBACK");
  } finally {
    root.release();
  }
  assert.equal(
    (await f.root.query("SELECT * FROM eoms.reconciliation_job_history"))
      .rowCount,
    2,
  );
});
test("saved manifest and audit reads and retries recheck setup membership and manager scope", async () => {
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, f.user],
  );
  for (const path of ["/jobs", "/jobs/" + saved.id])
    assert.equal((await call(path)).status, 403);
  assert.equal((await call("/jobs", input())).status, 403);
  const c = await f.runtime.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    assert.equal(
      (await c.query("SELECT * FROM eoms.reconciliation_jobs")).rowCount,
      0,
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.reconciliation_job_history")).rowCount,
      0,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  await f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [f.customer, f.user],
  );
  await f.root.query(
    "UPDATE eoms.memberships SET role='clerk' WHERE estate_id=$1 AND user_id=$2",
    [f.estate, f.user],
  );
  assert.equal((await call("/jobs/" + saved.id)).status, 403);
  await f.root.query(
    "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
    [f.estate, f.user],
  );
  assert.equal((await call("/jobs")).status, 403);
});
