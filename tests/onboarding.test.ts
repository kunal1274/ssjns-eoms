import "../apps/api/src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import request from "supertest";
import { createApp } from "../apps/api/src/app";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { controlledIssuer } from "./oidc-issuer-fixture";
import { token, hash } from "../apps/api/src/security";
async function fixture(run: (f: any, call: any) => Promise<void>, oidc?: any) {
  const f = await upgradedWorkFixture({
    setupAdmin: true,
    appOptions: oidc ? { oidc } : undefined,
  });
  try {
    const call = (
      path: string,
      body?: unknown,
      raw = f.raw,
      csrf = "synthetic-history-ui",
    ) =>
      fetch(f.apiURL + "/api/auth/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: "http://localhost:5284",
          Cookie: "eoms_session=" + raw,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await run(f, call);
  } finally {
    await f.close();
  }
}
const reason = {
  reference: "Synthetic HR registration authority",
  reason: "Authorized synthetic user lifecycle and assignment request",
};
async function stage(f: any, call: any, extra: any = {}) {
  const input = {
    customerId: f.customer,
    email: randomUUID() + "@fixture.local",
    name: "Registered synthetic employee",
    userCode: "EMP-" + randomUUID().slice(0, 10),
    employeeReference: "Supplied synthetic HR employee reference",
    estates: [
      { estateId: f.estate, role: "clerk" },
      { estateId: f.hidden, role: "supervisor" },
    ],
    ...reason,
    ...extra,
  };
  const envelope = { operation: "stage", key: randomUUID(), input };
  const r = await call("onboarding/write", envelope);
  assert.equal(r.status, 200, await r.clone().text());
  return { input, envelope, ...(await r.json()) };
}
async function invite(f: any, call: any, user: any, extra: any = {}) {
  const secret = token();
  const envelope = {
    operation: "invite",
    key: randomUUID(),
    input: {
      customerId: f.customer,
      targetId: user.targetId,
      revision: user.revision,
      token: secret,
      method: "local",
      ...reason,
      ...extra,
    },
  };
  const r = await call("onboarding/write", envelope);
  assert.equal(r.status, 200, await r.clone().text());
  return { secret, envelope, ...(await r.json()) };
}
const preview = async (call: any, f: any, id: string) => {
  const r = await call(
    "onboarding/context?customerId=" + f.customer + "&targetId=" + id,
  );
  assert.equal(r.status, 200);
  return r.json();
};
async function login(call: any, email: string, password: string) {
  const r = await call("login", { email, password }, "");
  assert.equal(r.status, 200);
  const raw = r.headers
    .getSetCookie()
    .find((x: string) => x.startsWith("eoms_session="))!
    .split(";")[0]
    .split("=")[1];
  return { raw, csrf: (await r.json()).csrf };
}
// Restoration must wait for a concurrent estate lifecycle writer before granting access.
async function restoreWhileEstateLocked(
  f: any,
  restore: () => Promise<Response>,
) {
  const blocker = await f.root.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query("BEGIN");
    const pid = (await blocker.query("SELECT pg_backend_pid() AS id")).rows[0]
      .id;
    await blocker.query("SELECT id FROM eoms.estates WHERE id=$1 FOR UPDATE", [
      f.estate,
    ]);
    pending = restore();
    let blocked = false;
    for (let n = 0; n < 100; n++) {
      blocked = (
        await f.root.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE '%eoms.onboarding_write%') AS blocked",
          [pid],
        )
      ).rows[0].blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      blocked,
      true,
      "Restoration must lock the checked estate against concurrent lifecycle changes",
    );
    await blocker.query("ROLLBACK");
    return await pending;
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    // Drain the request even when the lock assertion fails, before fixture teardown.
    if (pending) await pending;
  }
}
async function authorize(f: any, action = "granted") {
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/authorize-lifecycle-operator.ts",
      f.user,
      action,
      "Synthetic global onboarding authority",
      "Explicit named platform identity onboarding operator",
    ],
    {
      env: {
        ...process.env,
        ADMIN_DATABASE_URL: f.root.options.connectionString,
      },
    },
  );
}

