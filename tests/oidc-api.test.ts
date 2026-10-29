import "../apps/api/src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../apps/api/src/app";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { controlledIssuer } from "./oidc-issuer-fixture";
async function fixture(run: (f: any, idp: any, flow: any) => Promise<void>) {
  const idp = await controlledIssuer();
  const f = await upgradedWorkFixture({ appOptions: { oidc: idp.config } });
  try {
    await f.root.query(
      "INSERT INTO eoms.identity_links(issuer,subject,user_id,reference,reason) VALUES($1,'fixture-subject',$2,'Synthetic verified mapping','Explicit synthetic test identity association')",
      [idp.config.issuer, f.user],
    );
    const flow = async () => {
      const start = await fetch(f.apiURL + "/api/auth/oidc/start", {
        method: "POST",
        headers: {
          Origin: "http://localhost:5284",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(start.status, 200);
      const body = await start.json();
      const authorize = await fetch(body.authorizationUrl, {
        redirect: "manual",
      });
      const callback = new URL(authorize.headers.get("location")!);
      const cookie = start.headers
        .getSetCookie()
        .find((c) => c.startsWith("eoms_oidc="))!
        .split(";")[0];
      const complete = (cookieValue = cookie) =>
        fetch(f.apiURL + callback.pathname + callback.search, {
          headers: { Cookie: cookieValue },
          redirect: "manual",
        });
      return { complete, cookie, callback };
    };
    await run(f, idp, flow);
  } finally {
    await f.close();
    await idp.close();
  }
}
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith("eoms_session="))
    ?.split(";")[0];
test("controlled OIDC code/PKCE callback opens only explicitly linked MFA sessions and consumes state once", async () =>
  fixture(async (f, idp, flow) => {
    const before = (
      await f.root.query("SELECT count(*)::int AS n FROM eoms.memberships")
    ).rows[0].n;
    const attempt = await flow(),
      r = await attempt.complete();
    assert.equal(r.status, 303);
    assert.equal(new URL(r.headers.get("location")!).search, "");
    const cookie = sessionCookie(r);
    assert.ok(cookie);
    const own = await fetch(f.apiURL + "/api/auth/sessions", {
      headers: { Cookie: cookie! },
    });
    assert.equal(own.status, 200);
    const data = await own.json();
    assert.equal(data.items.find((s: any) => s.current).mfa, true);
    assert.equal(data.items.find((s: any) => s.current).auth_method, "oidc");
    assert.equal(
      (await f.root.query("SELECT count(*)::int AS n FROM eoms.memberships"))
        .rows[0].n,
      before,
    );
    const replay = await attempt.complete();
    assert.match(replay.headers.get("location")!, /authError/);
    assert.equal(sessionCookie(replay), undefined);
    const event = (
      await f.root.query(
        "SELECT request_id FROM eoms.security_events WHERE subject_id=$1 AND action='sign-in.oidc'",
        [f.user],
      )
    ).rows[0];
    assert.equal(event.request_id, r.headers.get("x-request-id"));
  }));
test("OIDC rejects wrong browser state, invalid nonce/audience/MFA and unlinked subjects without issuing sessions", async () =>
  fixture(async (f, idp, flow) => {
    const attempt = await flow();
    assert.match(
      (await attempt.complete("eoms_oidc=" + "a".repeat(64))).headers.get(
        "location",
      )!,
      /authError/,
    );
    assert.match(
      (
        await attempt.complete(attempt.cookie + "; " + attempt.cookie)
      ).headers.get("location")!,
      /authError/,
    );
    for (const mode of ["nonce", "audience", "no-mfa", "unlinked"]) {
      idp.setMode(mode);
      const next = await flow(),
        r = await next.complete();
      assert.match(r.headers.get("location")!, /authError/);
      assert.equal(sessionCookie(r), undefined);
    }
    assert.equal(
      (
        await f.root.query(
          "SELECT count(*)::int AS n FROM eoms.sessions WHERE auth_method='oidc'",
        )
      ).rows[0].n,
      0,
    );
    assert.ok(
      (
        await f.root.query(
          "SELECT id FROM eoms.security_events WHERE action='oidc.callback-denied' AND subject_id IS NULL",
        )
      ).rowCount >= 6,
    );
  }));
test("OIDC key rotation is usable and explicit identity revocation ends old sessions without revival", async () =>
  fixture(async (f, idp, flow) => {
    const r = await (await flow()).complete(),
      old = sessionCookie(r)!;
    assert.ok(old);
    await f.root.query(
      "UPDATE eoms.identity_links SET active=false WHERE issuer=$1",
      [idp.config.issuer],
    );
    assert.equal(
      (
        await fetch(f.apiURL + "/api/auth/session", {
          headers: { Cookie: old },
        })
      ).status,
      401,
    );
    await f.root.query(
      "UPDATE eoms.identity_links SET active=true WHERE issuer=$1",
      [idp.config.issuer],
    );
    assert.equal(
      (
        await fetch(f.apiURL + "/api/auth/session", {
          headers: { Cookie: old },
        })
      ).status,
      401,
    );
    idp.rotate();
    const fresh = await (await flow()).complete();
    assert.ok(sessionCookie(fresh));
    assert.notEqual(sessionCookie(fresh), old);
  }));
test("production rejects local login/reset and insecure test identity configuration while retaining deployment guard", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const pool = {} as any;
    assert.throws(() =>
      createApp(pool, { oidc: { issuer: "http://127.0.0.1" } as any }),
    );
    const app = createApp(pool);
    const options = await request(app).get("/api/auth/options");
    assert.equal(options.body.localEnabled, false);
    assert.equal(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Origin", "http://localhost:5174")
          .send({ email: "a@b.test", password: "synthetic-password" })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(app)
          .post("/api/auth/recovery/reset")
          .set("Origin", "http://localhost:5174")
          .send({ token: "a".repeat(64), password: "synthetic-new-password" })
      ).status,
      403,
    );
  } finally {
    process.env.NODE_ENV = previous;
  }
});
