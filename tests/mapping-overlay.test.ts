import "../apps/api/src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mappingWorkflowFixture } from "./mapping-workflow-fixture";
async function prepared(run: (x: any) => Promise<void>) {
  const x = await mappingWorkflowFixture();
  try {
    const request = (await x.post(x.sourcePath, x.requestInput()))
        .mappingRequest,
      path = "mapping-requests/" + request.id;
    const decision = (
      await x.post(path + "/decisions", x.decisionInput(), x.decider.raw)
    ).decision;
    const grant = (
      purpose = "apply",
      subjectId = x.f.user,
      expectedRevision = 0,
      action = "appointed",
    ) => ({
      key: randomUUID(),
      subjectId,
      purpose,
      expectedRevision,
      action,
      reference: "Synthetic exact request execution mandate",
      reason: "Explicit named execution authority against independent decision",
    });
    const authority = (
      await x.post(path + "/execution-authority", grant(), x.decider.raw)
    ).authority;
    const execution = (
      operation = "apply",
      authorityId = authority.id,
      previousId: string | null = null,
    ) => ({
      key: randomUUID(),
      authorityId,
      operation,
      previousId,
      reference: "Synthetic controlled overlay execution",
      reason:
        "Examined exact authorization approval and original adjusted rows",
      examined: true,
    });
    await run({ ...x, request, decision, path, grant, authority, execution });
  } finally {
    await x.f.close();
  }
}
test("explicit execution authorization excludes self grant and decision executor and scopes direct requests", async () =>
  prepared(async (x) => {
    assert.equal(
      (
        await x.call(
          x.path + "/execution-authority",
          x.grant("apply", x.f.user, 1),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await x.call(
          x.path + "/execution-authority",
          x.grant("apply", x.decider.id),
        )
      ).status,
      403,
    );
    const body = x.execution();
    assert.equal(
      (await x.call(x.path + "/execution", body, x.decider.raw)).status,
      403,
    );
    assert.equal(
      (await x.call(x.path + "/execution", { ...body, force: true })).status,
      422,
    );
    assert.equal(
      (await x.call(x.path + "/execution", { ...body, examined: false }))
        .status,
      422,
    );
    assert.equal((await x.call(x.path + "/execution?bypass=true")).status, 422);
    assert.equal(
      (await x.call(x.path + "/execution", undefined, x.f.raw, x.f.hidden))
        .status,
      403,
    );
    assert.equal(
      (await x.call("mapping-requests/" + randomUUID() + "/execution")).status,
      404,
    );
  }));
test("concurrent exact application retries create one immutable receipt with actual rows digests actor audit and conserved totals", async () =>
  prepared(async (x) => {
    const baseline = await x.f.snapshot(),
      body = x.execution();
    const results = await Promise.all([
      x.post(x.path + "/execution", body),
      x.post(x.path + "/execution", body),
    ]);
    assert.equal(results[0].receipt.id, results[1].receipt.id);
    assert.equal(results.filter((r) => r.replayed).length, 1);
    const receipt = results[0].receipt;
    assert.equal(receipt.actor_id, x.f.user);
    assert.equal(receipt.decision_id, x.decision.id);
    assert.equal(receipt.authority_id, x.authority.id);
    assert.equal(receipt.snapshot_sha256, x.request.snapshot_sha256);
    assert.match(receipt.rows_sha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.request_id, /^[a-f0-9-]{36}$/);
    assert.equal(receipt.row_count, 1);
    assert.equal(Number(receipt.quantity_ha), 0.1);
    const context: any = await (await x.call(x.path + "/execution")).json();
    assert.equal(context.active, true);
    assert.equal(context.rows[0].record_id, x.f.target);
    assert.equal(context.rows[0].original_company_id, null);
    assert.equal(context.rows[0].adjusted_company_id, x.f.company);
    const register: any = await (
      await x.call("overlay-register?limit=1")
    ).json();
    assert.equal(register.items.length, 1);
    assert.ok(register.nextCursor);
    assert.equal(register.totals.active_overlay_rows, 1);
    assert.equal(
      register.totals.original_unresolved - register.totals.adjusted_unresolved,
      1,
    );
    assert.equal(
      register.totals.original_quantity_ha,
      register.totals.adjusted_quantity_ha,
    );
    assert.equal(
      (await x.call("overlay-register?limit=2&cursor=" + register.nextCursor))
        .status,
      422,
    );
    assert.equal(
      (
        await x.call(
          "overlay-register?limit=1&cursor=" + register.nextCursor,
          undefined,
          x.decider.raw,
        )
      ).status,
      422,
    );
    const second: any = await (
      await x.call("overlay-register?limit=1&cursor=" + register.nextCursor)
    ).json();
    assert.notEqual(second.items[0].id, register.items[0].id);
    assert.equal(
      (
        await x.call(x.path + "/execution", {
          ...body,
          reason: "Changed retry reason",
        })
      ).status,
      409,
    );
    assert.equal(
      (await x.call(x.path + "/execution", x.execution())).status,
      409,
    );
    assert.deepEqual(await x.f.snapshot(), baseline);
    await assert.rejects(
      () =>
        x.f.root.query(
          "UPDATE eoms.mapping_overlay_receipts SET reason='Edited history' WHERE id=$1",
          [receipt.id],
        ),
      (e: any) => e.code === "23514",
    );
    await assert.rejects(
      () =>
        x.f.root.query(
          "DELETE FROM eoms.mapping_overlay_rows WHERE receipt_id=$1",
          [receipt.id],
        ),
      (e: any) => e.code === "23514",
    );
  }));
test("actual observation drift blocks authorized execution and leaves original facts and receipt tables untouched", async () =>
  prepared(async (x) => {
    const baseline = await x.f.snapshot();
    await x.observe("corroborated", 1);
    assert.equal(
      (await x.call(x.path + "/execution", x.execution())).status,
      409,
    );
    assert.equal(
      (await x.f.root.query("SELECT * FROM eoms.mapping_overlay_receipts"))
        .rowCount,
      0,
    );
    assert.deepEqual(await x.f.snapshot(), baseline);
  }));
test("revocation and restored underlying scope never resurrect an execution mandate", async () =>
  prepared(async (x) => {
    await x.post(
      x.path + "/execution-authority",
      x.grant("apply", x.f.user, 1, "revoked"),
      x.decider.raw,
    );
    assert.equal(
      (await x.call(x.path + "/execution", x.execution())).status,
      409,
    );
    const renewed = (
      await x.post(
        x.path + "/execution-authority",
        x.grant("apply", x.f.user, 2),
        x.decider.raw,
      )
    ).authority;
    await x.f.root.query(
      "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
      [x.f.customer, x.f.user],
    );
    assert.equal(
      (await x.call(x.path + "/execution", x.execution("apply", renewed.id)))
        .status,
      403,
    );
    await x.f.root.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [x.f.customer, x.f.user],
    );
    assert.equal(
      (await x.call(x.path + "/execution", x.execution("apply", renewed.id)))
        .status,
      409,
    );
    const state: any = await (await x.call(x.path + "/execution")).json();
    assert.equal(state.ownApply.effective, false);
  }));