test("staging is scoped, canonical, credential-free and exactly idempotent; duplicate identities never merge", async () =>
  fixture(async (f, call) => {
    const before = await f.snapshot();
    const u = await stage(f, call);
    const row = (
      await f.root.query("SELECT * FROM eoms.users WHERE id=$1", [u.targetId])
    ).rows[0];
    assert.equal(row.active, false);
    assert.equal(row.lifecycle_state, "staged");
    assert.equal(row.password_hash, "staged-no-credential");
    assert.equal(
      (
        await f.root.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          u.targetId,
        ])
      ).rowCount,
      0,
    );
    const replay = await (await call("onboarding/write", u.envelope)).json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.targetId, u.targetId);
    assert.equal(
      (
        await call("onboarding/write", {
          ...u.envelope,
          input: { ...u.input, name: "Changed retry identity" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...u.envelope,
          key: randomUUID(),
          input: { ...u.input, email: u.input.email.toUpperCase() },
        })
      ).status,
      409,
    );
    const stranger = randomUUID();
    assert.equal(
      (
        await call(
          "onboarding/context?customerId=" +
            stranger +
            "&targetId=" +
            u.targetId,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...u.envelope,
          key: randomUUID(),
          input: {
            ...u.input,
            customerId: stranger,
            email: randomUUID() + "@fixture.local",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...u.envelope,
          key: randomUUID(),
          input: {
            ...u.input,
            email: randomUUID() + "@fixture.local",
            estates: [{ estateId: randomUUID(), role: "manager" }],
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...u.envelope,
          key: randomUUID(),
          input: {
            ...u.input,
            estates: [...u.input.estates, u.input.estates[0]],
          },
        })
      ).status,
      422,
    );
    assert.equal(
      (await call("onboarding/write", u.envelope, f.raw, "bad")).status,
      403,
    );
    const searched = await (
      await call(
        "onboarding/users?customerId=" +
          f.customer +
          "&q=" +
          encodeURIComponent(u.input.email),
      )
    ).json();
    assert.deepEqual(
      searched.items.map((x: any) => x.id),
      [u.targetId],
    );
    const listed = await (
      await call("onboarding/users?customerId=" + f.customer + "&limit=1")
    ).json();
    assert.ok(listed.nextCursor);
    assert.equal(
      (
        await call(
          "onboarding/users?customerId=" +
            f.customer +
            "&limit=1&q=changed&cursor=" +
            listed.nextCursor,
        )
      ).status,
      422,
    );
    const v = await preview(call, f, u.targetId);
    assert.equal(v.userCode, u.input.userCode);
    assert.equal(v.history[0].actor_id, f.user);
    assert.equal(v.history[0].request_id, u.requestId);
    assert.deepEqual(await f.snapshot(), before);
    for (const table of [
      "user_registrations",
      "user_invitations",
      "customer_user_access",
    ])
      await assert.rejects(f.runtime.query("SELECT * FROM eoms." + table), {
        code: "42501",
      });
  }));
