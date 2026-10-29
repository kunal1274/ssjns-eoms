import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordHash, verifyPassword } from "../apps/api/src/security.ts";
import { sessionCookie } from "../apps/api/src/session-cookie.ts";
test("session cookies accept one exact opaque token and reject ambiguous or malformed claims", () => {
  const raw = "a".repeat(64);
  assert.equal(sessionCookie("theme=dark; eoms_session=" + raw), raw);
  for (const header of [
    undefined,
    "",
    "eoms_session=",
    "eoms_session=" + raw.toUpperCase(),
    "eoms_session=" + raw + "0",
    "eoms_session=" + raw + "; eoms_session=" + raw,
    "eoms_session=%61" + raw.slice(1),
  ])
    assert.equal(sessionCookie(header), null);
});
test("password verification rejects malformed algorithms and trailing or truncated hashes", async () => {
  const password = "synthetic-only-password",
    first = await passwordHash(password),
    second = await passwordHash(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("incorrect", first), false);
  for (const corrupt of [
    "",
    first.replace("scrypt:", "unknown:"),
    first + ":extra",
    first.slice(0, -1),
    "scrypt:zz:zz",
  ])
    assert.equal(await verifyPassword(password, corrupt), false);
});
