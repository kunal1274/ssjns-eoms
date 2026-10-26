import "../apps/api/src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import {
  freshSyntheticSession,
  independentSourceReviewer,
} from "./source-review-fixture";
import { hash, token, passwordHash } from "../apps/api/src/security";
const exec = promisify(execFile);
async function fixture(run: (f: any, call: any) => Promise<void>) {
  const f: any = await upgradedWorkFixture();
  f.csrf = "synthetic-history-ui";
  try {
    const call = (path: string, body?: unknown, raw = f.raw, csrf = f.csrf) =>
      fetch(f.apiURL + "/api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: "eoms_session=" + raw,
          Origin: "http://localhost:5284",
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
async function passwordAccount(f: any) {
  const password = "synthetic-initial-password";
  await f.root.query("UPDATE eoms.users SET password_hash=$2 WHERE id=$1", [
    f.user,
    await passwordHash(password),
  ]);
  const email = (
    await f.root.query("SELECT email FROM eoms.users WHERE id=$1", [f.user])
  ).rows[0].email;
  const login = async (p = password) => {
    const r = await fetch(f.apiURL + "/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5284",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: p }),
    });
    if (r.ok) {
      f.raw = r.headers.get("set-cookie")!.split(";")[0].split("=")[1];
      f.csrf = (await r.json()).csrf;
    }
    return r;
  };
  await login();
  return { login, email, password };
}
test("own session inventory is paged and private; runtime cannot read credential/session/audit storage", async () =>
  fixture(async (f, call) => {
    const peer = await independentSourceReviewer(f);
    for (let i = 0; i < 3; i++) await freshSyntheticSession(f, f.user);
    const first = await call("auth/sessions?limit=2");
    assert.equal(first.status, 200);
    const a = await first.json();
    assert.equal(a.items.length, 2);
    assert.ok(a.nextCursor);
    const b = await (
      await call("auth/sessions?limit=2&cursor=" + a.nextCursor)
    ).json();
    assert.equal(new Set([...a.items, ...b.items].map((s) => s.id)).size, 4);
    assert.equal(
      (
        await call(
          "auth/sessions?limit=2&cursor=" + a.nextCursor,
          undefined,
          peer.raw,
        )
      ).status,
      422,
    );
    assert.equal((await call("auth/sessions?userId=" + peer.id)).status, 422);
    assert.doesNotMatch(
      JSON.stringify(a),
      /token_hash|password_hash|csrf|synthetic-history/,
    );
    for (const sql of [
      "SELECT * FROM eoms.sessions",
      "SELECT password_hash FROM eoms.users",
      "SELECT * FROM eoms.security_events",
      "SELECT * FROM eoms.identity_links",
      "SELECT * FROM eoms.recovery_tokens",
    ])
      await assert.rejects(
        f.runtime.query(sql),
        (e: any) => e.code === "42501",
      );
  }));
test("selected session revocation is scoped exact-retry safe and has immutable actual audit", async () =>
  fixture(async (f, call) => {
    const other = await freshSyntheticSession(f, f.user),
      peer = await independentSourceReviewer(f),
      sid = (
        await f.root.query("SELECT id FROM eoms.sessions WHERE token_hash=$1", [
          hash(other),
        ])
      ).rows[0].id;
    const input = { key: randomUUID(), targetId: sid, allOthers: false };
    const r = await call("auth/sessions/revoke", input);
    assert.equal(r.status, 200);
    const receipt = await r.json();
    assert.equal(receipt.count, 1);
    assert.equal(receipt.requestId, r.headers.get("x-request-id"));
    assert.equal((await call("auth/session", undefined, other)).status, 401);
    assert.equal((await call("auth/session", undefined, peer.raw)).status, 200);
    const fresh = await freshSyntheticSession(f, f.user),
      replay = await (await call("auth/sessions/revoke", input)).json();
    assert.equal(replay.eventId, receipt.eventId);
    assert.equal(replay.replayed, true);
    assert.equal((await call("auth/session", undefined, fresh)).status, 200);
    assert.equal(
      (
        await call("auth/sessions/revoke", {
          ...input,
          allOthers: true,
          targetId: null,
        })
      ).status,
      409,
    );
    const foreign = (
      await f.root.query("SELECT id FROM eoms.sessions WHERE token_hash=$1", [
        hash(peer.raw),
      ])
    ).rows[0].id;
    assert.equal(
      (
        await call("auth/sessions/revoke", {
          key: randomUUID(),
          targetId: foreign,
          allOthers: false,
        })
      ).status,
      403,
    );
    const audit = (
      await f.root.query("SELECT * FROM eoms.security_events WHERE id=$1", [
        receipt.eventId,
      ])
    ).rows[0];
    assert.equal(audit.actor_id, f.user);
    assert.equal(audit.subject_id, f.user);
    assert.equal(audit.action, "session.revoked");
    await assert.rejects(
      f.root.query("UPDATE eoms.security_events SET action=$2 WHERE id=$1", [
        receipt.eventId,
        "fabricated",
      ]),
      (e: any) => e.code === "42501",
    );
  }));
