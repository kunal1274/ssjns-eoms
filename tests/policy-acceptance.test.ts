import "../apps/api/src/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
let f: Awaited<ReturnType<typeof upgradedWorkFixture>>,
  peer: Awaited<ReturnType<typeof independentSourceReviewer>>,
  other: typeof peer,
  p: any,
  grant: any,
  original: any,
  accepted: any;
const content = {
  version: 1,
  basis: "mapping-policy-r0",
  scope: "design-review-only",
  custodyCriteria: "Named controlled archive and source chain of custody",
  approverCriteria: "Explicit independent approver with estate customer scope",
  evidenceCriteria: "Every adverse observation resolved with linked history",
};
async function call(path: string, body?: any, raw?: string, estate?: string) {
  return fetch(
    f.apiURL + `/api/estates/${estate ?? f.estate}/reconciliation/` + path,
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
const appointment = (
  subjectId = peer.id,
  expectedRevision = 0,
  action = "appointed",
) => ({
  key: randomUUID(),
  subjectId,
  expectedRevision,
  action,
  authorityRef: "Synthetic owner appointment reference",
  reason: "Separate external decision recorder",
});
const decision = (
  expectedRevision = 0,
  outcome = "accepted-externally",
  authorityId = grant.id,
) => ({
  key: randomUUID(),
  expectedRevision,
  policySha256: p.sha256,
  authorityId,
  outcome,
  externalRef: "Synthetic external owner policy decision",
  reason: "Recorder checked exact signed decision reference",
  attested: true,
});
const path = () => "policies/" + p.id + "/acceptance";
async function state() {
  return (await (await call(path())).json()) as any;
}
async function review(outcome: string, expectedRevision = 0) {
  const r = await call(
    "policies/" + p.id + "/reviews",
    {
      key: randomUUID(),
      expectedRevision,
      policySha256: p.sha256,
      outcome,
      reference: "Synthetic design review reference",
      reason: "Design concern tracked with linked revisions",
    },
    other.raw,
  );
  assert.equal(r.status, 200);
}
before(async () => {
  f = await upgradedWorkFixture({ setupAdmin: true });
  peer = await independentSourceReviewer(f);
  other = await independentSourceReviewer(f);
  const r = await call("policies", {
    key: randomUUID(),
    expectedRevision: 0,
    reason: "Explicit policy acceptance preparation",
    content,
  });
  assert.equal(r.status, 200);
  p = ((await r.json()) as any).policy;
});
after(async () => {
  await f?.close();
});
test("scoped candidate discovery exposes only eligible names and references while ordinary managers cannot self appoint or record acceptance", async () => {
  const r = await call("policy-authority/candidates?limit=1");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const v: any = await r.json();
  assert.equal(v.items.length, 1);
  assert.ok(v.nextCursor);
  assert.doesNotMatch(JSON.stringify(v), /email|password|token_hash/);
  assert.equal(
    (await call("policy-authority/candidates?limit=2&cursor=" + v.nextCursor))
      .status,
    422,
  );
  assert.equal(
    (await call("policy-authority/candidates", undefined, undefined, f.hidden))
      .status,
    403,
  );
  assert.equal(
    (await call("policy-authority", appointment(f.user))).status,
    403,
  );
  assert.equal(
    (await call("policy-authority", appointment(randomUUID()))).status,
    403,
  );
  assert.equal(
    (
      await call(
        path(),
        decision(0, "accepted-externally", randomUUID()),
        peer.raw,
      )
    ).status,
    403,
  );
  assert.equal((await state()).canRecord, false);
});
test("concurrent appointments recover one immutable actual scoped grant and reject stale or changed retries without touching work facts", async () => {
  const baseline = await f.snapshot(),
    input = appointment(),
    rs = await Promise.all([
      call("policy-authority", input),
      call("policy-authority", input),
    ]);
  for (const r of rs) assert.equal(r.status, 200);
  const a: any = await rs[0].json(),
    b: any = await rs[1].json();
  grant = a.authority;
  assert.equal(grant.id, b.authority.id);
  assert.equal(grant.actor_id, f.user);
  assert.equal(grant.subject_id, peer.id);
  assert.equal(grant.revision, 1);
  assert.match(grant.request_id, /^[a-f0-9-]{36}$/);
  assert.equal(
    (await call("policy-authority", { ...input, reason: "Changed retry" }))
      .status,
    409,
  );
  assert.equal((await call("policy-authority", appointment())).status, 409);
  const s: any = await (
    await call("policy-authority?subjectId=" + peer.id)
  ).json();
  assert.equal(s.state.effective, true);
  assert.equal(s.state.scopeCurrent, true);
  assert.deepEqual(await f.snapshot(), baseline);
  await assert.rejects(
    f.root.query("DELETE FROM eoms.mapping_policy_authority WHERE id=$1", [
      grant.id,
    ]),
    /append only/,
  );
});
test("external acceptance needs exact identity independent appointed actor attestation and resolution of all current design concerns", async () => {
  assert.equal(
    (await call(path(), { ...decision(), attested: false }, peer.raw)).status,
    422,
  );
  assert.equal(
    (
      await call(
        path(),
        { ...decision(), policySha256: "b".repeat(64) },
        peer.raw,
      )
    ).status,
    422,
  );
  const own = await call("policy-authority", appointment(f.user), peer.raw);
  assert.equal(own.status, 200);
  const ownGrant: any = await own.json();
  assert.equal(
    (
      await call(
        path(),
        decision(0, "accepted-externally", ownGrant.authority.id),
      )
    ).status,
    403,
  );
  await review("changes-requested");
  assert.equal((await call(path(), decision(), peer.raw)).status, 422);
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, other.id],
  );
  assert.equal((await state()).state.openDesignConcerns, 1);
  assert.equal((await call(path(), decision(), peer.raw)).status, 422);
  await f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [f.customer, other.id],
  );
  await review("support-for-design", 1);
  original = decision();
  const rs = await Promise.all([
    call(path(), original, peer.raw),
    call(path(), original, peer.raw),
  ]);
  for (const r of rs) assert.equal(r.status, 200);
  const a: any = await rs[0].json(),
    b: any = await rs[1].json();
  accepted = a.acceptance;
  assert.equal(accepted.id, b.acceptance.id);
  assert.equal(accepted.authority_id, grant.id);
  assert.equal(accepted.actor_id, peer.id);
  assert.equal(accepted.policy_sha256, p.sha256);
  assert.equal((await state()).state.current, true);
  assert.equal((await state()).state.applicationEnabled, false);
  assert.equal((await state()).state.sourceAuthenticityVerified, false);
  assert.equal(
    (
      await call(
        path(),
        { ...original, externalRef: "Changed reference" },
        peer.raw,
      )
    ).status,
    409,
  );
  assert.equal((await call(path(), decision(), peer.raw)).status, 409);
});
test("scope loss and restoration cannot resurrect an old appointment or acceptance; reappointment requires a new exact-bound decision", async () => {
  await f.root.query(
    "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
    [f.customer, peer.id],
  );
  assert.equal((await state()).state.current, false);
  assert.equal((await call(path(), original, peer.raw)).status, 403);
  await f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [f.customer, peer.id],
  );
  let s = await state();
  assert.equal(s.state.current, false);
  assert.equal(s.state.authorityCurrent, false);
  assert.equal((await call(path(), decision(1), peer.raw)).status, 403);
  const recovered = await call(path(), original, peer.raw);
  assert.equal(recovered.status, 200);
  assert.equal(((await recovered.json()) as any).acceptance.id, accepted.id);
  const r = await call("policy-authority", appointment(peer.id, 1));
  assert.equal(r.status, 200);
  grant = ((await r.json()) as any).authority;
  assert.equal((await state()).state.current, false);
  assert.equal(
    (
      await call(
        path(),
        decision(1, "accepted-externally", original.authorityId),
        peer.raw,
      )
    ).status,
    409,
  );
  const r2 = await call(path(), decision(1), peer.raw);
  assert.equal(r2.status, 200);
  const a: any = await r2.json();
  assert.equal(a.acceptance.previous_id, accepted.id);
  assert.equal(a.acceptance.authority_id, grant.id);
  assert.equal((await state()).state.current, true);
});
test("linked withdrawal supersession and rejection preserve earlier receipts and current adverse design observations invalidate recorded acceptance", async () => {
  await review("not-supported", 2);
  assert.equal((await state()).state.current, false);
  assert.equal((await state()).state.recordedExternalAcceptance, true);
  await review("support-for-design", 3);
  let r = await call(path(), decision(2, "withdrawn"), peer.raw);
  assert.equal(r.status, 200);
  let a: any = await r.json();
  assert.equal(
    a.acceptance.previous_id,
    (await state()).items.find((v: any) => v.revision === 2).id,
  );
  assert.equal((await state()).state.current, false);
  assert.equal(
    (await call(path(), decision(3, "withdrawn"), peer.raw)).status,
    422,
  );
  r = await call(path(), decision(3, "rejected"), peer.raw);
  assert.equal(r.status, 200);
  r = await call(path(), decision(4, "changes-requested"), peer.raw);
  assert.equal(r.status, 200);
  r = await call(path(), decision(5), peer.raw);
  assert.equal(r.status, 200);
  const newPolicy = await call("policies", {
    key: randomUUID(),
    expectedRevision: 1,
    reason: "Supersede accepted policy with explicit new criteria",
    content: {
      ...content,
      custodyCriteria: "Revised controlled archive and named custody owner",
    },
  });
  assert.equal(newPolicy.status, 200);
  assert.equal((await state()).state.current, false);
  assert.equal((await state()).state.isLatestPolicy, false);
  assert.equal((await call(path(), decision(6), peer.raw)).status, 409);
  r = await call(path(), decision(6, "withdrawn"), peer.raw);
  assert.equal(r.status, 200);
  const old = await call(path(), original, peer.raw);
  assert.equal(old.status, 200);
  assert.equal(((await old.json()) as any).acceptance.id, accepted.id);
  const paged: any = await (await call(path() + "?limit=1")).json();
  assert.equal(paged.items.length, 1);
  assert.ok(paged.nextCursor);
  assert.equal(
    (
      await call(
        path() + "?limit=1&cursor=" + paged.nextCursor,
        undefined,
        peer.raw,
      )
    ).status,
    422,
  );
  await assert.rejects(
    f.root.query(
      "UPDATE eoms.mapping_policy_acceptance SET reason='rewrite' WHERE id=$1",
      [accepted.id],
    ),
    /append only/,
  );
});
test("runtime cannot bypass authority helpers or read raw scope metadata and caller revocation clears both authority and acceptance access", async () => {
  const c = await f.runtime.connect();
  try {
    await c.query("BEGIN");
    await assert.rejects(
      c.query("SELECT eoms.policy_authority_state($1,$2)", [f.estate, peer.id]),
      /scope required/,
    );
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    await assert.rejects(
      c.query("SELECT * FROM eoms.mapping_policy_scope_events"),
      /permission denied/,
    );
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    await assert.rejects(
      c.query("SELECT eoms.lock_policy_recording_scope($1,$2)", [
        f.estate,
        peer.id,
      ]),
      /permission denied/,
    );
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.user]);
    assert.equal(
      (
        await c.query(
          "SELECT * FROM eoms.organization_admins WHERE user_id=$1",
          [peer.id],
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      c.query("INSERT INTO eoms.mapping_policy_acceptance DEFAULT VALUES"),
      /permission denied/,
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  const anon = await fetch(
    f.apiURL + `/api/estates/${f.estate}/reconciliation/policy-authority`,
  );
  assert.equal(anon.status, 401);
  assert.equal(
    (await call("policies/" + randomUUID() + "/acceptance")).status,
    404,
  );
  assert.equal((await call(path() + "?apply=true")).status, 422);
  await f.root.query(
    "UPDATE eoms.memberships SET role='clerk' WHERE estate_id=$1 AND user_id=$2",
    [f.estate, f.user],
  );
  assert.equal((await call("policy-authority")).status, 403);
  assert.equal((await call(path())).status, 403);
});
