import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
let f: Awaited<ReturnType<typeof upgradedWorkFixture>>,
  reviewer: Awaited<ReturnType<typeof independentSourceReviewer>>,
  job: any,
  match: any,
  mismatch: any,
  uploadedByReviewer: any,
  first: any,
  original: any;
const bytes = Buffer.from("controlled source revision A"),
  sha = createHash("sha256").update(bytes).digest("hex");
const input = (overrides: any = {}) => ({
  key: randomUUID(),
  expectedRevision: 0,
  outcome: "corroborated",
  originalExamined: true,
  sourceRef: "Controlled archive / original A",
  reason: "Examined original and independently checked custody",
  ...overrides,
});
async function call(
  path: string,
  body?: any,
  who?: string,
  estate?: string,
  headers: Record<string, string> = {},
) {
  return fetch(
    f.apiURL + `/api/estates/${estate ?? f.estate}/reconciliation/jobs` + path,
    {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: "eoms_session=" + (who ?? reviewer.raw),
        Origin: "http://localhost:5284",
        "X-CSRF-Token": "synthetic-history-ui",
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}
const path = (check = match) => `/${job.id}/evidence/${check.id}/reviews`;
before(async () => {
  f = await upgradedWorkFixture({ setupAdmin: true });
  reviewer = await independentSourceReviewer(f);
  const r = await call(
    "",
    {
      key: randomUUID(),
      reason: "Retain source proposal for independent observation",
      manifest: {
        version: 1,
        source: {
          system: "Synthetic source archive",
          documentRef: "Controlled original A",
          sha256: sha,
        },
        rows: [
          {
            sourceRow: "A:2",
            kind: "work-company",
            recordId: f.target,
            recordVersion: 1,
            targetId: f.company,
            reason: "Review legacy attribution proposal",
          },
        ],
      },
    },
    f.raw,
  );
  assert.equal(r.status, 200);
  job = ((await r.json()) as any).job;
  async function upload(raw: string, content: Buffer) {
    const r = await call(
      `/${job.id}/evidence`,
      {
        key: randomUUID(),
        fileName: "source-original.bin",
        reason: "Compare controlled source bytes",
        contentBase64: content.toString("base64"),
      },
      raw,
    );
    assert.equal(r.status, 200);
    return ((await r.json()) as any).check;
  }
  match = await upload(f.raw, bytes);
  mismatch = await upload(f.raw, Buffer.from("wrong file"));
  uploadedByReviewer = await upload(reviewer.raw, bytes);
  original = await f.snapshot();
});
after(async () => {
  await f?.close();
});
test("independent source observation blocks self-review mismatch corroboration and missing explicit original examination", async () => {
  const maker: any = await (await call(path(), undefined, f.raw)).json();
  assert.equal(maker.context.canRecord, false);
  assert.equal(maker.context.ownRevision, 0);
  assert.equal((await call(path(), input(), f.raw)).status, 403);
  assert.equal((await call(path(uploadedByReviewer), input())).status, 403);
  assert.equal((await call(path(mismatch), input())).status, 422);
  for (const bad of [
    input({ originalExamined: false }),
    input({ sourceRef: "x" }),
    input({ approved: true }),
    input({ outcome: "approved" }),
  ])
    assert.equal((await call(path(), bad)).status, 422);
  assert.equal(
    (await call(path(), input(), undefined, undefined, { Cookie: "" })).status,
    401,
  );
  assert.equal(
    (
      await call(path(), input(), undefined, undefined, {
        Origin: "https://wrong.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(path(), input(), undefined, undefined, {
        "X-CSRF-Token": "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(path(), undefined, undefined, f.hidden)).status,
    403,
  );
  assert.equal(
    (await call(`/${job.id}/evidence/${randomUUID()}/reviews`)).status,
    404,
  );
});
test("concurrent case-normalized review retries create one human observation without approval or historical mutation", async () => {
  const value = input(),
    responses = await Promise.all([
      call(path(), value),
      call(path(), { ...value, key: value.key.toUpperCase() }),
    ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const values: any[] = await Promise.all(responses.map((r) => r.json()));
  first = values[0].review;
  assert.equal(values[0].review.id, values[1].review.id);
  assert.equal(values.filter((v) => v.replayed).length, 1);
  assert.equal(first.revision, 1);
  assert.equal(first.previous_id, null);
  assert.equal(first.reviewer_id, reviewer.id);
  assert.equal(first.evidence_sha256, sha);
  assert.equal(first.manifest_sha256, job.manifest_sha256);
  assert.match(first.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(first.original_examined, true);
  assert.equal(first.outcome, "corroborated");
  for (const changed of [
    { reason: "Changed observation" },
    { sourceRef: "Another source ref" },
    { outcome: "concerns" },
    { expectedRevision: 1 },
  ])
    assert.equal((await call(path(), { ...value, ...changed })).status, 409);
  assert.deepEqual(((await (await call("/" + job.id)).json()) as any).job, job);
  assert.equal(
    (
      await f.root.query(
        "SELECT source_authenticity_verified FROM eoms.reconciliation_evidence_checks WHERE id=$1",
        [match.id],
      )
    ).rows[0].source_authenticity_verified,
    false,
  );
  assert.deepEqual(await f.snapshot(), original);
});
test("corrections append linked revisions and stale concurrent tabs cannot silently overwrite an independent observation", async () => {
  const a = input({
      expectedRevision: 1,
      outcome: "concerns",
      originalExamined: false,
      reason: "New concern about custody reference",
    }),
    b = input({
      expectedRevision: 1,
      outcome: "insufficient",
      originalExamined: false,
      reason: "Need additional original provenance",
    }),
    responses = await Promise.all([call(path(), a), call(path(), b)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const winner: any = await responses.find((r) => r.status === 200)!.json();
  assert.equal(winner.review.revision, 2);
  assert.equal(winner.review.previous_id, first.id);
  assert.equal(
    (await call(path(), input({ expectedRevision: 1 }))).status,
    409,
  );
  const replay: any = await (
    await call(path(), winner.review.outcome === "concerns" ? a : b)
  ).json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.review.id, winner.review.id);
  assert.equal(
    (await f.root.query("SELECT * FROM eoms.source_provenance_reviews"))
      .rowCount,
    2,
  );
  const firstPage: any = await (await call(path() + "?limit=1")).json();
  assert.equal(firstPage.context.ownRevision, 2);
  assert.ok(firstPage.nextCursor);
  const secondPage: any = await (
    await call(path() + "?limit=1&cursor=" + firstPage.nextCursor)
  ).json();
  const rows = [...firstPage.items, ...secondPage.items];
  assert.equal(rows.filter((r) => r.is_current).length, 1);
  assert.equal(rows.find((r) => r.id === first.id).is_current, false);
  assert.equal(
    (await call(path() + "?limit=2&cursor=" + firstPage.nextCursor)).status,
    422,
  );
  const concerns = await call(
    path(mismatch),
    input({
      outcome: "insufficient",
      originalExamined: false,
      reason: "Mismatch prevents any source corroboration",
    }),
  );
  assert.equal(concerns.status, 200);
});
test("provenance records enforce forced RLS narrow insertion immutable history and transaction request provenance", async () => {
  const c = await f.runtime.connect();
  try {
    await c.query("BEGIN");
    assert.equal(
      (await c.query("SELECT * FROM eoms.source_provenance_reviews")).rowCount,
      0,
    );
    await c.query("SELECT set_config('app.user_id',$1,true)", [reviewer.id]);
    assert.equal(
      (await c.query("SELECT * FROM eoms.source_provenance_reviews")).rowCount,
      3,
    );
    await assert.rejects(
      c.query(
        "SELECT eoms.record_source_review($1,$2,2,'concerns',false,'Archive A','Missing request provenance')",
        [match.id, randomUUID()],
      ),
      /provenance/,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  await assert.rejects(
    f.runtime.query(
      "INSERT INTO eoms.source_provenance_reviews(id) VALUES($1)",
      [randomUUID()],
    ),
    /permission denied/,
  );
  for (const sql of [
    "UPDATE eoms.source_provenance_reviews SET reason='Tampered'",
    "DELETE FROM eoms.source_provenance_reviews",
  ])
    await assert.rejects(f.root.query(sql), /append only/);
  const maker = await f.runtime.connect();
  try {
    await maker.query("BEGIN");
    await maker.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.request_id',$2,true)",
      [f.user, randomUUID()],
    );
    await assert.rejects(
      maker.query(
        "SELECT eoms.record_source_review($1,$2,0,'concerns',false,'Archive A','Self review attempt')",
        [match.id, randomUUID()],
      ),
      /Independent reviewer/,
    );
    await maker.query("ROLLBACK");
  } finally {
    maker.release();
  }
});
test("provenance reads corrections and recovered submissions recheck current setup role and estate membership", async () => {
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, reviewer.id],
  );
  assert.equal((await call(path())).status, 403);
  assert.equal(
    (await call(path(), input({ expectedRevision: 2 }))).status,
    403,
  );
  const c = await f.runtime.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.request_id',$2,true)",
      [reviewer.id, randomUUID()],
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.source_provenance_reviews")).rowCount,
      0,
    );
    await assert.rejects(
      c.query(
        "SELECT eoms.record_source_review($1,$2,2,'concerns',false,'Archive A','Revoked setup attempt')",
        [match.id, randomUUID()],
      ),
      /access required/,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  await f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [f.customer, reviewer.id],
  );
  await f.root.query(
    "UPDATE eoms.memberships SET role='clerk' WHERE estate_id=$1 AND user_id=$2",
    [f.estate, reviewer.id],
  );
  assert.equal((await call(path())).status, 403);
  await f.root.query(
    "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
    [f.estate, reviewer.id],
  );
  assert.equal((await call(path())).status, 403);
  assert.deepEqual(await f.snapshot(), original);
});
