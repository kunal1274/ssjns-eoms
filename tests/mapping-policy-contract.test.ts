import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  policyContent,
  policyDocument,
  policyProposalInput,
  policyReviewInput,
  policyGuardrails,
} from "../packages/domain/mapping-policy";
const content = {
  version: 1,
  basis: "mapping-policy-r0",
  scope: "design-review-only",
  custodyCriteria: "Controlled original with named custody reference",
  approverCriteria: "Separately authorized independent estate approver",
  evidenceCriteria: "Resolve every current concern and source identity",
};
test("policy contract fixes R0 safeguards and rejects activation unknown fields and unbounded or missing criteria", () => {
  assert.equal(policyDocument(content).guardrails.length, 8);
  assert.deepEqual(
    policyDocument({
      ...content,
      custodyCriteria: "  " + content.custodyCriteria + "  ",
    }),
    policyDocument(content),
  );
  for (const patch of [
    { scope: "production" },
    { applicationEnabled: true },
    { guardrails: [] },
    { custodyCriteria: "short" },
    { approverCriteria: "x".repeat(2001) },
    { evidenceCriteria: null },
  ])
    assert.equal(
      policyContent.safeParse({ ...content, ...patch }).success,
      false,
    );
  assert.equal(policyGuardrails.length, 8);
  assert.equal(
    policyProposalInput.safeParse({
      key: randomUUID(),
      expectedRevision: 0,
      reason: "Prepare design review",
      content,
    }).success,
    true,
  );
  assert.equal(
    policyProposalInput.safeParse({
      key: randomUUID(),
      expectedRevision: -1,
      reason: "Prepare design review",
      content,
    }).success,
    false,
  );
});
test("review contract binds an exact digest and explicit non-authorizing outcome reference and reason", () => {
  const input = {
    key: randomUUID(),
    expectedRevision: 0,
    policySha256: "a".repeat(64),
    outcome: "support-for-design",
    reference: "Synthetic owner discussion",
    reason: "Support implementation design only",
  };
  assert.equal(policyReviewInput.safeParse(input).success, true);
  for (const patch of [
    { outcome: "approved" },
    { policySha256: "a".repeat(63) },
    { reference: " " },
    { reason: " " },
    { apply: true },
    { expectedRevision: 1.5 },
  ])
    assert.equal(
      policyReviewInput.safeParse({ ...input, ...patch }).success,
      false,
    );
});
