import "../apps/api/src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { customerJoinFixture } from "./customer-join-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
const declared = {
  reference: "Synthetic existing account invitation",
  reason: "Reviewed explicit access proposal for an existing synthetic account",
  reviewed: true,
};
async function prepare(f: any, extra: any = {}) {
  const envelope = {
    operation: "prepare",
    key: randomUUID(),
    input: {
      customerId: f.customer,
      targetId: f.peer.id,
      userCode: "JOIN-EMP-01",
      employeeReference: "Supplied customer employee reference",
      replaceId: null,
      estates: [
        { estateId: f.estate, role: "supervisor" },
        { estateId: f.hidden, role: "clerk" },
      ],
      ...declared,
      ...extra,
    },
  };
  const r = await f.call(envelope);
  assert.equal(r.status, 200, await r.clone().text());
  return { envelope, ...(await r.json()) };
}
const consent = (f: any, i: any, operation = "accept") => ({
  operation,
  key: randomUUID(),
  input: { customerId: f.customer, invitationId: i.invitationId, ...declared },
});
async function inFixture(run: (f: any) => Promise<void>) {
  const f = await customerJoinFixture();
  try {
    await run(f);
  } finally {
    await f.close();
  }
}

test("existing customer join requires target consent and preserves the global identity, session and other customer", async () =>
  inFixture(async (f) => {
    const before = (
      await f.root.query(
        "SELECT email,password_hash,active,lifecycle_state FROM eoms.users WHERE id=$1",
        [f.peer.id],
      )
    ).rows[0];
    const i = await prepare(f);
    assert.equal(
      (
        await f.root.query(
          "SELECT * FROM eoms.memberships WHERE user_id=$1 AND estate_id IN($2,$3)",
          [f.peer.id, f.estate, f.hidden],
        )
      ).rowCount,
      0,
    );
    const admin = await (
      await f.call(
        undefined,
        f.raw,
        "/api/auth/customer-invitations?customerId=" + f.customer,
      )
    ).json();
    assert.equal(admin.items.length, 1);
    assert.ok(
      !JSON.stringify(admin).includes("Independent synthetic source reviewer"),
    );
    assert.equal((await f.call(consent(f, i))).status, 403);
    assert.equal(
      (
        await f.call(
          {
            ...consent(f, i),
            input: { ...consent(f, i).input, reviewed: false },
          },
          f.peer.raw,
        )
      ).status,
      422,
    );
    assert.equal(
      (await f.call({ ...i.envelope, key: randomUUID() }, f.peer.raw)).status,
      403,
    );
    assert.equal(
      (
        await f.call({
          ...i.envelope,
          key: randomUUID(),
          input: {
            ...i.envelope.input,
            estates: [{ estateId: f.otherEstate, role: "clerk" }],
          },
        })
      ).status,
      403,
    );
    const inbox = await (await f.call(undefined, f.peer.raw)).json();
    assert.equal(inbox.items[0].accept_available, true);
    assert.equal(inbox.items[0].estates.length, 2);
    const accepted = consent(f, i);
    const results = await Promise.all([
      f.call(accepted, f.peer.raw),
      f.call(accepted, f.peer.raw),
    ]);
    assert.deepEqual(
      results.map((x) => x.status),
      [200, 200],
    );
    const receipts = await Promise.all(results.map((x) => x.json()));
    assert.equal(receipts.filter((x) => x.replayed).length, 1);
    assert.deepEqual(
      (
        await f.root.query(
          "SELECT email,password_hash,active,lifecycle_state FROM eoms.users WHERE id=$1",
          [f.peer.id],
        )
      ).rows[0],
      before,
    );
    assert.equal(
      (await f.call(undefined, f.peer.raw, "/api/auth/session")).status,
      200,
    );
    assert.equal(
      (
        await f.call(
          undefined,
          f.peer.raw,
          "/api/estates/" + f.otherEstate + "/musters",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.call(
          undefined,
          f.peer.raw,
          "/api/estates/" + f.estate + "/musters",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.root.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          f.peer.id,
        ])
      ).rowCount,
      3,
    );
    assert.equal(
      (
        await f.root.query(
          "SELECT * FROM eoms.organization_admins WHERE user_id=$1 AND customer_id=$2",
          [f.peer.id, f.customer],
        )
      ).rowCount,
      0,
    );
    const manifest = await (
      await f.call(undefined, f.peer.raw, "/api/auth/access-manifest")
    ).json();
    assert.equal(manifest.customerProfiles[0].userCode, "JOIN-EMP-01");
    const events = (
      await f.root.query(
        "SELECT * FROM eoms.security_events WHERE subject_id=$1 AND action='registration.join-accept'",
        [f.peer.id],
      )
    ).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].actor_id, f.peer.id);
    assert.equal(events[0].request_id, receipts[0].requestId);
    await assert.rejects(
      f.root.query("DELETE FROM eoms.security_events WHERE id=$1", [
        events[0].id,
      ]),
    );
    assert.equal(
      (
        await f.call(
          {
            ...accepted,
            input: {
              ...accepted.input,
              reason: "A changed consent intent must fail",
            },
          },
          f.peer.raw,
        )
      ).status,
      409,
    );
    assert.equal(
      (await f.call({ ...i.envelope, key: randomUUID() })).status,
      409,
    );
  }));

