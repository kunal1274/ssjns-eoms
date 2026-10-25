import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mappingWorkflowFixture } from "./mapping-workflow-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
let x: Awaited<ReturnType<typeof mappingWorkflowFixture>>,
  first: any,
  corrected: any;
const requestPath = (id: string) => "mapping-requests/" + id;
const state = async (id: string, raw?: string) =>
  (await (await x.call(requestPath(id), undefined, raw)).json()) as any;
before(async () => {
  x = await mappingWorkflowFixture();
  await x.f.root.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2026-01-01')",
    [x.f.estate],
  );
});
after(async () => {
  await x?.f.close();
});
test("fresh source context requires exact accepted policy clean rows and independent observations without writing business facts", async () => {
  const baseline = await x.f.snapshot(),
    r = await x.call(x.sourcePath + "/context");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const c: any = await r.json();
  assert.equal(c.binding.eligible, true);
  assert.equal(c.binding.records[0].currentVersion, 1);
  assert.equal(c.binding.observations[0].reviewerId, x.peer.id);
  assert.equal(c.acceptance.head.id, x.acceptance.id);
  assert.equal(c.applicationEnabled, false);
  assert.equal(c.ownAuthority.effective, false);
  assert.deepEqual(await x.f.snapshot(), baseline);
  assert.equal(
    (await x.call("mapping-authority", x.appointInput(x.f.user))).status,
    403,
  );
  assert.equal(
    (await x.call(x.sourcePath + "/context?force=true")).status,
    422,
  );
});
test("mismatched bytes adverse observations and changed reviewer scope block clean-row submissions without dropping revoked concerns", async () => {
  const mismatch = (
    await x.post(`jobs/${x.job.id}/evidence`, {
      key: randomUUID(),
      fileName: "other.bin",
      reason: "Actual mismatched source bytes",
      contentBase64: Buffer.from("different source").toString("base64"),
    })
  ).check;
  let path = `jobs/${x.job.id}/evidence/${mismatch.id}/mapping-requests`;
  let ctx: any = await (await x.call(path + "/context")).json();
  assert.equal(ctx.binding.records[0].valid, true);
  assert.equal(ctx.binding.sourceMatches, false);
  assert.equal(ctx.binding.eligible, false);
  assert.equal((await x.call(path, x.requestInput())).status, 422);
  const reviewer = await independentSourceReviewer(x.f);
  const check = (
    await x.post(`jobs/${x.job.id}/evidence`, {
      key: randomUUID(),
      fileName: "alternate-original.bin",
      reason: "Alternate actual matching check",
      contentBase64: x.bytes.toString("base64"),
    })
  ).check;
  const review = (outcome: string, expectedRevision = 0) =>
    x.post(
      `jobs/${x.job.id}/evidence/${check.id}/reviews`,
      {
        key: randomUUID(),
        expectedRevision,
        outcome,
        originalExamined: true,
        sourceRef: "Controlled alternate check",
        reason: "Actual independent alternate observation",
      },
      reviewer.raw,
    );
  await review("corroborated");
  path = `jobs/${x.job.id}/evidence/${check.id}/mapping-requests`;
  ctx = await (await x.call(path + "/context")).json();
  assert.equal(ctx.binding.eligible, true);
  await x.f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [x.f.customer, reviewer.id],
  );
  ctx = await (await x.call(path + "/context")).json();
  assert.equal(ctx.binding.observationTotals.authorizationChanged, 1);
  assert.equal(ctx.binding.eligible, false);
  assert.equal((await x.call(path, x.requestInput())).status, 422);
  await x.f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [x.f.customer, reviewer.id],
  );
  await review("concerns", 1);
  ctx = await (await x.call(path + "/context")).json();
  assert.equal(ctx.binding.observationTotals.concerns, 1);
  assert.equal((await x.call(path, x.requestInput())).status, 422);
  await x.f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [x.f.customer, reviewer.id],
  );
  ctx = await (await x.call(path + "/context")).json();
  assert.equal(ctx.binding.observationTotals.concerns, 1);
  assert.equal(ctx.binding.observationTotals.authorizationChanged, 1);
});
test("task links duplicate mapping rows and oversized version references stay outside overlay request eligibility", async () => {
  for (const rows of [
    [{ ...x.manifest.rows[0], kind: "task-block", recordId: x.f.task }],
    [x.manifest.rows[0], { ...x.manifest.rows[0] }],
    [{ ...x.manifest.rows[0], recordVersion: 2147483648 }],
  ]) {
    const job = (
      await x.post("jobs", {
        key: randomUUID(),
        reason: "Retain blocked proposal without applying",
        manifest: { ...x.manifest, rows },
      })
    ).job;
    const check = (
      await x.post(`jobs/${job.id}/evidence`, {
        key: randomUUID(),
        fileName: "blocked-original.bin",
        reason: "Compare actual bytes for blocked manifest",
        contentBase64: x.bytes.toString("base64"),
      })
    ).check;
    await x.post(
      `jobs/${job.id}/evidence/${check.id}/reviews`,
      {
        key: randomUUID(),
        expectedRevision: 0,
        outcome: "corroborated",
        originalExamined: true,
        sourceRef: "Controlled blocked proposal",
        reason: "Byte provenance does not resolve mapping issues",
      },
      x.peer.raw,
    );
    const path = `jobs/${job.id}/evidence/${check.id}/mapping-requests`,
      ctx: any = await (await x.call(path + "/context")).json();
    assert.equal(ctx.binding.eligible, false);
    assert.equal((await x.call(path, x.requestInput())).status, 422);
  }
  assert.equal(
    (
      await x.f.root.query(
        "SELECT block_unit_id FROM eoms.occurrences WHERE id=$1",
        [x.f.task],
      )
    ).rows[0].block_unit_id,
    null,
  );
});
test("concurrent request retries persist one exact immutable database-computed snapshot and actual actor custody audit", async () => {
  const baseline = await x.f.snapshot(),
    input = x.requestInput(),
    rs = await Promise.all([
      x.call(x.sourcePath, input),
      x.call(x.sourcePath, input),
    ]);
  for (const r of rs) assert.equal(r.status, 200);
  const a: any = await rs[0].json(),
    b: any = await rs[1].json();
  first = a.mappingRequest;
  assert.equal(first.id, b.mappingRequest.id);
  assert.equal(first.created_by, x.f.user);
  assert.match(first.request_id, /^[a-f0-9-]{36}$/);
  assert.equal(first.manifest_sha256, x.job.manifest_sha256);
  assert.equal(first.snapshot.records[0].recordId, x.f.target);
  assert.equal(first.snapshot.applicationEnabled, false);
  const hash = (
    await x.f.root.query(
      "SELECT encode(public.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex') AS hash FROM eoms.mapping_requests WHERE id=$1",
      [first.id],
    )
  ).rows[0].hash;
  assert.equal(first.snapshot_sha256, hash);
  assert.equal(
    (
      await x.call(x.sourcePath, {
        ...input,
        custodyRef: "Different custody retry",
      })
    ).status,
    409,
  );
  assert.deepEqual(await x.f.snapshot(), baseline);
  await assert.rejects(
    x.f.root.query("DELETE FROM eoms.mapping_requests WHERE id=$1", [first.id]),
    /append only/,
  );
});
test("ordinary managers requesters and all bound provenance reviewers cannot decide even when separately appointed", async () => {
  assert.equal(
    (await x.call(requestPath(first.id) + "/decisions", x.decisionInput()))
      .status,
    403,
  );
  const own = (
    await x.post("mapping-authority", x.appointInput(x.f.user), x.peer.raw)
  ).appointment;
  assert.equal(
    (
      await x.call(
        requestPath(first.id) + "/decisions",
        x.decisionInput("approved", 0, own.id),
      )
    ).status,
    403,
  );
  const reviewer = (
    await x.post("mapping-authority", x.appointInput(x.peer.id))
  ).appointment;
  assert.equal(
    (
      await x.call(
        requestPath(first.id) + "/decisions",
        x.decisionInput("approved", 0, reviewer.id),
        x.peer.raw,
      )
    ).status,
    403,
  );
  const d = await state(first.id, x.decider.raw);
  assert.equal(d.state.independent, true);
  assert.equal(d.ownAuthority.effective, true);
  assert.equal(d.state.bindingUnchanged, true);
});
test("changed observation identities reject stale approval then a returned request has one linked corrected submission and one idempotent approval", async () => {
  await x.observe("corroborated", 1);
  assert.equal((await state(first.id)).state.bindingUnchanged, false);
  assert.equal(
    (
      await x.call(
        requestPath(first.id) + "/decisions",
        x.decisionInput(),
        x.decider.raw,
      )
    ).status,
    409,
  );
  await x.post(
    requestPath(first.id) + "/decisions",
    x.decisionInput("returned"),
    x.decider.raw,
  );
  assert.equal(
    (
      await x.call(
        requestPath(first.id) + "/decisions",
        x.decisionInput("approved", 1),
        x.decider.raw,
      )
    ).status,
    422,
  );
  assert.equal(
    (await x.call(x.sourcePath, x.requestInput(first.id), x.decider.raw))
      .status,
    403,
  );
  const input = x.requestInput(first.id);
  corrected = (await x.post(x.sourcePath, input)).mappingRequest;
  assert.equal(corrected.previous_id, first.id);
  assert.equal(corrected.snapshot.observations[0].revision, 2);
  assert.equal(
    (await x.call(x.sourcePath, x.requestInput(first.id))).status,
    409,
  );
  assert.equal(
    (await x.post(x.sourcePath, input)).mappingRequest.id,
    corrected.id,
  );
  const decision = x.decisionInput(),
    rs = await Promise.all([
      x.call(requestPath(corrected.id) + "/decisions", decision, x.decider.raw),
      x.call(requestPath(corrected.id) + "/decisions", decision, x.decider.raw),
    ]);
  for (const r of rs) assert.equal(r.status, 200);
  const a: any = await rs[0].json(),
    b: any = await rs[1].json();
  assert.equal(a.decision.id, b.decision.id);
  assert.equal(a.decision.actor_id, x.decider.id);
  assert.equal((await state(corrected.id)).state.approvalCurrent, true);
  assert.equal((await state(corrected.id)).applicationEnabled, false);
  assert.equal(
    (
      await x.call(
        requestPath(corrected.id) + "/decisions",
        { ...decision, reason: "Changed retry" },
        x.decider.raw,
      )
    ).status,
    409,
  );
});
test("revoked and restored decision authority cannot revive approval and exact receipts recover without new decisions", async () => {
  const original = (await (
      await x.call(requestPath(corrected.id) + "/decisions")
    ).json()) as any,
    record = original.items[0];
  await x.f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [x.f.customer, x.decider.id],
  );
  assert.equal((await state(corrected.id)).state.approvalCurrent, false);
  await x.f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [x.f.customer, x.decider.id],
  );
  assert.equal((await state(corrected.id)).state.approvalCurrent, false);
  const renewed = (
    await x.post("mapping-authority", x.appointInput(x.decider.id, 1))
  ).appointment;
  assert.equal((await state(corrected.id)).state.approvalCurrent, false);
  const withdrawal = await x.post(
    requestPath(corrected.id) + "/decisions",
    x.decisionInput("withdrawn", 1, renewed.id),
    x.decider.raw,
  );
  assert.equal(withdrawal.decision.previous_id, record.id);
  assert.equal((await state(corrected.id)).state.head.outcome, "withdrawn");
  await assert.rejects(
    x.f.root.query(
      "UPDATE eoms.mapping_decisions SET reason='rewrite' WHERE id=$1",
      [record.id],
    ),
    /append only/,
  );
  // A new request can use fresh scope, but a real guarded work review must invalidate its record-version binding.
  const next = (await x.post(x.sourcePath, x.requestInput(corrected.id)))
    .mappingRequest;
  const r = await fetch(
    x.f.apiURL + `/api/estates/${x.f.estate}/musters/${x.f.target}/approve`,
    {
      method: "POST",
      headers: {
        Cookie: "eoms_session=" + x.f.raw,
        Origin: "http://localhost:5284",
        "X-CSRF-Token": "synthetic-history-ui",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        reason: "Separate guarded operational review to test record drift",
      }),
    },
  );
  assert.equal(r.status, 200);
  assert.equal((await state(next.id)).state.bindingUnchanged, false);
  assert.equal((await state(next.id)).state.current.records[0].valid, false);
  assert.equal(
    (
      await x.call(
        requestPath(next.id) + "/decisions",
        x.decisionInput("approved", 0, renewed.id),
        x.decider.raw,
      )
    ).status,
    409,
  );
  const rejected = await x.post(
    requestPath(next.id) + "/decisions",
    x.decisionInput("rejected", 0, renewed.id),
    x.decider.raw,
  );
  assert.equal(rejected.decision.outcome, "rejected");
  assert.equal(
    (await x.call(x.sourcePath, x.requestInput(next.id))).status,
    422,
  );
});
test("tenant scope strict parsing internal helper grants and append-only runtime privileges remain enforced", async () => {
  assert.equal(
    (await x.call(x.sourcePath + "/context", undefined, undefined, x.f.hidden))
      .status,
    403,
  );
  assert.equal((await x.call(requestPath(randomUUID()))).status, 404);
  assert.equal(
    (await x.call(requestPath(first.id) + "?apply=true")).status,
    422,
  );
  assert.equal(
    (
      await fetch(
        x.f.apiURL +
          `/api/estates/${x.f.estate}/reconciliation/` +
          requestPath(first.id),
      )
    ).status,
    401,
  );
  const c = await x.f.runtime.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [x.f.user]);
    await assert.rejects(
      c.query("SELECT eoms.mapping_binding($1,$2,$3,true)", [
        x.check.id,
        x.policy.id,
        x.acceptance.id,
      ]),
      /permission denied/,
    );
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [x.f.user]);
    await assert.rejects(
      c.query("INSERT INTO eoms.mapping_requests DEFAULT VALUES"),
      /permission denied/,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  await x.f.root.query(
    "UPDATE eoms.memberships SET role='clerk' WHERE estate_id=$1 AND user_id=$2",
    [x.f.estate, x.f.user],
  );
  assert.equal((await x.call(x.sourcePath + "/context")).status, 403);
  assert.equal((await x.call(requestPath(first.id))).status, 403);
  assert.equal((await x.call("mapping-authority")).status, 403);
});