test("invitation preparation/reissue/cancellation retain safe exact receipts and never disclose secrets or reactivate older proof", async () =>
  fixture(async (f, call) => {
    const u = await stage(f, call),
      a = await invite(f, call, u);
    const replay = await (await call("onboarding/write", a.envelope)).json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.invitationId, a.invitationId);
    assert.equal(JSON.stringify(replay).includes(a.secret), false);
    assert.equal(JSON.stringify(replay).includes(hash(a.secret)), false);
    const b = await invite(f, call, { ...u, revision: a.revision });
    assert.equal(
      (
        await call("enrollment/accept", {
          token: a.secret,
          password: "synthetic-enrollment-password",
        })
      ).status,
      422,
    );
    const cancel = {
      operation: "cancel",
      key: randomUUID(),
      input: {
        customerId: f.customer,
        targetId: u.targetId,
        revision: b.revision,
        invitationId: b.invitationId,
        ...reason,
      },
    };
    assert.equal((await call("onboarding/write", cancel)).status, 200);
    assert.equal(
      (
        await call("enrollment/accept", {
          token: b.secret,
          password: "synthetic-enrollment-password",
        })
      ).status,
      422,
    );
    assert.equal(
      (await (await call("onboarding/write", cancel)).json()).replayed,
      true,
    );
    assert.equal(
      (
        await f.root.query("SELECT active FROM eoms.users WHERE id=$1", [
          u.targetId,
        ])
      ).rows[0].active,
      false,
    );
    assert.equal(
      (
        await f.root.query(
          "SELECT count(*)::int AS n FROM eoms.security_events WHERE subject_id=$1 AND action='registration.invite'",
          [u.targetId],
        )
      ).rows[0].n,
      2,
    );
  }));
test("staged corrections supersede pending proof and registration history pages real decisions with bound cursors", async () =>
  fixture(async (f, call) => {
    const u = await stage(f, call),
      a = await invite(f, call, u);
    const changed = {
      ...u.input,
      targetId: u.targetId,
      revision: a.revision,
      name: "Corrected synthetic employee",
      estates: [{ estateId: f.estate, role: "supervisor" }],
    };
    const amendment = await call("onboarding/write", {
      operation: "amend",
      key: randomUUID(),
      input: changed,
    });
    assert.equal(amendment.status, 200);
    let revision = (await amendment.json()).revision;
    assert.equal(
      (
        await call("enrollment/accept", {
          token: a.secret,
          password: "synthetic-superseded-correction",
        })
      ).status,
      422,
    );
    for (let k = 0; k < 25; k++) {
      const next = await invite(f, call, { ...u, revision });
      revision = next.revision;
    }
    const first = await preview(call, f, u.targetId);
    assert.equal(first.name, changed.name);
    assert.equal(first.history.length, 25);
    assert.ok(first.historyNextCursor);
    const next = await (
      await call(
        "onboarding/context?customerId=" +
          f.customer +
          "&targetId=" +
          u.targetId +
          "&cursor=" +
          first.historyNextCursor,
      )
    ).json();
    assert.equal(next.history.length, 3);
    assert.equal(
      new Set([...first.history, ...next.history].map((e: any) => e.id)).size,
      28,
    );
    assert.equal(
      (
        await call(
          "onboarding/context?customerId=" +
            f.customer +
            "&targetId=" +
            randomUUID() +
            "&cursor=" +
            first.historyNextCursor,
        )
      ).status,
      422,
    );
  }));
test("local invitation accepts once atomically, grants only approved multiple estates and exposes current device access", async () =>
  fixture(async (f, call) => {
    const u = await stage(f, call),
      a = await invite(f, call, u);
    const password = "synthetic-recipient-selected-password";
    const r = await call("enrollment/accept", { token: a.secret, password });
    assert.equal(r.status, 200, await r.clone().text());
    const accepted = await r.json();
    assert.equal(accepted.state, "active");
    assert.equal(
      (
        await call("enrollment/accept", {
          token: a.secret,
          password: "synthetic-changed-password",
        })
      ).status,
      422,
    );
    const own = await login(call, u.input.email, password);
    const manifest = await (
      await call("access-manifest", undefined, own.raw)
    ).json();
    assert.equal(manifest.userId, u.targetId);
    assert.equal(manifest.estates.length, 2);
    assert.equal(manifest.registration.userCode, u.input.userCode);
    assert.equal(manifest.accountState, "active");
    assert.ok(manifest.checkedAt);
    assert.equal(
      (await (await call("lifecycle/context", undefined, own.raw)).json())
        .allowed,
      false,
    );
    assert.equal(
      (
        await f.root.query(
          "SELECT * FROM eoms.organization_admins WHERE user_id=$1",
          [u.targetId],
        )
      ).rowCount,
      0,
    );
    const events = (
      await f.root.query(
        "SELECT * FROM eoms.security_events WHERE subject_id=$1 AND action='registration.accepted'",
        [u.targetId],
      )
    ).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].actor_id, u.targetId);
    assert.equal(events[0].request_id, accepted.requestId);
    await assert.rejects(
      f.root.query("DELETE FROM eoms.security_events WHERE id=$1", [
        events[0].id,
      ]),
    );
  }));