test("customer join replacement cancellation decline expiry and authority regrant never revive obsolete proposals", async () =>
  inFixture(async (f) => {
    const a = await prepare(f);
    assert.equal(
      (await f.call({ ...a.envelope, key: randomUUID() })).status,
      409,
    );
    const b = await prepare(f, { replaceId: a.invitationId });
    assert.equal((await f.call(consent(f, a), f.peer.raw)).status, 409);
    const cancel = consent(f, b, "cancel");
    assert.equal((await f.call(cancel)).status, 200);
    assert.equal((await (await f.call(cancel)).json()).replayed, true);
    const c = await prepare(f);
    assert.equal(
      (await f.call(consent(f, c, "decline"), f.peer.raw)).status,
      200,
    );
    assert.equal((await f.call(consent(f, c), f.peer.raw)).status, 409);
    const expired = await prepare(f);
    await f.root.query(
      "UPDATE eoms.customer_join_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.invitationId],
    );
    assert.equal((await f.call(consent(f, expired), f.peer.raw)).status, 409);
    const current = await prepare(f, { replaceId: expired.invitationId });
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1 AND customer_id=$2",
      [f.user, f.customer],
    );
    await f.root.query(
      "INSERT INTO eoms.organization_admins(user_id,customer_id) VALUES($1,$2)",
      [f.user, f.customer],
    );
    assert.equal((await f.call(consent(f, current), f.peer.raw)).status, 409);
    const inbox = await (await f.call(undefined, f.peer.raw)).json();
    assert.equal(
      inbox.items.find((x: any) => x.id === current.invitationId)
        .accept_available,
      false,
    );
    const final = await prepare(f, { replaceId: current.invitationId });
    assert.equal((await f.call(consent(f, final), f.peer.raw)).status, 200);
    assert.equal((await f.call(consent(f, current), f.peer.raw)).status, 409);
  }));

test("customer join lists and cursors are scoped and employee code conflicts roll back all grants", async () =>
  inFixture(async (f) => {
    const peer2 = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer2.id],
    );
    await f.root.query("DELETE FROM eoms.memberships WHERE user_id=$1", [
      peer2.id,
    ]);
    const a = await prepare(f),
      b = await prepare(f, { targetId: peer2.id });
    const page = await (
      await f.call(
        undefined,
        f.raw,
        "/api/auth/customer-invitations?customerId=" + f.customer + "&limit=1",
      )
    ).json();
    assert.equal(page.items.length, 1);
    assert.ok(page.nextCursor);
    assert.equal(
      (
        await f.call(
          undefined,
          peer2.raw,
          "/api/auth/customer-invitations?limit=1&cursor=" + page.nextCursor,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await f.call(
          undefined,
          f.raw,
          "/api/auth/customer-invitations?customerId=" + f.otherCustomer,
        )
      ).status,
      403,
    );
    const next = await (
      await f.call(
        undefined,
        f.raw,
        "/api/auth/customer-invitations?customerId=" +
          f.customer +
          "&limit=1&cursor=" +
          page.nextCursor,
      )
    ).json();
    assert.equal(next.items.length, 1);
    assert.notEqual(next.items[0].id, page.items[0].id);
    assert.deepEqual(
      (await (await f.call(undefined, peer2.raw)).json()).items.map(
        (x: any) => x.id,
      ),
      [b.invitationId],
    );
    assert.equal((await f.call(consent(f, a), f.peer.raw)).status, 200);
    assert.equal((await f.call(consent(f, b), peer2.raw)).status, 409);
    assert.equal(
      (
        await f.root.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          peer2.id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await f.root.query(
          "SELECT state FROM eoms.customer_join_invitations WHERE id=$1",
          [b.invitationId],
        )
      ).rows[0].state,
      "pending",
    );
    assert.equal(
      (
        await f.root.query(
          "SELECT * FROM eoms.customer_user_access WHERE user_id=$1",
          [peer2.id],
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      f.runtime.query("SELECT * FROM eoms.customer_join_invitations"),
      { code: "42501" },
    );
    await assert.rejects(
      f.runtime.query("SELECT * FROM eoms.customer_user_profiles"),
      { code: "42501" },
    );
  }));

test("customer join cancellation and acceptance serialize without partial membership state", async () =>
  inFixture(async (f) => {
    const i = await prepare(f);
    const results = await Promise.all([
      f.call(consent(f, i), f.peer.raw),
      f.call(consent(f, i, "cancel")),
    ]);
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
    const state = (
      await f.root.query(
        "SELECT state FROM eoms.customer_join_invitations WHERE id=$1",
        [i.invitationId],
      )
    ).rows[0].state;
    const n = (
      await f.root.query(
        "SELECT count(*)::int AS n FROM eoms.memberships WHERE user_id=$1 AND estate_id IN($2,$3)",
        [f.peer.id, f.estate, f.hidden],
      )
    ).rows[0].n;
    assert.equal(n, state === "accepted" ? 2 : 0);
    assert.equal(
      (
        await f.call(
          undefined,
          f.peer.raw,
          "/api/estates/" + f.otherEstate + "/musters",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.root.query(
          "SELECT * FROM eoms.security_events WHERE subject_id=$1 AND action IN('registration.join-accept','registration.join-cancel')",
          [f.peer.id],
        )
      ).rowCount,
      1,
    );
  }));