test("compensation requires distinct explicit actor preserves receipt lineage totals and original facts even after current source concerns", async () =>
  prepared(async (x) => {
    const baseline = await x.f.snapshot(),
      applied = (await x.post(x.path + "/execution", x.execution())).receipt;
    assert.equal(
      (
        await x.call(
          x.path + "/execution-authority",
          x.grant("compensate", x.f.user),
          x.decider.raw,
        )
      ).status,
      403,
    );
    const auth = (
      await x.post(
        x.path + "/execution-authority",
        x.grant("compensate", x.decider.id),
      )
    ).authority;
    await x.observe("concerns", 1);
    const body = x.execution("compensate", auth.id, applied.id),
      r = await x.post(x.path + "/execution", body, x.decider.raw),
      retry = await x.post(x.path + "/execution", body, x.decider.raw);
    assert.equal(retry.replayed, true);
    assert.equal(r.receipt.id, retry.receipt.id);
    assert.equal(r.receipt.previous_id, applied.id);
    assert.equal(r.receipt.rows_sha256, applied.rows_sha256);
    assert.equal(r.receipt.quantity_ha, applied.quantity_ha);
    assert.equal(
      (
        await x.call(
          x.path + "/execution",
          x.execution("compensate", auth.id, applied.id),
          x.decider.raw,
        )
      ).status,
      409,
    );
    const context: any = await (await x.call(x.path + "/execution")).json();
    assert.equal(context.active, false);
    assert.equal(context.receipts.length, 2);
    assert.equal(context.rows.length, 1);
    const report: any = await (await x.call("overlay-register")).json();
    assert.equal(report.totals.active_overlay_rows, 0);
    assert.equal(
      report.totals.original_unresolved,
      report.totals.adjusted_unresolved,
    );
    assert.equal(
      report.totals.original_quantity_ha,
      report.totals.adjusted_quantity_ha,
    );
    assert.deepEqual(await x.f.snapshot(), baseline);
  }));
