import { execFile } from "node:child_process";
import { promisify } from "node:util";
import "../apps/api/src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
async function fixture(run: (f: any, call: any, grant: any) => Promise<void>) {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const call = (path: string, body?: any, raw = f.raw) =>
      fetch(f.apiURL + "/api/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: "eoms_session=" + raw,
          Origin: "http://localhost:5284",
          "Content-Type": "application/json",
          "X-CSRF-Token": "synthetic-history-ui",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const grant = async (action = "granted") =>
      f.root.query(
        "INSERT INTO eoms.platform_bootstrap_authority(subject_id,action,user_scope_revision,reference,reason) SELECT $1,$2,coalesce(max(id),0),'Synthetic explicit bootstrap authority','Owner-controlled synthetic test provisioning' FROM eoms.mapping_policy_scope_events WHERE subject_id=$1 AND kind='user-active'",
        [f.user, action],
      );
    await run(f, call, grant);
  } finally {
    await f.close();
  }
}
const bootstrap = (admin: string) => ({
  key: randomUUID(),
  customerCode: "NEW-" + randomUUID().slice(0, 8).toUpperCase(),
  customerName: "Synthetic provisioned tenant",
  companyCode: "LEGAL-ONE",
  companyName: "Synthetic new legal company",
  estateCode: "ESTATE-ONE",
  estateName: "Synthetic first estate",
  initialAdminId: admin,
  reference: "Synthetic owner authorized bootstrap",
  reason: "Create explicit tenant boundaries with named administrator",
});
test("platform bootstrap is explicit and grants only the named initial administrator without operator or sibling work access", async () =>
  fixture(async (f, call, grant) => {
    const peer = await independentSourceReviewer(f),
      body = bootstrap(peer.id);
    assert.equal((await call("provisioning/customer", body)).status, 403);
    await grant();
    const r = await call("provisioning/customer", body);
    assert.equal(r.status, 200);
    const result: any = await r.json(),
      ids = result.receipt.result;
    assert.equal(ids.initialAdminId, peer.id);
    assert.equal(ids.bootstrapperGrantedAccess, false);
    assert.equal(result.receipt.actor_id, f.user);
    assert.equal(result.receipt.payload.reference, body.reference);
    assert.match(result.receipt.request_id, /^[a-f0-9-]{36}$/);
    assert.equal(
      (await call("estates/" + ids.estateId + "/musters")).status,
      403,
    );
    assert.equal(
      (await call("estates/" + ids.estateId + "/musters", undefined, peer.raw))
        .status,
      200,
    );
    const own: any = await (await call("organization")).json();
    assert.equal(
      own.items.some((r: any) => r.customer_id === ids.customerId),
      false,
    );
    const other: any = await (
      await call("organization", undefined, peer.raw)
    ).json();
    assert.equal(
      other.items.some((r: any) => r.customer_id === ids.customerId),
      true,
    );
    assert.equal(
      (
        await f.root.query(
          "SELECT user_id,role FROM eoms.memberships WHERE estate_id=$1",
          [ids.estateId],
        )
      ).rowCount,
      1,
    );
  }));
test("bootstrap concurrent retries recover one atomic receipt and invalid or duplicate input leaves no partial tenant", async () =>
  fixture(async (f, call, grant) => {
    await grant();
    const body = bootstrap(f.user),
      results = await Promise.all([
        call("provisioning/customer", body),
        call("provisioning/customer", body),
      ]);
    assert.deepEqual(
      results.map((r: any) => r.status),
      [200, 200],
    );
    const a: any = await results[0].json(),
      b: any = await results[1].json();
    assert.equal(a.receipt.id, b.receipt.id);
    assert.equal([a, b].filter((v) => v.replayed).length, 1);
    assert.equal(
      (
        await call("provisioning/customer", {
          ...body,
          reason: "Changed retry reference",
        })
      ).status,
      409,
    );
    assert.equal(
      (await call("provisioning/customer", { ...body, key: randomUUID() }))
        .status,
      409,
    );
    const bad = bootstrap(randomUUID()),
      count = (
        await f.root.query("SELECT count(*)::int AS n FROM eoms.customers")
      ).rows[0].n;
    assert.equal((await call("provisioning/customer", bad)).status, 422);
    assert.equal(
      (await f.root.query("SELECT count(*)::int AS n FROM eoms.customers"))
        .rows[0].n,
      count,
    );
    assert.equal(
      (
        await call("provisioning/customer", {
          ...bootstrap(f.user),
          grantGlobalAccess: true,
        })
      ).status,
      422,
    );
  }));
