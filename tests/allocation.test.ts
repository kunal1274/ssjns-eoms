import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateHundredths } from "../packages/domain/allocation.ts";
test("equal allocation conserves area at hundredths precision", () =>
  assert.deepEqual(allocateHundredths(2, ["a", "b", "c"]), {
    a: 67,
    b: 67,
    c: 66,
  }));
test("invalid quantities and duplicate workers fail", () => {
  for (const q of [0, -1, NaN, Infinity, 2.001])
    assert.throws(() => allocateHundredths(q, ["a"]));
  assert.throws(() => allocateHundredths(2, []));
  assert.throws(() => allocateHundredths(2, ["a", "a"]));
});