test("customer suspension/restoration/assignment replacement affect only that customer and reject stale scopes", async () =>
  fixture(async (f, call) => {
    const u = await stage(f, call),
      a = await invite(f, call, u);
    const password = "synthetic-multi-customer-password";
    assert.equal(
      (await call("enrollment/accept", { token: a.secret, password })).status,
      200,
    );
    const own = await login(call, u.input.email, password);
    const otherCustomer = (
      await f.root.query(
        "INSERT INTO eoms.customers(code,name) VALUES($1,'Foreign synthetic customer') RETURNING id",
        ["OTHER-" + randomUUID().slice(0, 8)],
      )
    ).rows[0].id;
    const company = (
      await f.root.query(
        "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Foreign company') RETURNING id",
        [otherCustomer],
      )
    ).rows[0].id;
    const otherEstate = (
      await f.root.query(
        "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Foreign estate') RETURNING id",
        [otherCustomer, company, "FOREIGN-" + randomUUID().slice(0, 8)],
      )
    ).rows[0].id;
    await f.root.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'clerk')",
      [u.targetId, otherEstate],
    );
    let p = await preview(call, f, u.targetId);
    const action = {
      operation: "access",
      key: randomUUID(),
      input: {
        customerId: f.customer,
        targetId: u.targetId,
        revision: p.accessRevision,
        scopeRevision: p.scopeRevision,
        state: "suspended",
        ...reason,
      },
    };
    assert.equal((await call("onboarding/write", action)).status, 200);
    assert.equal((await call("session", undefined, own.raw)).status, 200);
    const estateRead = async (id: string) =>
      fetch(f.apiURL + "/api/estates/" + id + "/musters", {
        headers: { Cookie: "eoms_session=" + own.raw },
      });
    assert.equal((await estateRead(f.estate)).status, 403);
    assert.equal((await estateRead(otherEstate)).status, 200);
    assert.equal(
      (await (await call("access-manifest", undefined, own.raw)).json())
        .customerAccess[0].state,
      "suspended",
    );
    p = await preview(call, f, u.targetId);
    const assign = {
      operation: "assign",
      key: randomUUID(),
      input: {
        customerId: f.customer,
        targetId: u.targetId,
        revision: p.accessRevision,
        scopeRevision: p.scopeRevision,
        estates: [{ estateId: f.estate, role: "supervisor" }],
        ...reason,
      },
    };
    assert.equal((await call("onboarding/write", assign)).status, 200);
    assert.equal((await estateRead(f.estate)).status, 403);
    p = await preview(call, f, u.targetId);
    assert.equal(
      (
        await restoreWhileEstateLocked(f, () =>
          call("onboarding/write", {
            operation: "access",
            key: randomUUID(),
            input: {
              customerId: f.customer,
              targetId: u.targetId,
              revision: p.accessRevision,
              scopeRevision: p.scopeRevision,
              state: "active",
              ...reason,
            },
          }),
        )
      ).status,
      200,
    );
    assert.equal((await estateRead(f.estate)).status, 200);
    assert.equal((await estateRead(f.hidden)).status, 403);
    assert.equal((await estateRead(otherEstate)).status, 200);
    assert.equal(
      (await (await call("onboarding/write", action)).json()).replayed,
      true,
    );
    assert.equal((await estateRead(f.estate)).status, 200);
    p = await preview(call, f, u.targetId);
    await f.root.query(
      "UPDATE eoms.memberships SET role='clerk' WHERE user_id=$1 AND estate_id=$2",
      [u.targetId, f.estate],
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...assign,
          key: randomUUID(),
          input: {
            ...assign.input,
            revision: p.accessRevision,
            scopeRevision: p.scopeRevision,
          },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...action,
          key: randomUUID(),
          input: { ...action.input, targetId: f.user },
        })
      ).status,
      403,
    );
  }));
