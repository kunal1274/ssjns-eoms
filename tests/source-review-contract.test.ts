import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sourceReviewInput } from "../packages/domain/source-review";
const input = () => ({
  key: randomUUID(),
  expectedRevision: 0,
  outcome: "insufficient",
  originalExamined: false,
  sourceRef: "Controlled archive / document A",
  reason: "Need independently confirmed custody reference",
});
test("provenance observations require bounded explicit outcome original-examination statement and canonical retry identity", () => {
  const v = input();
  assert.equal(
    sourceReviewInput.parse({ ...v, key: v.key.toUpperCase() }).key,
    v.key,
  );
  for (const bad of [
    { ...v, expectedRevision: -1 },
    { ...v, expectedRevision: 2147483647 },
    { ...v, outcome: "approved" },
    { ...v, originalExamined: undefined },
    { ...v, outcome: "corroborated" },
    { ...v, sourceRef: "x" },
    { ...v, sourceRef: "x".repeat(241) },
    { ...v, reason: "x".repeat(501) },
  ])
    assert.equal(sourceReviewInput.safeParse(bad).success, false);
  assert.equal(
    sourceReviewInput.safeParse({
      ...v,
      outcome: "corroborated",
      originalExamined: true,
    }).success,
    true,
  );
});
test("provenance callers cannot claim reviewer scope request identity revision lineage or mapping authorization", () => {
  for (const extra of [
    { reviewerId: randomUUID() },
    { previousId: randomUUID() },
    { sourceAuthenticityVerified: true },
    { applied: true },
    { approved: true },
    { requestId: randomUUID() },
  ])
    assert.equal(
      sourceReviewInput.safeParse({ ...input(), ...extra }).success,
      false,
    );
});
