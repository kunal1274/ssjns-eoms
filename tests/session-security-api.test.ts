import "../apps/api/src/config.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordHash, hash } from "../apps/api/src/security.ts";
import { upgradedWorkFixture } from "./upgraded-work-fixture.ts";
async function fixture(run: (f: any, login: any, read: any) => Promise<void>) {
  const f = await upgradedWorkFixture();
  try {
    const password = "synthetic-session-password";
    await f.root.query("UPDATE eoms.users SET password_hash=$2 WHERE id=$1", [
      f.user,
      await passwordHash(password),
    ]);
    const email = (
      await f.root.query("SELECT email FROM eoms.users WHERE id=$1", [f.user])
    ).rows[0].email;
    const login = (cookie?: string, wrong = false) =>
      fetch(f.apiURL + "/api/auth/login", {
        method: "POST",
        headers: {
          Origin: "http://localhost:5284",
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({
          email,
          password: wrong ? "incorrect" : password,
        }),
      });
    const read = (cookie: string) =>
      fetch(f.apiURL + "/api/auth/session", { headers: { Cookie: cookie } });
    await run(f, login, read);
  } finally {
    await f.close();
  }
}
function cookie(r: Response) {
  const value = r.headers.get("set-cookie")!;
  assert.match(value, /HttpOnly/i);
  assert.match(value, /SameSite=Strict/i);
  assert.match(value, /Path=\/api/i);
  return value.split(";")[0];
}
test("successful sign-in rotates the presented session and CSRF atomically; failed sign-in preserves it", async () =>
  fixture(async (f, login, read) => {
    const first = await login();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-store");
    const old = cookie(first),
      firstBody = await first.json();
    assert.equal((await login(old, true)).status, 401);
    assert.equal((await read(old)).status, 200);
    const second = await login(old);
    assert.equal(second.status, 200);
    const current = cookie(second),
      secondBody = await second.json();
    assert.notEqual(current, old);
    assert.notEqual(secondBody.csrf, firstBody.csrf);
    assert.equal((await read(old)).status, 401);
    assert.equal((await read(current)).status, 200);
    assert.equal((await read(current + "; " + current)).status, 401);
    assert.equal(
      (
        await f.root.query(
          "SELECT token_hash FROM eoms.sessions WHERE user_id=$1",
          [f.user],
        )
      ).rows[0].token_hash,
      hash(current.split("=")[1]),
    );
  }));
test("suspension and restoration cannot revive sessions; credential change invalidates every session", async () =>
  fixture(async (f, login, read) => {
    const a = cookie(await login()),
      b = cookie(await login());
    await f.root.query("UPDATE eoms.users SET active=false WHERE id=$1", [
      f.user,
    ]);
    assert.equal((await read(a)).status, 401);
    assert.equal((await login()).status, 401);
    await f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
      f.user,
    ]);
    assert.equal((await read(a)).status, 401);
    assert.equal((await read(b)).status, 401);
    const c = cookie(await login()),
      d = cookie(await login());
    await f.root.query("UPDATE eoms.users SET password_hash=$2 WHERE id=$1", [
      f.user,
      await passwordHash("synthetic-new-password"),
    ]);
    assert.equal((await read(c)).status, 401);
    assert.equal((await read(d)).status, 401);
    assert.equal((await login()).status, 401);
  }));
test("expired sessions and cross-session CSRF fail closed with correlated no-store responses", async () =>
  fixture(async (f, login, read) => {
    const a = await login(),
      aBody = await a.json(),
      aCookie = cookie(a),
      b = await login(),
      bCookie = cookie(b);
    const denied = await fetch(f.apiURL + "/api/auth/logout", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5284",
        Cookie: bCookie,
        "X-CSRF-Token": aBody.csrf,
      },
    });
    assert.equal(denied.status, 403);
    assert.equal((await read(bCookie)).status, 200);
    await f.root.query(
      "UPDATE eoms.sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [hash(aCookie.split("=")[1])],
    );
    const expired = await read(aCookie);
    assert.equal(expired.status, 401);
    assert.equal(expired.headers.get("cache-control"), "no-store");
    assert.equal(
      (await expired.json()).requestId,
      expired.headers.get("x-request-id"),
    );
    assert.equal((await read(bCookie)).status, 200);
  }));

test("session issuance revalidates credentials and rolls back rotation when replacement insertion fails", async () =>
  fixture(async (f, login, read) => {
    const a = cookie(await login()),
      b = cookie(await login());
    const verified = (
      await f.root.query("SELECT password_hash FROM eoms.users WHERE id=$1", [
        f.user,
      ])
    ).rows[0].password_hash;
    const issue = (credential: string, replacement: string) =>
      f.runtime.query(
        "SELECT eoms.open_verified_session($1,$2,$3,$4,$5) AS opened",
        [
          f.user,
          credential,
          replacement,
          "c".repeat(64),
          hash(a.split("=")[1]),
        ],
      );
    assert.equal(
      (await issue("stale-credential", "d".repeat(64))).rows[0].opened,
      false,
    );
    assert.equal((await read(a)).status, 200);
    await assert.rejects(
      issue(verified, hash(b.split("=")[1])),
      (error: any) => error.code === "23505",
    );
    assert.equal((await read(a)).status, 200);
    assert.equal((await read(b)).status, 200);
    await assert.rejects(
      issue(verified, "bad-token"),
      (error: any) => error.code === "22023",
    );
    assert.equal((await read(a)).status, 200);
  }));