test("customer setup creates tenant-local coded companies and explicitly assigned estates without granting creator operational access", async () =>
  fixture(async (f, call) => {
    const peer = await independentSourceReviewer(f),
      companyBody = {
        key: randomUUID(),
        customerId: f.customer,
        companyCode: "NEW-LEGAL",
        companyName: "Synthetic customer-local legal company",
        reference: "Synthetic setup authority",
        reason: "Create legal company without inheriting sibling access",
      };
    let r = await call("provisioning/company", companyBody);
    assert.equal(r.status, 200);
    const company: any = await r.json(),
      companyId = company.receipt.result.companyId;
    const body = {
      key: randomUUID(),
      customerId: f.customer,
      companyId,
      estateCode: "NEW-ESTATE",
      estateName: "Synthetic explicitly assigned estate",
      initialManagerId: peer.id,
      reference: "Synthetic estate assignment authority",
      reason: "Explicitly assign the named active customer setup manager",
    };
    r = await call("provisioning/estate", body);
    assert.equal(r.status, 200);
    const estate: any = await r.json(),
      estateId = estate.receipt.result.estateId;
    assert.equal(estate.receipt.result.creatorGrantedAccess, false);
    assert.equal((await call("estates/" + estateId + "/musters")).status, 403);
    assert.equal(
      (await call("estates/" + estateId + "/musters", undefined, peer.raw))
        .status,
      200,
    );
    const history: any = await (
      await call("customers/" + f.customer + "/provisioning?limit=1")
    ).json();
    assert.equal(history.items.length, 1);
    assert.ok(history.nextCursor);
    assert.equal(
      (
        await call(
          "customers/" +
            f.customer +
            "/provisioning?limit=2&cursor=" +
            history.nextCursor,
        )
      ).status,
      422,
    );
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
      [f.customer, f.user],
    );
    assert.equal(
      (
        await call("provisioning/company", {
          ...companyBody,
          key: randomUUID(),
          companyCode: "OTHER",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("customers/" + f.customer + "/provisioning")).status,
      403,
    );
  }));
test("foreign company and initial manager references cannot cross customer boundaries and runtime cannot issue bootstrap grants", async () =>
  fixture(async (f, call, grant) => {
    await grant();
    const root: any = await (
        await call("provisioning/customer", bootstrap(f.user))
      ).json(),
      other = root.receipt.result;
    const body = {
      key: randomUUID(),
      customerId: f.customer,
      companyId: other.companyId,
      estateCode: "FOREIGN",
      estateName: "Invalid company scope",
      initialManagerId: f.user,
      reference: "Synthetic boundary check",
      reason: "Foreign company must not enter the selected customer",
    };
    assert.equal((await call("provisioning/estate", body)).status, 403);
    assert.equal(
      (
        await call("provisioning/estate", {
          ...body,
          companyId: f.company,
          initialManagerId: randomUUID(),
        })
      ).status,
      422,
    );
    const privilege = (
      await f.runtime.query(
        "SELECT has_table_privilege(current_user,'eoms.platform_bootstrap_authority','INSERT') AS ins,has_table_privilege(current_user,'eoms.hierarchy_provision_receipts','INSERT') AS receipt",
      )
    ).rows[0];
    assert.deepEqual(privilege, { ins: false, receipt: false });
  }));
test("bootstrap revocation and user suspension restoration do not revive prior capability", async () =>
  fixture(async (f, call, grant) => {
    await grant();
    await grant("revoked");
    assert.equal(
      (await call("provisioning/customer", bootstrap(f.user))).status,
      403,
    );
    await grant();
    await f.root.query("UPDATE eoms.users SET active=false WHERE id=$1", [
      f.user,
    ]);
    await f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
      f.user,
    ]);
    const caps: any = await (await call("provisioning/capabilities")).json();
    assert.equal(caps.canBootstrap, false);
    assert.equal(
      (await call("provisioning/customer", bootstrap(f.user))).status,
      403,
    );
  }));