test("concurrent revocation retries recover one event and do not revoke sessions created after its receipt", async () =>
  fixture(async (f, call) => {
    await freshSyntheticSession(f, f.user);
    const input = { key: randomUUID(), targetId: null, allOthers: true };
    const replies = await Promise.all([
      call("auth/sessions/revoke", input),
      call("auth/sessions/revoke", input),
    ]);
    assert.deepEqual(
      replies.map((r) => r.status),
      [200, 200],
    );
    const receipts = await Promise.all(replies.map((r) => r.json()));
    assert.equal(receipts[0].eventId, receipts[1].eventId);
    const fresh = await freshSyntheticSession(f, f.user);
    await call("auth/sessions/revoke", input);
    assert.equal((await call("auth/session", undefined, fresh)).status, 200);
    assert.equal((await call("auth/session")).status, 200);
  }));
test("sign out everywhere invalidates all current sessions while preserving other accounts and later fresh sign-in", async () =>
  fixture(async (f, call) => {
    const other = await freshSyntheticSession(f, f.user),
      peer = await independentSourceReviewer(f);
    assert.equal((await call("auth/sign-out-all", {})).status, 204);
    for (const raw of [f.raw, other])
      assert.equal((await call("auth/session", undefined, raw)).status, 401);
    assert.equal((await call("auth/sign-out-all", {})).status, 401);
    assert.equal((await call("auth/session", undefined, peer.raw)).status, 200);
    const fresh = await freshSyntheticSession(f, f.user);
    assert.equal((await call("auth/session", undefined, fresh)).status, 200);
  }));
test("shared attempt counters and idle expiry are enforced; maintenance keeps active sessions and all history", async () =>
  fixture(async (f, call) => {
    const key = hash(randomUUID());
    const checks = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.runtime.query("SELECT eoms.auth_attempt_allowed($1,2) AS allowed", [
          key,
        ]),
      ),
    );
    assert.equal(checks.filter((r) => r.rows[0].allowed).length, 2);
    const old = await freshSyntheticSession(f, f.user);
    await f.root.query(
      "UPDATE eoms.sessions SET last_seen_at=now()-interval '31 minutes' WHERE token_hash=$1",
      [hash(old)],
    );
    assert.equal((await call("auth/session", undefined, old)).status, 401);
    const count = (
      await f.root.query("SELECT count(*)::int AS n FROM eoms.security_events")
    ).rows[0].n;
    await exec(
      process.execPath,
      ["--import", "tsx", "scripts/cleanup-auth-state.ts"],
      {
        env: {
          ...process.env,
          ADMIN_DATABASE_URL: f.root.options.connectionString,
        },
      },
    );
    assert.equal((await call("auth/session")).status, 200);
    assert.equal(
      (
        await f.root.query(
          "SELECT count(*)::int AS n FROM eoms.security_events",
        )
      ).rows[0].n,
      count,
    );
  }));
