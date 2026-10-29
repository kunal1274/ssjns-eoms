import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  overlayAuthorityInput,
  overlayExecutionInput,
} from "../packages/domain/mapping-overlay";
test("overlay authority requires explicit subject purpose revision reference without client supplied decision or scope claims", () => {
  const body = {
    key: randomUUID(),
    subjectId: randomUUID(),
    purpose: "apply",
    expectedRevision: 0,
    action: "appointed",
    reference: "Owner authority reference",
    reason: "Exact request authorization",
  };
  assert.equal(overlayAuthorityInput.safeParse(body).success, true);
  for (const change of [
    { decisionId: randomUUID() },
    { purpose: "admin" },
    { expectedRevision: -1 },
    { reference: "" },
    { scopeRevision: 0 },
  ])
    assert.equal(
      overlayAuthorityInput.safeParse({ ...body, ...change }).success,
      false,
    );
});
test("overlay execution binds explicit authority and exact compensation receipt without allowing row overrides or unattended execution", () => {
  const body = {
    key: randomUUID(),
    authorityId: randomUUID(),
    operation: "apply",
    previousId: null,
    reference: "Controlled execution",
    reason: "Examined independent approval",
    examined: true,
  };
  assert.equal(overlayExecutionInput.safeParse(body).success, true);
  for (const change of [
    { examined: false },
    { rows: [] },
    { force: true },
    { operation: "compensate" },
    { previousId: randomUUID() },
  ])
    assert.equal(
      overlayExecutionInput.safeParse({ ...body, ...change }).success,
      false,
    );
  assert.equal(
    overlayExecutionInput.safeParse({
      ...body,
      operation: "compensate",
      previousId: randomUUID(),
    }).success,
    true,
  );
});
