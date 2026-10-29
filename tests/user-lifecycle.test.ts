import "../apps/api/src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import {
  independentSourceReviewer,
  freshSyntheticSession,
} from "./source-review-fixture";
import { hash, token } from "../apps/api/src/security";
async function fixture(run: (f: any, call: any, peer: any) => Promise<void>) {
  const f = await upgradedWorkFixture();
  try {
    const peer = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    const call = (
      path: string,
      body?: unknown,
      raw = f.raw,
      csrf = "synthetic-history-ui",
    ) =>
      fetch(f.apiURL + "/api/auth/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: "eoms_session=" + raw,
          Origin: "http://localhost:5284",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await run(f, call, peer);
  } finally {
    await f.close();
  }
}
async function authorize(f: any, id = f.user, action = "granted") {
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/authorize-lifecycle-operator.ts",
      id,
      action,
      "Synthetic lifecycle mandate",
      "Explicit global account lifecycle test authority",
    ],
    {
      env: {
        ...process.env,
        ADMIN_DATABASE_URL: f.root.options.connectionString,
      },
    },
  );
}
const decision = (id: string, revision = "0", state = "suspended") => ({
  targetId: id,
  revision,
  state,
  key: randomUUID(),
  reference: "Synthetic lifecycle request",
  reason: "Reviewed account assignments before the lifecycle decision",
  reviewed: true,
});
test("lifecycle authority is separate, private, immutable and explicitly revocable", async () =>
  fixture(async (f, call, peer) => {
    assert.deepEqual(await (await call("lifecycle/context")).json(), {
      allowed: false,
    });
    assert.equal(
      (await call("lifecycle/context?targetId=" + peer.id)).status,
      403,
    );
    assert.equal(
      (await call("lifecycle/change", decision(peer.id))).status,
      403,
    );
    await f.root.query(
      "INSERT INTO eoms.platform_security_authority(subject_id,action,user_scope_revision,reference,reason) VALUES($1,'granted',0,'Synthetic separate mandate','Security revocation is not lifecycle authority')",
      [f.user],
    );
    assert.equal(
      (await call("lifecycle/change", decision(peer.id))).status,
      403,
    );
    await authorize(f);
    assert.equal(
      (await (await call("lifecycle/context")).json()).allowed,
      true,
    );
    await assert.rejects(
      f.runtime.query("SELECT * FROM eoms.platform_lifecycle_authority"),
      { code: "42501" },
    );
    await assert.rejects(
      f.runtime.query("UPDATE eoms.users SET active=false WHERE id=$1", [
        peer.id,
      ]),
      { code: "42501" },
    );
    await assert.rejects(
      f.root.query(
        "DELETE FROM eoms.platform_lifecycle_authority WHERE subject_id=$1",
        [f.user],
      ),
    );
    await authorize(f, f.user, "revoked");
    assert.equal(
      (await call("lifecycle/change", decision(peer.id))).status,
      403,
    );
  }));