test("expired or revoked/regranted issuing authority cannot revive an old invitation; acceptance rolls back inactive estate proposals", async () =>
  fixture(async (f, call) => {
    const u = await stage(f, call),
      a = await invite(f, call, u);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1 AND customer_id=$2",
      [f.user, f.customer],
    );
    await f.root.query(
      "INSERT INTO eoms.organization_admins(user_id,customer_id) VALUES($1,$2)",
      [f.user, f.customer],
    );
    assert.equal(
      (
        await call("enrollment/accept", {
          token: a.secret,
          password: "synthetic-revoked-issuer-password",
        })
      ).status,
      422,
    );
    const b = await invite(f, call, { ...u, revision: a.revision });
    await f.root.query(
      "UPDATE eoms.user_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [b.invitationId],
    );
    assert.equal(
      (
        await call("enrollment/accept", {
          token: b.secret,
          password: "synthetic-expired-invite-password",
        })
      ).status,
      422,
    );
    await f.root.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [f.user, f.hidden],
    );
    const c = await invite(f, call, { ...u, revision: b.revision });
    const admin = await f.root.connect();
    try {
      await admin.query("BEGIN");
      await admin.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.change_reason','Controlled synthetic estate deactivation',true),set_config('app.request_id',$2,true)",
        [f.user, randomUUID()],
      );
      await admin.query(
        "UPDATE eoms.estates SET active=false,lifecycle_version=lifecycle_version+1 WHERE id=$1",
        [f.hidden],
      );
      await admin.query("COMMIT");
    } catch (e) {
      await admin.query("ROLLBACK");
      throw e;
    } finally {
      admin.release();
    }
    assert.equal(
      (
        await call("enrollment/accept", {
          token: c.secret,
          password: "synthetic-rollback-invite-password",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.root.query("SELECT active FROM eoms.users WHERE id=$1", [
          u.targetId,
        ])
      ).rows[0].active,
      false,
    );
    assert.equal(
      (
        await f.root.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          u.targetId,
        ])
      ).rowCount,
      0,
    );
  }));
test("global staged registrations grant no tenant access and cannot bypass bound activation or revive revoked global authority", async () =>
  fixture(async (f, call) => {
    await authorize(f);
    const u = await stage(f, call, { customerId: null, estates: [] });
    const a = await invite(f, call, u, { customerId: null });
    assert.equal(
      (
        await call("lifecycle/change", {
          targetId: u.targetId,
          revision: "0",
          state: "active",
          key: randomUUID(),
          reviewed: true,
          ...reason,
        })
      ).status,
      422,
    );
    // The earlier staged-only guard could be bypassed by deactivating first.
    const abandoned = await stage(f, call, { customerId: null, estates: [] });
    const abandonedInvite = await invite(f, call, abandoned, {
      customerId: null,
    });
    const deactivate = await call("lifecycle/change", {
      targetId: abandoned.targetId,
      revision: "0",
      state: "deactivated",
      key: randomUUID(),
      reviewed: true,
      ...reason,
    });
    assert.equal(deactivate.status, 200);
    const lifecyclePreview = await (
      await call("lifecycle/context?targetId=" + abandoned.targetId)
    ).json();
    assert.equal(lifecyclePreview.target.enrollmentRequired, true);
    const reactivate = await call("lifecycle/change", {
      targetId: abandoned.targetId,
      revision: (await deactivate.json()).revision,
      state: "active",
      key: randomUUID(),
      reviewed: true,
      ...reason,
    });
    assert.equal(reactivate.status, 422);
    // Also cover trigger order when support changes only the active column.
    await assert.rejects(
      f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
        abandoned.targetId,
      ]),
      { code: "23514" },
    );
    await assert.rejects(
      f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
        u.targetId,
      ]),
      { code: "23514" },
    );
    assert.equal(
      (
        await call("enrollment/accept", {
          token: abandonedInvite.secret,
          password: "synthetic-abandoned-enrollment",
        })
      ).status,
      422,
    );
    const unchanged = (
      await f.root.query(
        "SELECT active,lifecycle_state FROM eoms.users WHERE id=$1",
        [abandoned.targetId],
      )
    ).rows[0];
    assert.equal(unchanged.active, false);
    assert.equal(unchanged.lifecycle_state, "deactivated");
    assert.equal(
      (
        await f.root.query(
          "SELECT count(*)::int AS n FROM eoms.security_events WHERE subject_id=$1 AND action='lifecycle.active'",
          [abandoned.targetId],
        )
      ).rows[0].n,
      0,
    );
    await authorize(f, "revoked");
    await authorize(f, "granted");
    assert.equal(
      (
        await call("enrollment/accept", {
          token: a.secret,
          password: "synthetic-global-invite-password",
        })
      ).status,
      422,
    );
    assert.equal(
      (await call("onboarding/context?targetId=" + u.targetId)).status,
      200,
    );
    assert.equal(
      (await call("onboarding/estates?customerId=" + f.customer + "&limit=1"))
        .status,
      200,
    );
  }));