test("application batch rolls back its receipt and every row on an actual database insertion failure", async () =>
  prepared(async (x) => {
    const baseline = await x.f.snapshot();
    await x.f.root.query(
      "CREATE FUNCTION eoms.synthetic_overlay_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic controlled insertion failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER synthetic_overlay_failure BEFORE INSERT ON eoms.mapping_overlay_rows FOR EACH ROW EXECUTE FUNCTION eoms.synthetic_overlay_failure()",
    );
    const body = x.execution();
    assert.equal((await x.call(x.path + "/execution", body)).status, 422);
    assert.equal(
      (await x.f.root.query("SELECT * FROM eoms.mapping_overlay_receipts"))
        .rowCount,
      0,
    );
    assert.equal(
      (await x.f.root.query("SELECT * FROM eoms.mapping_overlay_rows"))
        .rowCount,
      0,
    );
    assert.deepEqual(await x.f.snapshot(), baseline);
    await x.f.root.query(
      "DROP TRIGGER synthetic_overlay_failure ON eoms.mapping_overlay_rows; DROP FUNCTION eoms.synthetic_overlay_failure()",
    );
    assert.equal((await x.post(x.path + "/execution", body)).replayed, false);
  }));
test("overlapping approved requests cannot create simultaneous active overlays and runtime has no raw write privileges", async () =>
  prepared(async (x) => {
    const second = (await x.post(x.sourcePath, x.requestInput()))
        .mappingRequest,
      path = "mapping-requests/" + second.id;
    await x.post(path + "/decisions", x.decisionInput(), x.decider.raw);
    const auth = (
      await x.post(path + "/execution-authority", x.grant(), x.decider.raw)
    ).authority;
    const r = await Promise.all([
      x.call(x.path + "/execution", x.execution()),
      x.call(path + "/execution", x.execution("apply", auth.id)),
    ]);
    assert.deepEqual(r.map((v) => v.status).sort(), [200, 409]);
    assert.equal(
      (await x.f.root.query("SELECT * FROM eoms.mapping_overlay_receipts"))
        .rowCount,
      1,
    );
    for (const table of [
      "mapping_execution_authority",
      "mapping_overlay_receipts",
      "mapping_overlay_rows",
    ]) {
      const privilege = (
        await x.f.runtime.query(
          "SELECT has_table_privilege(current_user,$1,'INSERT') AS ins,has_table_privilege(current_user,$1,'UPDATE') AS upd,has_table_privilege(current_user,$1,'DELETE') AS del",
          ["eoms." + table],
        )
      ).rows[0];
      assert.deepEqual(privilege, { ins: false, upd: false, del: false });
    }
  }));