test("suspension/deactivation/reactivation invalidate sessions and recovery without reviving old tokens; history and exact receipt survive", async () =>
  fixture(async (f, call, peer) => {
    await authorize(f);
    const before = await f.snapshot();
    const recovery = token();
    await f.root.query(
      "INSERT INTO eoms.recovery_tokens(token_hash,user_id,credential_version,expires_at) SELECT $1,id,password_hash,now()+interval '15 minutes' FROM eoms.users WHERE id=$2",
      [hash(recovery), peer.id],
    );
    const body = decision(peer.id),
      r = await call("lifecycle/change", body);
    assert.equal(r.status, 200);
    const receipt = await r.json();
    assert.equal(receipt.state, "suspended");
    assert.equal(receipt.revision, "1");
    assert.equal(receipt.sessionsInvalidated, 1);
    assert.equal((await call("session", undefined, peer.raw)).status, 401);
    assert.equal(
      (
        await f.root.query(
          "SELECT token_hash FROM eoms.recovery_tokens WHERE user_id=$1",
          [peer.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (await call("lifecycle/change", { ...body, key: randomUUID() })).status,
      409,
    );
    const deactivated = await call(
      "lifecycle/change",
      decision(peer.id, "1", "deactivated"),
    );
    assert.equal(deactivated.status, 200);
    assert.equal(
      (await call("lifecycle/change", decision(peer.id, "2", "suspended")))
        .status,
      422,
    );
    assert.equal(
      (await call("lifecycle/change", decision(peer.id, "2", "active"))).status,
      200,
    );
    const fresh = await freshSyntheticSession(f, peer.id);
    const replay = await (await call("lifecycle/change", body)).json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.eventId, receipt.eventId);
    assert.equal((await call("session", undefined, fresh)).status, 200);
    assert.equal((await call("session", undefined, peer.raw)).status, 401);
    assert.equal(
      (
        await call("lifecycle/change", {
          ...body,
          reason: "Changed request must never reuse the exact receipt",
        })
      ).status,
      409,
    );
    const preview = await (
      await call("lifecycle/context?targetId=" + peer.id + "&limit=2")
    ).json();
    assert.equal(preview.target.state, "active");
    assert.equal(preview.items.length, 2);
    assert.ok(preview.nextCursor);
    const more = await (
      await call(
        "lifecycle/context?targetId=" +
          peer.id +
          "&limit=2&cursor=" +
          preview.nextCursor,
      )
    ).json();
    assert.equal(more.items.length, 1);
    assert.equal(
      new Set([...preview.items, ...more.items].map((e: any) => e.id)).size,
      3,
    );
    assert.deepEqual(await f.snapshot(), before);
    const audit = (
      await f.root.query(
        "SELECT * FROM eoms.security_events WHERE subject_id=$1 AND action='lifecycle.suspended'",
        [peer.id],
      )
    ).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_id, f.user);
    assert.equal(audit[0].detail.reference, body.reference);
    assert.equal(audit[0].request_id, receipt.requestId);
    await assert.rejects(
      f.root.query("UPDATE eoms.security_events SET detail='{}' WHERE id=$1", [
        receipt.eventId,
      ]),
    );
  }));
test("lifecycle validates CSRF, origin, reviewed intent, self target, stable cursor bindings and bigint bounds", async () =>
  fixture(async (f, call, peer) => {
    await authorize(f);
    assert.equal(
      (
        await call("lifecycle/change", {
          ...decision(peer.id),
          revision: "invalid",
        })
      ).status,
      422,
    );
    assert.equal(
      (await call("lifecycle/change", decision(f.user))).status,
      403,
    );
    assert.equal(
      (await call("lifecycle/change", decision(peer.id), f.raw, "wrong"))
        .status,
      403,
    );
    assert.equal(
      (
        await call("lifecycle/change", {
          ...decision(peer.id),
          reviewed: false,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await call("lifecycle/change", {
          ...decision(peer.id),
          revision: "9223372036854775808",
        })
      ).status,
      422,
    );
    assert.equal(
      (await call("lifecycle/context?targetId=" + peer.id + "&unexpected=true"))
        .status,
      422,
    );
    const cursor = Buffer.from(
      JSON.stringify({
        actor: f.user,
        target: peer.id,
        limit: 10,
        after: "9223372036854775808",
      }),
    ).toString("base64url");
    assert.equal(
      (
        await call(
          "lifecycle/context?targetId=" + peer.id + "&cursor=" + cursor,
        )
      ).status,
      422,
    );
    const wrong = Buffer.from(
      JSON.stringify({
        actor: peer.id,
        target: peer.id,
        limit: 10,
        after: "1",
      }),
    ).toString("base64url");
    assert.equal(
      (await call("lifecycle/context?targetId=" + peer.id + "&cursor=" + wrong))
        .status,
      422,
    );
    const external = await fetch(f.apiURL + "/api/auth/lifecycle/change", {
      method: "POST",
      headers: {
        Cookie: "eoms_session=" + f.raw,
        Origin: "https://untrusted.invalid",
        "Content-Type": "application/json",
        "X-CSRF-Token": "synthetic-history-ui",
      },
      body: JSON.stringify(decision(peer.id)),
    });
    assert.equal(external.status, 403);
    assert.equal(
      (
        await f.root.query(
          "SELECT id FROM eoms.security_events WHERE action='lifecycle.suspended'",
        )
      ).rowCount,
      0,
    );
  }));
test("last setup administrator is protected, concurrent suspensions retain one administrator", async () =>
  fixture(async (f, call, peer) => {
    await authorize(f);
    await f.root.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [f.customer, peer.id],
    );
    const p = await (
      await call("lifecycle/context?targetId=" + peer.id)
    ).json();
    assert.equal(p.target.protectedSetups, 1);
    assert.equal(
      (await call("lifecycle/change", decision(peer.id))).status,
      422,
    );
    const other = await independentSourceReviewer(f);
    const statuses = await Promise.all([
      call("lifecycle/change", decision(peer.id)),
      call("lifecycle/change", decision(other.id)),
    ]);
    assert.deepEqual(statuses.map((r) => r.status).sort(), [200, 422]);
    assert.equal(
      (
        await f.root.query(
          "SELECT count(*)::int AS n FROM eoms.organization_admins a JOIN eoms.users u ON u.id=a.user_id AND u.active WHERE a.customer_id=$1",
          [f.customer],
        )
      ).rows[0].n,
      1,
    );
  }));
test("operator suspension/restoration never revives lifecycle appointment, and legacy active changes synchronize classification without fake history", async () =>
  fixture(async (f, call, peer) => {
    await authorize(f);
    await f.root.query("UPDATE eoms.users SET active=false WHERE id=$1", [
      f.user,
    ]);
    await f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
      f.user,
    ]);
    const raw = await freshSyntheticSession(f, f.user);
    assert.equal(
      (await (await call("lifecycle/context", undefined, raw)).json()).allowed,
      false,
    );
    const u = (
      await f.root.query(
        "SELECT lifecycle_state,lifecycle_revision FROM eoms.users WHERE id=$1",
        [f.user],
      )
    ).rows[0];
    assert.equal(u.lifecycle_state, "active");
    assert.equal(u.lifecycle_revision, "2");
    assert.equal(
      (
        await f.root.query(
          "SELECT id FROM eoms.security_events WHERE subject_id=$1 AND action IN ('lifecycle.active','lifecycle.suspended')",
          [f.user],
        )
      ).rowCount,
      0,
    );
    await authorize(f);
    assert.equal(
      (await call("lifecycle/change", decision(peer.id), raw)).status,
      200,
    );
  }));