test("reopening an unaccepted registration requires platform and scoped authority, invalidates proof and remains inactive until fresh acceptance", async () =>
  fixture(async (f, call) => {
    const u = await stage(f, call),
      a = await invite(f, call, u);
    await authorize(f);
    const deactivation = await call("lifecycle/change", {
      targetId: u.targetId,
      revision: "0",
      state: "deactivated",
      key: randomUUID(),
      reviewed: true,
      ...reason,
    });
    assert.equal(deactivation.status, 200);
    const recovery = {
      operation: "reopen",
      key: randomUUID(),
      input: {
        customerId: f.customer,
        targetId: u.targetId,
        revision: a.revision,
        reviewed: true,
        ...reason,
      },
    };
    await authorize(f, "revoked");
    assert.equal((await call("onboarding/write", recovery)).status, 403);
    assert.equal((await preview(call, f, u.targetId)).reopenAllowed, false);
    await authorize(f);
    assert.equal((await preview(call, f, u.targetId)).reopenAllowed, true);
    assert.equal(
      (
        await call("onboarding/write", {
          ...recovery,
          input: { ...recovery.input, customerId: randomUUID() },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...recovery,
          input: { ...recovery.input, reviewed: false },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...recovery,
          input: { ...recovery.input, revision: 0 },
        })
      ).status,
      409,
    );
    const restored = await call("onboarding/write", recovery);
    assert.equal(restored.status, 200, await restored.clone().text());
    const result = await restored.json();
    assert.equal(result.state, "staged");
    assert.equal(result.signInEnabled, false);
    assert.equal(result.estateAccessGranted, false);
    const row = (
      await f.root.query(
        "SELECT active,password_hash FROM eoms.users WHERE id=$1",
        [u.targetId],
      )
    ).rows[0];
    assert.equal(row.active, false);
    assert.equal(row.password_hash, "staged-no-credential");
    assert.equal(
      (
        await f.root.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          u.targetId,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await f.root.query(
          "SELECT state FROM eoms.user_invitations WHERE id=$1",
          [a.invitationId],
        )
      ).rows[0].state,
      "superseded",
    );
    assert.equal(
      (
        await call("enrollment/accept", {
          token: a.secret,
          password: "synthetic-old-reopened-invite",
        })
      ).status,
      422,
    );
    assert.equal(
      (await (await call("onboarding/write", recovery)).json()).replayed,
      true,
    );
    assert.equal(
      (
        await call("onboarding/write", {
          ...recovery,
          input: {
            ...recovery.input,
            reason: "Changed recovery intent must be rejected",
          },
        })
      ).status,
      409,
    );
    const b = await invite(f, call, { ...u, revision: result.revision });
    assert.equal(
      (
        await call("enrollment/accept", {
          token: b.secret,
          password: "synthetic-fresh-reopened-invite",
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await call("onboarding/write", recovery)).json()).replayed,
      true,
    );
    assert.equal(
      (
        await f.root.query("SELECT active FROM eoms.users WHERE id=$1", [
          u.targetId,
        ])
      ).rows[0].active,
      true,
    );
    assert.equal((await preview(call, f, u.targetId)).reopenAllowed, false);
    assert.equal(
      (
        await call("onboarding/write", {
          ...recovery,
          key: randomUUID(),
          input: { ...recovery.input, revision: b.revision + 1 },
        })
      ).status,
      409,
    );
    const events = (
      await f.root.query(
        "SELECT * FROM eoms.security_events WHERE subject_id=$1 AND action='registration.reopen'",
        [u.targetId],
      )
    ).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].actor_id, f.user);
    assert.equal(events[0].request_id, result.requestId);
    await assert.rejects(
      f.root.query("DELETE FROM eoms.security_events WHERE id=$1", [
        events[0].id,
      ]),
    );
  }));
