import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
let f: Awaited<ReturnType<typeof upgradedWorkFixture>>, job: any, original: any;
const bytes = Buffer.from([0, 255, 1, 128, 10, 32, 65]),
  digest = createHash("sha256").update(bytes).digest("hex");
function payload(overrides: any = {}) {
  return {
    key: randomUUID(),
    fileName: "Controlled source.bin",
    reason: "Compare export against controlled source document",
    contentBase64: bytes.toString("base64"),
    ...overrides,
  };
}
async function call(
  path: string,
  body?: any,
  headers: Record<string, string> = {},
  estate?: string,
) {
  return fetch(
    f.apiURL + `/api/estates/${estate ?? f.estate}/reconciliation/jobs` + path,
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
  const r = await call("", {
    key: randomUUID(),
    reason: "Retain evidence comparison proposal",
    manifest: {
      version: 1,
      source: {
        system: "Synthetic legacy export",
        documentRef: "Controlled evidence reference",
        sha256: digest,
      },
      rows: [
        {
          sourceRow: "A:2",
          kind: "work-company",
          recordId: f.target,
          recordVersion: 1,
          targetId: f.company,
          reason: "Review original company attribution",
        },
      ],
    },
  });
  assert.equal(r.status, 200);
  job = ((await r.json()) as any).job;
  original = await f.snapshot();
});
after(async () => {
  await f?.close();
});
const path = () => `/${job.id}/evidence`;
test("source bytes are hashed by the database and mismatch match events are immutable without authenticating source or changing saved history", async () => {
  const mismatch = await call(
    path(),
    payload({
      contentBase64: Buffer.from("different source").toString("base64"),
    }),
  );
  assert.equal(mismatch.status, 200);
  const bad: any = await mismatch.json();
  assert.equal(bad.check.matches_declared, false);
  assert.notEqual(bad.check.computed_sha256, digest);
  const match = await call(path(), payload());
  assert.equal(match.status, 200);
  const good: any = await match.json();
  assert.equal(good.check.computed_sha256, digest);
  assert.equal(good.check.declared_sha256, digest);
  assert.equal(good.check.manifest_sha256, job.manifest_sha256);
  assert.equal(good.check.byte_length, bytes.length);
  assert.equal(good.check.actor_id, f.user);
  assert.match(good.check.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(good.check.source_authenticity_verified, false);
  assert.equal(good.check.action, "source-digest-checked");
  assert.ok(!("contentBase64" in good.check));
  const saved: any = await (await call("/" + job.id)).json();
  assert.deepEqual(saved.job, job);
  assert.equal(saved.audit.length, 1);
  assert.equal(saved.job.snapshot.sourceEvidenceVerified, false);
  assert.deepEqual(await f.snapshot(), original);
  const columns = (
    await f.root.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='eoms' AND table_name='reconciliation_evidence_checks'",
    )
  ).rows.map((x) => x.column_name);
  assert.ok(!columns.includes("content"));
  assert.ok(!columns.includes("content_base64"));
  for (const sql of [
    "UPDATE eoms.reconciliation_evidence_checks SET reason='Tampered'",
    "DELETE FROM eoms.reconciliation_evidence_checks",
  ])
    await assert.rejects(f.root.query(sql), /append only/);
});
test("concurrent case-normalized evidence retries create one event and changed bytes or metadata conflict", async () => {
  const input = payload(),
    responses = await Promise.all([
      call(path(), input),
      call(path(), { ...input, key: input.key.toUpperCase() }),
    ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const values: any[] = await Promise.all(responses.map((r) => r.json()));
  assert.equal(values[0].check.id, values[1].check.id);
  assert.equal(values.filter((v) => v.replayed).length, 1);
  for (const changed of [
    { reason: "Changed reason" },
    { fileName: "Another file.bin" },
    { contentBase64: Buffer.from("altered").toString("base64") },
  ])
    assert.equal((await call(path(), { ...input, ...changed })).status, 409);
  assert.equal(
    (await f.root.query("SELECT * FROM eoms.reconciliation_evidence_checks"))
      .rowCount,
    3,
  );
  const first: any = await (await call(path() + "?limit=1")).json();
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second: any = await (
    await call(path() + "?limit=1&cursor=" + first.nextCursor)
  ).json();
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal(
    (await call(path() + "?limit=2&cursor=" + first.nextCursor)).status,
    422,
  );
});
test("source upload remains bounded and rejects claimed outcomes malformed payloads missing jobs and origin csrf or session failures", async () => {
  const max = await call(
    path(),
    payload({
      contentBase64: Buffer.alloc(2 * 1024 * 1024, 0).toString("base64"),
    }),
  );
  assert.equal(max.status, 200);
  assert.equal(((await max.json()) as any).check.byte_length, 2097152);
  for (const bad of [
    payload({ contentBase64: "AB==" }),
    payload({ matches_declared: true }),
    payload({ source_authenticity_verified: true }),
    payload({ fileName: "../unsafe.pdf" }),
    payload({ contentBase64: Buffer.alloc(2097153).toString("base64") }),
  ])
    assert.equal((await call(path(), bad)).status, 422);
  assert.equal(
    (
      await call(
        path(),
        payload({ contentBase64: "A".repeat(3 * 1024 * 1024) }),
      )
    ).status,
    413,
  );
  assert.equal(
    (await call(`/${randomUUID()}/evidence`, payload())).status,
    404,
  );
  assert.equal((await call(path(), payload(), {}, f.hidden)).status, 403);
  assert.equal(
    (await call(path(), payload(), { Origin: "https://wrong.invalid" })).status,
    403,
  );
  assert.equal(
    (await call(path(), payload(), { "X-CSRF-Token": "bad" })).status,
    403,
  );
  assert.equal((await call(path(), payload(), { Cookie: "" })).status, 401);
});
test("evidence events enforce RLS and narrow insertion privileges and recheck setup role and membership after revocation", async () => {
  const c = await f.runtime.connect();
  try {
    await c.query("BEGIN");
    assert.equal(
      (await c.query("SELECT * FROM eoms.reconciliation_evidence_checks"))
        .rowCount,
      0,
    );
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    assert.equal(
      (await c.query("SELECT * FROM eoms.reconciliation_evidence_checks"))
        .rowCount,
      4,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  await assert.rejects(
    f.runtime.query(
      "INSERT INTO eoms.reconciliation_evidence_checks(id) VALUES($1)",
      [randomUUID()],
    ),
    /permission denied/,
  );
  const r = await f.runtime.connect();
  try {
    await r.query("BEGIN");
    await r.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    await assert.rejects(
      r.query(
        "SELECT eoms.check_reconciliation_source($1,$2,'source.bin','Missing server request',$3)",
        [job.id, randomUUID(), bytes],
      ),
      /provenance/,
    );
    await r.query("ROLLBACK");
  } finally {
    r.release();
  }
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, f.user],
  );
  assert.equal((await call(path())).status, 403);
  assert.equal((await call(path(), payload())).status, 403);
  const revoked = await f.runtime.connect();
  try {
    await revoked.query("BEGIN");
    await revoked.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    assert.equal(
      (await revoked.query("SELECT * FROM eoms.reconciliation_evidence_checks"))
        .rowCount,
      0,
    );
    await assert.rejects(
      revoked.query(
        "SELECT eoms.check_reconciliation_source($1,$2,'source.bin','Revoked actor check',$3)",
        [job.id, randomUUID(), bytes],
      ),
      /access required/,
    );
    await revoked.query("ROLLBACK");
  } finally {
    revoked.release();
  }
  await f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [f.customer, f.user],
  );
  await f.root.query(
    "UPDATE eoms.memberships SET role='clerk' WHERE estate_id=$1 AND user_id=$2",
    [f.estate, f.user],
  );
  assert.equal((await call(path())).status, 403);
  await f.root.query(
    "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
    [f.estate, f.user],
  );
  assert.equal((await call(path())).status, 403);
  assert.deepEqual(await f.snapshot(), original);
});
