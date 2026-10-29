import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
let f: Awaited<ReturnType<typeof upgradedWorkFixture>>,
  peer: Awaited<ReturnType<typeof independentSourceReviewer>>,
  other: typeof peer,
  job: any,
  match: any,
  mismatch: any;
const bytes = Buffer.from("controlled readiness original"),
  sha = createHash("sha256").update(bytes).digest("hex");
async function call(path: string, body?: any, raw?: string, estate?: string) {
  return fetch(
    f.apiURL + `/api/estates/${estate ?? f.estate}/reconciliation/jobs` + path,
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
const path = (check = match) => `/${job.id}/evidence/${check.id}/readiness`;
async function observe(person: typeof peer, outcome: string, revision = 0) {
  const r = await call(
    `/${job.id}/evidence/${match.id}/reviews`,
    {
      key: randomUUID(),
      expectedRevision: revision,
      outcome,
      originalExamined: outcome === "corroborated",
      sourceRef: "Controlled archive / original",
      reason: "Independent readiness observation: " + outcome,
    },
    person.raw,
  );
  assert.equal(r.status, 200);
  return ((await r.json()) as any).review;
}
before(async () => {
  f = await upgradedWorkFixture({ setupAdmin: true });
  await f.root.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2026-01-01')",
    [f.estate],
  );
  peer = await independentSourceReviewer(f);
  other = await independentSourceReviewer(f);
  const r = await call("", {
    key: randomUUID(),
    reason: "Save proposal for readiness inspection",
    manifest: {
      version: 1,
      source: {
        system: "Synthetic controlled source",
        documentRef: "Readiness original reference",
        sha256: sha,
      },
      rows: [
        {
          sourceRow: "A:2",
          kind: "work-company",
          recordId: f.target,
          recordVersion: 1,
          targetId: f.company,
          reason: "Inspect unchanged legacy facts",
        },
      ],
    },
  });
  assert.equal(r.status, 200);
  job = ((await r.json()) as any).job;
  async function upload(content: Buffer) {
    const r = await call(`/${job.id}/evidence`, {
      key: randomUUID(),
      fileName: "readiness-original.bin",
      reason: "Check bytes before readiness inspection",
      contentBase64: content.toString("base64"),
    });
    assert.equal(r.status, 200);
    return ((await r.json()) as any).check;
  }
  match = await upload(bytes);
  mismatch = await upload(Buffer.from("other source"));
});
after(async () => {
  await f?.close();
});
test("fresh readiness binds the selected source job and manifest without writing business records or inventing an approval audit", async () => {
  const before = await f.snapshot(),
    r = await call(path());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const v: any = await r.json();
  assert.equal(v.jobId, job.id);
  assert.equal(v.checkId, match.id);
  assert.equal(v.manifestSha256, job.manifest_sha256);
  assert.equal(v.current.summary.blocked, 0);
  assert.equal(v.observations.total, 0);
  assert.equal(v.approvalEnabled, false);
  assert.equal(v.applicationEnabled, false);
  assert.equal(v.applied, false);
  assert.equal(v.sourceAuthenticityVerified, false);
  assert.equal(v.transactionalRevalidationRequired, true);
  assert.equal(v.changedRows.length, 0);
  assert.equal(v.policy.status, "draft-not-approved");
  assert.ok(v.findings.some((x: any) => x.code === "NO_OBSERVATIONS"));
  assert.deepEqual(await f.snapshot(), before);
  assert.equal(
    (await f.root.query("SELECT * FROM eoms.reconciliation_job_history"))
      .rowCount,
    1,
  );
  assert.equal(
    (await f.root.query("SELECT * FROM eoms.source_provenance_reviews"))
      .rowCount,
    0,
  );
  const wrong: any = await (await call(path(mismatch))).json();
  assert.equal(wrong.evidence.matches_declared, false);
  assert.ok(wrong.findings.some((x: any) => x.code === "SOURCE_MISMATCH"));
  assert.equal((await call(path() + "?apply=true")).status, 422);
  assert.equal((await call(path(), { apply: true })).status, 404);
});
test("readiness detects actual record-version drift after a separately guarded work review while saved history remains immutable", async () => {
  const r = await fetch(
    f.apiURL + `/api/estates/${f.estate}/musters/${f.target}/approve`,
    {
      method: "POST",
      headers: {
        Cookie: "eoms_session=" + f.raw,
        Origin: "http://localhost:5284",
        "X-CSRF-Token": "synthetic-history-ui",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        reason: "Separate operational review before readiness refresh",
      }),
    },
  );
  assert.equal(r.status, 200);
  const before = await f.snapshot(),
    v: any = await (await call(path())).json();
  assert.equal(v.changedRows.length, 1);
  assert.equal(v.current.rows[0].current.version, 2);
  assert.ok(
    v.current.rows[0].issues.some((x: any) => x.code === "STALE_VERSION"),
  );
  assert.ok(v.findings.some((x: any) => x.code === "RECORD_DRIFT"));
  assert.deepEqual(((await (await call("/" + job.id)).json()) as any).job, job);
  assert.deepEqual(await f.snapshot(), before);
});
test("latest observations preserve independent conflicts and revoked reviewer concerns rather than choosing a positive or superseded statement", async () => {
  await observe(peer, "corroborated");
  await observe(peer, "insufficient", 1);
  await observe(other, "corroborated");
  let v: any = await (await call(path())).json();
  assert.equal(v.observations.total, 2);
  assert.equal(v.observations.insufficient, 1);
  assert.equal(v.observations.corroborated, 1);
  assert.equal(v.observations.authorizedCorroborated, 1);
  await observe(peer, "concerns", 2);
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, peer.id],
  );
  v = await (await call(path())).json();
  assert.equal(v.observations.total, 2);
  assert.equal(v.observations.insufficient, 0);
  assert.equal(v.observations.concerns, 1);
  assert.equal(v.observations.authorizationChanged, 1);
  assert.equal(v.observations.authorizedCorroborated, 1);
  assert.ok(v.findings.some((x: any) => x.code === "REVIEWER_CONCERNS"));
  assert.ok(v.findings.some((x: any) => x.code === "REVIEWER_ACCESS_CHANGED"));
  assert.equal(
    v.observations.items.find((x: any) => x.reviewer_id === peer.id)
      .currently_authorized,
    false,
  );
  assert.equal(v.approvalEnabled, false);
});
test("bounded readiness detail includes all current observation totals even when the adverse statement is outside the 25 displayed rows", async () => {
  const people = [peer, other];
  for (let i = 0; i < 26; i++) {
    const person = await independentSourceReviewer(f);
    people.push(person);
    await observe(person, "corroborated");
  }
  const last = [...people].sort((a, b) => a.id.localeCompare(b.id)).at(-1)!;
  if (last.id === peer.id) {
    await f.root.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [f.customer, peer.id],
    );
    await observe(peer, "concerns", 3);
  } else await observe(last, "concerns", 1);
  const v: any = await (await call(path())).json();
  assert.equal(v.observations.total, 28);
  assert.equal(v.observations.items.length, 25);
  assert.equal(v.observations.truncated, true);
  assert.ok(!v.observations.items.some((x: any) => x.reviewer_id === last.id));
  assert.ok(v.observations.concerns >= 1);
  assert.ok(v.findings.some((x: any) => x.code === "REVIEWER_CONCERNS"));
});
test("readiness and its narrow privileged summary reject foreign anonymous clerk and revoked caller scope without widening raw grant reads", async () => {
  assert.equal(
    (await call(path(), undefined, undefined, f.hidden)).status,
    403,
  );
  assert.equal(
    (await call(`/${job.id}/evidence/${randomUUID()}/readiness`)).status,
    404,
  );
  const anonymous = await fetch(
    f.apiURL + `/api/estates/${f.estate}/reconciliation/jobs` + path(),
  );
  assert.equal(anonymous.status, 401);
  const c = await f.runtime.connect();
  try {
    await c.query("BEGIN");
    await assert.rejects(
      c.query("SELECT eoms.source_readiness_observations($1)", [match.id]),
      /scope required/,
    );
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    assert.equal(
      (
        await c.query(
          "SELECT * FROM eoms.organization_admins WHERE user_id=$1",
          [other.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await c.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          other.id,
        ])
      ).rowCount,
      0,
    );
    const summary = (
      await c.query("SELECT eoms.source_readiness_observations($1) AS report", [
        match.id,
      ])
    ).rows[0].report;
    assert.equal(summary.total, 28);
    assert.doesNotMatch(JSON.stringify(summary), /password_hash|@fixture/);
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, f.user],
  );
  assert.equal((await call(path())).status, 403);
  const denied = await f.runtime.connect();
  try {
    await denied.query("BEGIN");
    await denied.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    await assert.rejects(
      denied.query("SELECT eoms.source_readiness_observations($1)", [match.id]),
      /scope required/,
    );
    await denied.query("ROLLBACK");
  } finally {
    denied.release();
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
});
