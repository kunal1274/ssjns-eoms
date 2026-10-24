import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  policyAuthorityInput,
  policyAcceptanceInput,
} from "../packages/domain/policy-acceptance";
test("explicit policy authority contract requires scoped subject revision and bounded delegation reference without implicit self grant or activation fields", () => {
  const v = {
    key: randomUUID(),
    subjectId: randomUUID(),
    expectedRevision: 0,
    action: "appointed",
    authorityRef: "Synthetic delegated recording authority",
    reason: "Named recorder appointment",
  };
  assert.equal(policyAuthorityInput.safeParse(v).success, true);
  for (const patch of [
    { action: "mapping-approver" },
    { subjectId: "any-manager" },
    { expectedRevision: -1 },
    { authorityRef: " " },
    { reason: "x".repeat(501) },
    { applicationEnabled: true },
  ])
    assert.equal(
      policyAuthorityInput.safeParse({ ...v, ...patch }).success,
      false,
    );
});
test("external decision contract requires exact digest appointment human attestation reference and non-application outcomes", () => {
  const v = {
    key: randomUUID(),
    authorityId: randomUUID(),
    expectedRevision: 0,
    policySha256: "a".repeat(64),
    outcome: "accepted-externally",
    externalRef: "Synthetic signed policy reference",
    reason: "Recorder checked referenced decision",
    attested: true,
  };
  assert.equal(policyAcceptanceInput.safeParse(v).success, true);
  for (const patch of [
    { attested: false },
    { attested: undefined },
    { authorityId: undefined },
    { policySha256: "bad" },
    { outcome: "apply" },
    { externalRef: "x".repeat(241) },
    { reason: " " },
    { approved: true },
  ])
    assert.equal(
      policyAcceptanceInput.safeParse({ ...v, ...patch }).success,
      false,
    );
});
