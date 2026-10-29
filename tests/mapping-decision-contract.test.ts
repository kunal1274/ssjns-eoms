import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mappingAppointmentInput,
  mappingRequestInput,
  mappingDecisionInput,
} from "../packages/domain/mapping-decision";
test("mapping request contract binds explicit policy acceptance custody and optional linked parent without client supplied snapshots or application flags", () => {
  const v = {
    key: randomUUID(),
    policyId: randomUUID(),
    acceptanceId: randomUUID(),
    previousId: null,
    custodyRef: "Controlled custody",
    reason: "Independent mapping review",
  };
  assert.equal(mappingRequestInput.safeParse(v).success, true);
  for (const p of [
    { policyId: undefined },
    { acceptanceId: "any" },
    { custodyRef: " " },
    { previousId: "bad" },
    { snapshot: {} },
    { apply: true },
  ])
    assert.equal(mappingRequestInput.safeParse({ ...v, ...p }).success, false);
});
test("explicit mapping appointments and individual decision contracts reject inferred roles unexamined decisions and unsupported outcomes", () => {
  const v = {
    key: randomUUID(),
    subjectId: randomUUID(),
    policyId: randomUUID(),
    acceptanceId: randomUUID(),
    expectedRevision: 0,
    action: "appointed",
    reference: "Actual appointment reference",
    reason: "Separate mapping decision recorder",
  };
  assert.equal(mappingAppointmentInput.safeParse(v).success, true);
  assert.equal(
    mappingAppointmentInput.safeParse({ ...v, role: "all-managers" }).success,
    false,
  );
  const d = {
    key: randomUUID(),
    appointmentId: randomUUID(),
    expectedRevision: 0,
    outcome: "approved",
    reference: "Independent decision",
    reason: "Reviewed bound identities",
    examined: true,
  };
  assert.equal(mappingDecisionInput.safeParse(d).success, true);
  for (const p of [
    { examined: false },
    { appointmentId: undefined },
    { expectedRevision: -1 },
    { outcome: "applied" },
    { reference: "x".repeat(241) },
    { force: true },
  ])
    assert.equal(mappingDecisionInput.safeParse({ ...d, ...p }).success, false);
});
