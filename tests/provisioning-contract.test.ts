import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  customerProvisionInput,
  companyProvisionInput,
  estateProvisionInput,
} from "../packages/domain/provisioning";
test("hierarchy provisioning requires explicit bounded tenant codes names and initial assignments without caller invented authority", () => {
  const common = {
      key: randomUUID(),
      reference: "Actual owner reference",
      reason: "Explicit scoped provisioning",
    },
    company = {
      ...common,
      customerId: randomUUID(),
      companyCode: "LEGAL-ONE",
      companyName: "Company",
    };
  assert.equal(companyProvisionInput.safeParse(company).success, true);
  assert.equal(
    companyProvisionInput.safeParse({ ...company, globalAdmin: true }).success,
    false,
  );
  assert.equal(
    companyProvisionInput.safeParse({ ...company, companyCode: "invalid code" })
      .success,
    false,
  );
  const tenant = {
    ...common,
    customerCode: "CUSTOMER",
    customerName: "Customer",
    companyCode: "COMPANY",
    companyName: "Company",
    estateCode: "ESTATE",
    estateName: "Estate",
    initialAdminId: randomUUID(),
  };
  assert.equal(customerProvisionInput.safeParse(tenant).success, true);
  assert.equal(
    customerProvisionInput.safeParse({ ...tenant, initialAdminId: "" }).success,
    false,
  );
  assert.equal(
    estateProvisionInput.safeParse({
      ...common,
      customerId: randomUUID(),
      companyId: randomUUID(),
      estateCode: "ESTATE",
      estateName: "Estate",
      initialManagerId: randomUUID(),
    }).success,
    true,
  );
});
