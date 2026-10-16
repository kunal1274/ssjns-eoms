import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Pool } from "pg";
import { z } from "zod";
import { createApp } from "../apps/api/src/app.ts";
import {
  ApiError,
  classifyError,
  type FailureEvent,
} from "../apps/api/src/http.ts";
const origin = "http://localhost:5174";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fixture(failure?: unknown) {
  const events: FailureEvent[] = [];
  let calls = 0;
  const pool = {
    query: async () => {
      calls++;
      if (failure) throw failure;
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  return {
    app: createApp(pool, { log: (e) => events.push(e) }),
    events,
    get calls() {
      return calls;
    },
  };
}
function contract(response: any, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(typeof response.body.error, "string");
  assert.equal(response.body.code, code);
  assert.match(response.body.requestId, uuid);
  assert.equal(response.headers["x-request-id"], response.body.requestId);
  assert.equal(response.headers["cache-control"], "no-store");
}
test("correlation IDs are server generated, available on success and ignore inbound claims", async () => {
  const f = fixture(),
    claim = "11111111-1111-4111-8111-111111111111";
  const a = await request(f.app).get("/api/health").set("X-Request-ID", claim);
  assert.equal(a.status, 200);
  assert.match(a.headers["x-request-id"], uuid);
  assert.notEqual(a.headers["x-request-id"], claim);
  const b = await request(f.app).get("/api/health");
  assert.notEqual(a.headers["x-request-id"], b.headers["x-request-id"]);
  assert.deepEqual(f.events, []);
});
test("unexpected failures do not disclose SQL, credentials, cookies, query strings or raw exceptions", async () => {
  const secrets = [
    "db_password_secret",
    "session_token_secret",
    "wage_987654",
    "worker_private@example.test",
    "forged_request_secret",
  ];
  const internal = Object.assign(
    new Error(secrets.join(" ") + " SELECT * FROM eoms.users"),
    {
      detail: secrets[0],
      stack: "private stack " + secrets[1],
      code: "private_error_code",
    },
  );
  const f = fixture(internal);
  const r = await request(f.app)
    .get("/api/health?password=" + secrets[0])
    .set("Cookie", "private=" + secrets[1])
    .set("Authorization", "Bearer " + secrets[2])
    .set("X-Request-ID", secrets[4]);
  contract(r, 500, "INTERNAL_ERROR");
  const output = JSON.stringify({
    body: r.body,
    headers: r.headers,
    events: f.events,
  });
  for (const secret of secrets) assert.ok(!output.includes(secret));
  assert.ok(!output.includes("eoms.users"));
  assert.equal(f.events[0].requestId, r.body.requestId);
  assert.deepEqual(Object.keys(f.events[0]).sort(), [
    "code",
    "event",
    "method",
    "requestId",
    "status",
  ]);
});
test("strict-schema validation returns a bounded generic message without reflecting attacker-controlled keys or enum values", async () => {
  const f = fixture();
  const r = await request(f.app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({
      email: "secret_invalid_email",
      password: "secret_password",
      private_unknown_field: "secret_value",
    });
  contract(r, 422, "VALIDATION_FAILED");
  const output = JSON.stringify({ body: r.body, events: f.events });
  for (const value of [
    "secret_invalid_email",
    "secret_password",
    "private_unknown_field",
    "secret_value",
  ])
    assert.ok(!output.includes(value));
  assert.equal(f.calls, 0);
});
test("JSON syntax and body-size errors use the same safe response contract before authentication", async () => {
  const f = fixture();
  const malformed = await request(f.app)
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .set("Origin", origin)
    .send('{"password":"unclosed_secret');
  contract(malformed, 400, "BAD_REQUEST");
  const tooLarge = await request(f.app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ password: "secret".repeat(12000) });
  contract(tooLarge, 413, "PAYLOAD_TOO_LARGE");
  assert.ok(!JSON.stringify(f.events).includes("secret"));
  assert.equal(f.calls, 0);
});
test("origin/session denials preserve existing statuses and safe human-readable error string", async () => {
  const f = fixture();
  const originDenied = await request(f.app)
    .post("/api/auth/login")
    .set("Origin", "https://attacker.invalid")
    .send({ email: "private@example.test", password: "passwordsecret" });
  contract(originDenied, 403, "ORIGIN_REJECTED");
  assert.equal(originDenied.body.error, "Untrusted request origin");
  const anonymous = await request(f.app).get("/api/estates");
  contract(anonymous, 401, "UNAUTHENTICATED");
  assert.equal(anonymous.body.error, "Sign in to continue");
  assert.equal(f.calls, 0);
});
test("database classification is deterministic and contains no raw database metadata", () => {
  for (const [db, status, code] of [
    ["23503", 422, "INVALID_REFERENCE"],
    ["23505", 409, "DUPLICATE_RECORD"],
    ["42501", 403, "FORBIDDEN"],
    ["40001", 409, "CONFLICT"],
    ["40P01", 409, "CONFLICT"],
    ["08006", 503, "SERVICE_UNAVAILABLE"],
    ["ECONNREFUSED", 503, "SERVICE_UNAVAILABLE"],
  ] as const) {
    const result = classifyError({
      code: db,
      message: "secret_schema",
      constraint: "private_constraint",
      detail: "private_bank",
    });
    assert.equal(result.status, status);
    assert.equal(result.code, code);
    assert.ok(!JSON.stringify(result).includes("private"));
  }
  assert.ok(
    !classifyError(new ApiError(500, "private_db_detail")).error.includes(
      "private",
    ),
  );
  assert.equal(
    classifyError(new ApiError(409, "Conflict", "private_code" as any)).code,
    "CONFLICT",
  );
  const result = classifyError(
    z.enum(["secret_value"]).safeParse("other_secret").error,
  );
  assert.equal(result.code, "VALIDATION_FAILED");
  assert.ok(!result.error.includes("secret"));
});
test("CSRF, unknown-route and throttling responses are correlated JSON", async () => {
  const pool = {
    query: async () => ({
      rowCount: 1,
      rows: [
        { id: "actor", csrf: "expected_secret", email: "private@example.test" },
      ],
    }),
  } as unknown as Pool;
  const events: FailureEvent[] = [];
  const app = createApp(pool, { log: (e) => events.push(e) });
  const cookie = "eoms_session=" + "a".repeat(64);
  const denied = await request(app)
    .post("/api/auth/logout")
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send({});
  contract(denied, 403, "CSRF_REJECTED");
  const absent = await request(app)
    .get("/api/unknown-route")
    .set("Cookie", cookie);
  contract(absent, 404, "NOT_FOUND");
  let throttled;
  for (let i = 0; i < 21; i++)
    throttled = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({});
  contract(throttled, 429, "RATE_LIMITED");
  assert.ok(!JSON.stringify(events).includes("expected_secret"));
});
test("logging sink failure does not expose exception details or break the response contract", async () => {
  const pool = {
    query: async () => {
      throw Error("private database detail");
    },
  } as unknown as Pool;
  const app = createApp(pool, {
    log: () => {
      throw Error("private logger detail");
    },
  });
  const r = await request(app).get("/api/health");
  contract(r, 500, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(r.body).includes("private"));
});

test("database relationship checks return safe validation guidance without SQL detail", () => {
  const result = classifyError({
    code: "23514",
    detail: "PRIVATE-SQL-ROW",
    constraint: "private_constraint",
  });
  assert.equal(result.status, 422);
  assert.equal(result.code, "VALIDATION_FAILED");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private_constraint/);
});
