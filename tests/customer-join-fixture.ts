import { randomUUID } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
export async function customerJoinFixture() {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const peer = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    await f.root.query("DELETE FROM eoms.memberships WHERE user_id=$1", [
      peer.id,
    ]);
    const otherCustomer = (
      await f.root.query(
        "INSERT INTO eoms.customers(code,name) VALUES($1,'Other consent customer') RETURNING id",
        ["JOIN-" + randomUUID().slice(0, 8)],
      )
    ).rows[0].id;
    const company = (
      await f.root.query(
        "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Other consent company') RETURNING id",
        [otherCustomer],
      )
    ).rows[0].id;
    const otherEstate = (
      await f.root.query(
        "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Other customer existing estate') RETURNING id",
        [otherCustomer, company, "JOIN-OTHER-" + randomUUID().slice(0, 8)],
      )
    ).rows[0].id;
    await f.root.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'clerk')",
      [peer.id, otherEstate],
    );
    const call = (
      body?: unknown,
      raw = f.raw,
      path = "/api/auth/customer-invitations",
    ) =>
      fetch(f.apiURL + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: "eoms_session=" + raw,
          Origin: "http://localhost:5284",
          "Content-Type": "application/json",
          "X-CSRF-Token": "synthetic-history-ui",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { ...f, peer, otherCustomer, otherEstate, call };
  } catch (e) {
    await f.close();
    throw e;
  }
}