test("credential change verifies the old password and ends every session with an actual request audit", async () =>
  fixture(async (f, call) => {
    const account = await passwordAccount(f),
      other = await freshSyntheticSession(f, f.user),
      original = f.raw;
    assert.equal(
      (
        await call("auth/password", {
          currentPassword: "wrong",
          newPassword: "synthetic-replacement-password",
        })
      ).status,
      403,
    );
    const r = await call("auth/password", {
      currentPassword: account.password,
      newPassword: "synthetic-replacement-password",
    });
    assert.equal(r.status, 200);
    assert.equal((await call("auth/session", undefined, original)).status, 401);
    assert.equal((await call("auth/session", undefined, other)).status, 401);
    assert.equal((await account.login()).status, 401);
    assert.equal(
      (await account.login("synthetic-replacement-password")).status,
      200,
    );
    const events = await (await call("auth/events")).json();
    assert.ok(
      events.items.some(
        (e: any) =>
          e.action === "credential.changed" &&
          e.request_id === r.headers.get("x-request-id"),
      ),
    );
  }));
test("recovery guidance does not enumerate; operator-issued token is single-use and invalidates previous sessions", async () =>
  fixture(async (f, call) => {
    const account = await passwordAccount(f),
      original = f.raw;
    const a = await (
        await call("auth/recovery", { email: account.email })
      ).json(),
      b = await (
        await call("auth/recovery", { email: "unknown@fixture.local" })
      ).json();
    assert.equal(a.message, b.message);
    assert.equal(a.token, undefined);
    const issued = await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/issue-recovery.ts",
        f.user,
        "Synthetic support ticket",
        "Synthetic declared identity check for controlled recovery",
      ],
      {
        env: {
          ...process.env,
          ADMIN_DATABASE_URL: f.root.options.connectionString,
          NODE_ENV: "test",
        },
      },
    );
    const secret = JSON.parse(issued.stdout).token;
    assert.ok(/^[a-f0-9]{64}$/.test(secret));
    const reset = await call("auth/recovery/reset", {
      token: secret,
      password: "synthetic-recovered-password",
    });
    assert.equal(reset.status, 200);
    assert.equal((await call("auth/session", undefined, original)).status, 401);
    assert.equal(
      (
        await call("auth/recovery/reset", {
          token: secret,
          password: "synthetic-second-password",
        })
      ).status,
      422,
    );
    assert.equal(
      (await account.login("synthetic-recovered-password")).status,
      200,
    );
  }));
test("expired or stale recovery proof cannot change credentials or activate a suspended account", async () =>
  fixture(async (f, call) => {
    await passwordAccount(f);
    const raw = token(),
      credential = (
        await f.root.query("SELECT password_hash FROM eoms.users WHERE id=$1", [
          f.user,
        ])
      ).rows[0].password_hash;
    await f.root.query(
      "INSERT INTO eoms.recovery_tokens VALUES($1,$2,$3,now()-interval '1 second',now())",
      [hash(raw), f.user, credential],
    );
    assert.equal(
      (
        await call("auth/recovery/reset", {
          token: raw,
          password: "synthetic-never-applied",
        })
      ).status,
      422,
    );
    await f.root.query(
      "UPDATE eoms.recovery_tokens SET expires_at=now()+interval '1 hour' WHERE token_hash=$1",
      [hash(raw)],
    );
    await f.root.query("UPDATE eoms.users SET active=false WHERE id=$1", [
      f.user,
    ]);
    assert.equal(
      (
        await call("auth/recovery/reset", {
          token: raw,
          password: "synthetic-never-applied",
        })
      ).status,
      422,
    );
    await f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
      f.user,
    ]);
    assert.equal(
      (
        await call("auth/recovery/reset", {
          token: raw,
          password: "synthetic-never-applied",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await f.root.query("SELECT password_hash FROM eoms.users WHERE id=$1", [
          f.user,
        ])
      ).rows[0].password_hash,
      credential,
    );
  }));
