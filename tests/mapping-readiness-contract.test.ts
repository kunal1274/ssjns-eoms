import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mappingPolicyProposal,
  readinessFindings,
} from "../packages/domain/mapping-readiness";
const empty = {
  total: 0,
  concerns: 0,
  insufficient: 0,
  authorizationChanged: 0,
  authorizedCorroborated: 0,
};
test("readiness never promotes a clean mapping and corroboration into authenticity approval or application", () => {
  const values = readinessFindings({
    blocked: 0,
    drift: 0,
    estateActive: true,
    matches: true,
    observations: { ...empty, total: 1, authorizedCorroborated: 1 },
  });
  assert.deepEqual(
    values.map((v) => v.code),
    ["AUTHENTICITY_CRITERIA_OPEN", "POLICY_NOT_APPROVED"],
  );
  assert.equal(mappingPolicyProposal.status, "draft-not-approved");
  assert.equal(mappingPolicyProposal.approvalEnabled, false);
  assert.equal(mappingPolicyProposal.applicationEnabled, false);
});
test("readiness preserves concerns alongside positive observations revoked authority drift inactive scope and source mismatch", () => {
  const codes = readinessFindings({
    blocked: 2,
    drift: 1,
    estateActive: false,
    matches: false,
    observations: {
      total: 3,
      concerns: 1,
      insufficient: 1,
      authorizationChanged: 1,
      authorizedCorroborated: 1,
    },
  }).map((v) => v.code);
  for (const code of [
    "ESTATE_INACTIVE",
    "MAPPING_ISSUES",
    "RECORD_DRIFT",
    "SOURCE_MISMATCH",
    "REVIEWER_CONCERNS",
    "INSUFFICIENT_EVIDENCE",
    "REVIEWER_ACCESS_CHANGED",
    "POLICY_NOT_APPROVED",
  ])
    assert.ok(codes.includes(code));
  const no = readinessFindings({
    blocked: 0,
    drift: 0,
    estateActive: true,
    matches: true,
    observations: empty,
  }).map((v) => v.code);
  assert.ok(no.includes("NO_OBSERVATIONS"));
  assert.ok(no.includes("NO_CURRENT_CORROBORATION"));
});