async function oidcFlow(f: any, idp: any, secret: string) {
  const start = await fetch(f.apiURL + "/api/auth/enrollment/oidc/start", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5284",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: secret }),
  });
  assert.equal(start.status, 200);
  const authorized = await fetch((await start.json()).authorizationUrl, {
    redirect: "manual",
  });
  const callback = new URL(authorized.headers.get("location")!);
  return fetch(f.apiURL + callback.pathname + callback.search, {
    redirect: "manual",
    headers: {
      Cookie: start.headers
        .getSetCookie()
        .find((c: string) => c.startsWith("eoms_oidc="))!
        .split(";")[0],
    },
  });
}
test("controlled OIDC enrollment requires the explicitly approved subject and verified MFA; accepted identity then signs in", async () => {
  const idp = await controlledIssuer();
  try {
    await fixture(async (f, call) => {
      const u = await stage(f, call),
        a = await invite(f, call, u, {
          method: "oidc",
          subject: "fixture-subject",
        });
      for (const mode of ["no-mfa", "unlinked"]) {
        idp.setMode(mode);
        const denied = await oidcFlow(f, idp, a.secret);
        assert.match(denied.headers.get("location")!, /authError/);
        assert.equal(
          (
            await f.root.query("SELECT active FROM eoms.users WHERE id=$1", [
              u.targetId,
            ])
          ).rows[0].active,
          false,
        );
      }
      idp.setMode("valid");
      const good = await oidcFlow(f, idp, a.secret);
      assert.equal(new URL(good.headers.get("location")!).search, "");
      const cookie = good.headers
        .getSetCookie()
        .find((x: string) => x.startsWith("eoms_session="));
      assert.ok(cookie);
      assert.equal(
        (
          await f.root.query(
            "SELECT user_id FROM eoms.identity_links WHERE issuer=$1 AND subject=$2",
            [idp.config.issuer, "fixture-subject"],
          )
        ).rows[0].user_id,
        u.targetId,
      );
      assert.equal(
        (
          await f.root.query(
            "SELECT * FROM eoms.memberships WHERE user_id=$1",
            [u.targetId],
          )
        ).rowCount,
        2,
      );
      assert.equal(
        (await call("enrollment/oidc/start", { token: a.secret })).status,
        422,
      );
    }, idp.config);
  } finally {
    await idp.close();
  }
});
test("local invitation activation remains forbidden at the production HTTP boundary", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const app = createApp(
      {
        query: async () => {
          throw Error("No database call expected");
        },
      } as any,
      { webOrigin: "http://localhost:5174" },
    );
    const r = await request(app)
      .post("/api/auth/enrollment/accept")
      .set("Origin", "http://localhost:5174")
      .send({
        token: "a".repeat(64),
        password: "synthetic-production-password",
      });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /approved organization invitation/);
  } finally {
    process.env.NODE_ENV = old;
  }
});