test("concurrent fresh sign-in and revoke-others follow the user-lock event order", async () =>
  fixture(async (f, call) => {
    const raw = token(),
      input = { key: randomUUID(), targetId: null, allOthers: true };
    const [revoke, opened] = await Promise.all([
      call("auth/sessions/revoke", input),
      f.runtime.query(
        "SELECT eoms.open_verified_session($1,$2,$3,$4,NULL) AS opened",
        [f.user, "not-a-login-password", hash(raw), token()],
      ),
    ]);
    assert.equal(revoke.status, 200);
    assert.equal(opened.rows[0].opened, true);
    const receipt = await revoke.json();
    const loginEvent = (
      await f.root.query(
        "SELECT id FROM eoms.security_events WHERE subject_id=$1 AND action='sign-in.local' ORDER BY id DESC LIMIT 1",
        [f.user],
      )
    ).rows[0];
    assert.equal(
      (await call("auth/session", undefined, raw)).status,
      BigInt(loginEvent.id) > BigInt(receipt.eventId) ? 200 : 401,
    );
  }));
test("global administrative revocation requires a distinct explicit appointment and preserves exact retries after fresh sign-in", async () =>
  fixture(async (f, call) => {
    const peer = await independentSourceReviewer(f);
    assert.equal(
      (await (await call("auth/admin/context")).json()).allowed,
      false,
    );
    assert.equal(
      (await call("auth/admin/context?targetId=" + peer.id)).status,
      403,
    );
    const authority = async (action: string) =>
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/authorize-security-operator.ts",
          f.user,
          action,
          "Synthetic security authority",
          "Explicit controlled global session revocation mandate",
        ],
        {
          env: {
            ...process.env,
            ADMIN_DATABASE_URL: f.root.options.connectionString,
          },
        },
      );
    await authority("granted");
    const preview = await (
      await call("auth/admin/context?targetId=" + peer.id)
    ).json();
    assert.equal(preview.allowed, true);
    const input = {
      targetId: peer.id,
      revision: preview.target.revision,
      key: randomUUID(),
      reference: "Synthetic security incident",
      reason: "Independently authorized global session revocation",
    };
    const r = await call("auth/admin/revoke", input);
    assert.equal(r.status, 200);
    const receipt = await r.json();
    assert.equal(receipt.count, 1);
    assert.equal((await call("auth/session", undefined, peer.raw)).status, 401);
    const fresh = await freshSyntheticSession(f, peer.id);
    const replay = await (await call("auth/admin/revoke", input)).json();
    assert.equal(replay.eventId, receipt.eventId);
    assert.equal(replay.replayed, true);
    assert.equal((await call("auth/session", undefined, fresh)).status, 200);
    assert.equal(
      (await call("auth/admin/revoke", { ...input, key: randomUUID() })).status,
      409,
    );
    const event = (
      await f.root.query(
        "SELECT subject_id,actor_id FROM eoms.security_events WHERE id=$1",
        [receipt.eventId],
      )
    ).rows[0];
    assert.equal(event.subject_id, peer.id);
    assert.equal(event.actor_id, f.user);
    await authority("revoked");
    assert.equal((await call("auth/admin/revoke", input)).status, 403);
    await assert.rejects(
      f.runtime.query("SELECT * FROM eoms.platform_security_authority"),
      (e: any) => e.code === "42501",
    );
  }));
test("restoring a suspended security operator cannot restore the old appointment", async () =>
  fixture(async (f, call) => {
    await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/authorize-security-operator.ts",
        f.user,
        "granted",
        "Synthetic scope authority",
        "Explicit controlled revocation authority",
      ],
      {
        env: {
          ...process.env,
          ADMIN_DATABASE_URL: f.root.options.connectionString,
        },
      },
    );
    assert.equal(
      (await (await call("auth/admin/context")).json()).allowed,
      true,
    );
    await f.root.query("UPDATE eoms.users SET active=false WHERE id=$1", [
      f.user,
    ]);
    await f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
      f.user,
    ]);
    f.raw = await freshSyntheticSession(f, f.user);
    assert.equal(
      (await (await call("auth/admin/context")).json()).allowed,
      false,
    );
  }));
