import { test } from "node:test";
import assert from "node:assert/strict";
import { readLedgerPage } from "../apps/api/src/decision-ledgers";
const binding = {
  route: "move",
  actor: "actor-a",
  scope: "customer-a",
  q: "literal %_",
};
const upper = {
  at: "2026-10-18T03:00:00.123456Z",
  id: "f0000000-0000-4000-8000-000000000001",
};
const key = {
  at: "2026-10-18T03:00:00.123455Z",
  id: "f0000000-0000-4000-8000-000000000002",
};
const encode = (x: unknown) =>
  Buffer.from(JSON.stringify(x)).toString("base64url");
test("ledger cursors retain microsecond order and validate request boundary with stable UUID ties", () => {
  const raw = encode({ v: 1, binding: JSON.stringify(binding), key, upper });
  assert.deepEqual(readLedgerPage(raw, binding), {
    v: 1,
    binding: JSON.stringify(binding),
    key,
    upper,
  });
  assert.equal(readLedgerPage(undefined, binding), null);
  assert.throws(() =>
    readLedgerPage(
      encode({
        v: 1,
        binding: JSON.stringify(binding),
        key: { ...key, at: "2026-10-18T03:00:00.123457Z" },
        upper,
      }),
      binding,
    ),
  );
});
test("ledger cursors bind account route scope and all filters instead of acting as read authority", () => {
  const raw = encode({ v: 1, binding: JSON.stringify(binding), key, upper });
  for (const change of [
    { actor: "b" },
    { scope: "b" },
    { route: "cancellation" },
    { q: "other" },
    { status: "pending" },
  ])
    assert.throws(() => readLedgerPage(raw, { ...binding, ...change }));
});
test("malformed ledger cursor dates keys schemas and encodings fail safely without reflecting private input", () => {
  for (const raw of [
    "private-token!",
    encode({
      v: 1,
      binding: JSON.stringify(binding),
      key: { ...key, at: "2026-02-30T03:00:00.123456Z" },
      upper,
    }),
    encode({
      v: 1,
      binding: JSON.stringify(binding),
      key: { ...key, id: "private-key" },
      upper,
    }),
    encode({
      v: 1,
      binding: JSON.stringify(binding),
      key,
      upper,
      extra: "private-secret",
    }),
  ]) {
    assert.throws(
      () => readLedgerPage(raw, binding),
      (e: any) => e.status === 422 && !/private/.test(e.message),
    );
  }
});