test("customer setup handover is explicit audited idempotent and never grants operational membership", async () =>
  fixture(async (f, call) => {
    const peer = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    await f.root.query("DELETE FROM eoms.memberships WHERE user_id=$1", [
      peer.id,
    ]);
    const body = {
        key: randomUUID(),
        customerId: f.customer,
        subjectId: peer.id,
        action: "granted",
        expectedGranted: false,
        reference: "Synthetic explicit setup handover",
        reason: "Grant configuration authority without estate work access",
      },
      rs = await Promise.all([
        call("provisioning/setup-grant", body),
        call("provisioning/setup-grant", body),
      ]);
    assert.deepEqual(
      rs.map((r: any) => r.status),
      [200, 200],
    );
    const a: any = await rs[0].json(),
      b: any = await rs[1].json();
    assert.equal(a.receipt.id, b.receipt.id);
    assert.equal([a, b].filter((v) => v.replayed).length, 1);
    assert.equal(a.receipt.result.workAccessGranted, false);
    assert.equal(a.receipt.actor_id, f.user);
    const caps: any = await (
      await call(
        "provisioning/capabilities?customerId=" + f.customer,
        undefined,
        peer.raw,
      )
    ).json();
    assert.equal(caps.canManageCustomer, true);
    assert.equal(
      (await call("estates/" + f.estate + "/musters", undefined, peer.raw))
        .status,
      403,
    );
    assert.equal(
      (
        await f.root.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          peer.id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await call("provisioning/setup-grant", {
          ...body,
          key: randomUUID(),
          subjectId: f.user,
          action: "revoked",
          expectedGranted: true,
        })
      ).status,
      403,
    );
    const revoked = await call("provisioning/setup-grant", {
      ...body,
      key: randomUUID(),
      action: "revoked",
      expectedGranted: true,
    });
    assert.equal(revoked.status, 200);
    assert.equal(
      (
        await call(
          "customers/" + f.customer + "/setup-subject?subjectId=" + f.user,
          undefined,
          peer.raw,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call("provisioning/setup-grant", {
          ...body,
          key: randomUUID(),
          reason: "Foreign forged permission",
          force: true,
        })
      ).status,
      422,
    );
  }));
test("concurrent setup revocation and company provisioning serialize without deadlock or partial writes", async () =>
  fixture(async (f, call) => {
    const peer = await independentSourceReviewer(f),
      revoke = {
        key: randomUUID(),
        customerId: f.customer,
        subjectId: peer.id,
        action: "revoked",
        expectedGranted: true,
        reference: "Synthetic concurrent access removal",
        reason:
          "Revoke setup scope while a different actor attempts provisioning",
      },
      company = {
        key: randomUUID(),
        customerId: f.customer,
        companyCode: "RACE-COMPANY",
        companyName: "Synthetic serialized company",
        reference: "Synthetic scoped creation",
        reason: "Creation must finish before revocation or be denied after it",
      };
    const rs = await Promise.all([
      call("provisioning/setup-grant", revoke),
      call("provisioning/company", company, peer.raw),
    ]);
    assert.equal(rs[0].status, 200);
    assert.ok([200, 403].includes(rs[1].status));
    const count = (
      await f.root.query(
        "SELECT count(*)::int AS n FROM eoms.companies WHERE customer_id=$1 AND code='RACE-COMPANY'",
        [f.customer],
      )
    ).rows[0].n;
    assert.equal(count, rs[1].status === 200 ? 1 : 0);
    assert.equal(
      (
        await f.root.query(
          "SELECT * FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
          [f.customer, f.user],
        )
      ).rowCount,
      1,
    );
  }));

test("the explicit administrative bootstrap command grants and revokes the capability without issuing tenant memberships", async () =>
  fixture(async (f, call) => {
    const execute = promisify(execFile),
      before = (
        await f.root.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          f.user,
        ])
      ).rowCount;
    for (const action of ["granted", "revoked"]) {
      const result = await execute(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/authorize-bootstrap.ts",
          f.user,
          action,
          "Synthetic controlled operator reference",
          "Explicit isolated CLI authority test",
        ],
        {
          env: {
            ...process.env,
            ADMIN_DATABASE_URL: f.root.options.connectionString,
          },
        },
      );
      assert.match(
        result.stdout,
        /Recorded explicit platform bootstrap authority change/,
      );
      const caps: any = await (await call("provisioning/capabilities")).json();
      assert.equal(caps.canBootstrap, action === "granted");
    }
    assert.equal(
      (
        await f.root.query("SELECT * FROM eoms.memberships WHERE user_id=$1", [
          f.user,
        ])
      ).rowCount,
      before,
    );
  }));
