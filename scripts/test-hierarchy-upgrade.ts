import "../apps/api/src/config";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const adminURL = new URL(process.env.ADMIN_DATABASE_URL!),
  runtimeURL = new URL(process.env.DATABASE_URL!);
if (adminURL.hostname !== "127.0.0.1" || runtimeURL.hostname !== "127.0.0.1")
  throw Error("Upgrade verification requires local synthetic PostgreSQL");
const name = "eoms_upgrade_f06_" + randomUUID().replaceAll("-", "");
const control = new pg.Pool({ connectionString: adminURL.href });
let root: pg.Pool | undefined,
  runtime: pg.Pool | undefined,
  created = false;
try {
  await control.query(`CREATE DATABASE "${name}"`);
  created = true;
  adminURL.pathname = runtimeURL.pathname = "/" + name;
  root = new pg.Pool({ connectionString: adminURL.href });
  runtime = new pg.Pool({ connectionString: runtimeURL.href });
  const c = await root.connect();
  try {
    await c.query("BEGIN");
    for (const file of [
      "001_foundation.sql",
      "002_transaction_locks.sql",
      "003_maintenance.sql",
      "004_gangs_review.sql",
    ])
      await c.query(await readFile("db/migrations/" + file, "utf8"));
    const company = randomUUID(),
      estate = randomUUID(),
      user = randomUUID();
    await c.query(
      "INSERT INTO eoms.companies(id,name) VALUES($1,'Legacy company')",
      [company],
    );
    await c.query(
      "INSERT INTO eoms.estates(id,company_id,code,name) VALUES($1,$2,'LEGACY','Legacy estate')",
      [estate, company],
    );
    await c.query(
      "INSERT INTO eoms.users(id,email,display_name,password_hash) VALUES($1,'legacy@fixture.local','Legacy fixture','not-a-login-password')",
      [user],
    );
    await c.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'supervisor')",
      [user, estate],
    );
    const legacyTask = (
      await c.query(
        "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'OLD-BLOCK','OLD-TASK','Legacy activity','OLD',2) RETURNING id",
        [estate],
      )
    ).rows[0].id;
    await c.query(
      await readFile("db/migrations/005_customer_boundary.sql", "utf8"),
    );
    await c.query(
      await readFile("db/migrations/006_hierarchy_setup.sql", "utf8"),
    );
    await c.query(
      await readFile("db/migrations/007_task_block_links.sql", "utf8"),
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.organization_admins")).rowCount,
      0,
    );
    await c.query(
      await readFile("db/migrations/008_operating_placement.sql", "utf8"),
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.operating_areas")).rowCount,
      0,
    );
    const oldPlacement = (
      await c.query(
        "SELECT area_id,placement_version,company_id FROM eoms.estates WHERE id=$1",
        [estate],
      )
    ).rows[0];
    assert.deepEqual(oldPlacement, {
      area_id: null,
      placement_version: 1,
      company_id: company,
    });
    await c.query(
      "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'LEGACY-GANG','Legacy gang')",
      [estate],
    );
    const legacyWork = (
      await c.query(
        "INSERT INTO eoms.musters(estate_id,occurrence_id,business_date,gang_code,quantity_ha,created_by) VALUES($1,$2,'2026-01-15','LEGACY-GANG',0.1,$3) RETURNING id",
        [estate, legacyTask, user],
      )
    ).rows[0].id;
    await c.query(
      await readFile("db/migrations/009_estate_responsibility.sql", "utf8"),
    );
    const oldAttribution = (
      await c.query(
        "SELECT legal_company_id,legal_company_name,legal_responsibility_id FROM eoms.musters WHERE id=$1",
        [legacyWork],
      )
    ).rows[0];
    assert.deepEqual(oldAttribution, {
      legal_company_id: null,
      legal_company_name: null,
      legal_responsibility_id: null,
    });
    assert.equal(
      (await c.query("SELECT * FROM eoms.estate_responsibilities")).rowCount,
      0,
    );
    const scheduledCompany = (
      await c.query(
        "INSERT INTO eoms.companies(customer_id,name) SELECT customer_id,'Legacy scheduled company' FROM eoms.estates WHERE id=$1 RETURNING id",
        [estate],
      )
    ).rows[0].id;
    const legacySchedule = (
      await c.query(
        "INSERT INTO eoms.estate_responsibilities(estate_id,customer_id,company_id,effective_from,revision,reason) SELECT id,customer_id,$2,'2200-01-01',1,'Pre-cancellation fixture' FROM eoms.estates WHERE id=$1 RETURNING id",
        [estate, scheduledCompany],
      )
    ).rows[0].id;
    await c.query(
      await readFile(
        "db/migrations/010_responsibility_cancellation.sql",
        "utf8",
      ),
    );
    assert.equal(
      (
        await c.query(
          "SELECT id FROM eoms.active_estate_responsibilities WHERE id=$1",
          [legacySchedule],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.responsibility_cancel_requests"))
        .rowCount,
      0,
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.responsibility_cancel_decisions"))
        .rowCount,
      0,
    );
    const legacyArea = (
      await c.query(
        "INSERT INTO eoms.operating_areas(customer_id,kind,code,name) SELECT customer_id,'region','OLD-AREA','Legacy operating area' FROM eoms.estates WHERE id=$1 RETURNING id",
        [estate],
      )
    ).rows[0].id;
    const areaHistoryBefore = (
      await c.query(
        "SELECT count(*)::int AS n FROM eoms.hierarchy_history WHERE record_id=$1",
        [legacyArea],
      )
    ).rows[0].n;
    await c.query(
      await readFile("db/migrations/011_operating_movement.sql", "utf8"),
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT id,active,version FROM eoms.operating_areas WHERE id=$1",
          [legacyArea],
        )
      ).rows[0],
      { id: legacyArea, active: true, version: 1 },
    );
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM eoms.hierarchy_history WHERE record_id=$1",
          [legacyArea],
        )
      ).rows[0].n,
      areaHistoryBefore,
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.placement_move_requests")).rowCount,
      0,
    );
    assert.equal(
      (await c.query("SELECT * FROM eoms.placement_move_decisions")).rowCount,
      0,
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT area_id,placement_version,company_id FROM eoms.estates WHERE id=$1",
          [estate],
        )
      ).rows[0],
      oldPlacement,
    );
    const legacyDivision = (
      await c.query(
        "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) SELECT customer_id,id,'division','OLD-DIVISION','Legacy division' FROM eoms.estates WHERE id=$1 RETURNING id",
        [estate],
      )
    ).rows[0].id;
    const lifecycleHistoryBefore = (
      await c.query("SELECT count(*)::int AS n FROM eoms.hierarchy_history")
    ).rows[0].n;
    await c.query(
      await readFile("db/migrations/012_estate_unit_lifecycle.sql", "utf8"),
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT active,lifecycle_version FROM eoms.estates WHERE id=$1",
          [estate],
        )
      ).rows[0],
      { active: true, lifecycle_version: 1 },
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT active,version FROM eoms.operating_units WHERE id=$1",
          [legacyDivision],
        )
      ).rows[0],
      { active: true, version: 1 },
    );
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM eoms.hierarchy_history"))
        .rows[0].n,
      lifecycleHistoryBefore,
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT legal_company_id,legal_company_name,legal_responsibility_id FROM eoms.musters WHERE id=$1",
          [legacyWork],
        )
      ).rows[0],
      oldAttribution,
    );
    const navigationCounts = (
      await c.query(
        "SELECT (SELECT count(*) FROM eoms.estates)::int AS estates,(SELECT count(*) FROM eoms.operating_units)::int AS units,(SELECT count(*) FROM eoms.hierarchy_history)::int AS history",
      )
    ).rows[0];
    await c.query(
      await readFile(
        "db/migrations/013_hierarchy_navigation_indexes.sql",
        "utf8",
      ),
    );
    await c.query(
      await readFile("db/migrations/014_scope_read_indexes.sql", "utf8"),
    );
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='eoms' AND indexname IN ('estate_company_read','company_customer_read','area_customer_page')",
        )
      ).rows[0].n,
      3,
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT (SELECT count(*) FROM eoms.estates)::int AS estates,(SELECT count(*) FROM eoms.operating_units)::int AS units,(SELECT count(*) FROM eoms.hierarchy_history)::int AS history",
        )
      ).rows[0],
      navigationCounts,
    );
    const ledgerCounts = (
      await c.query(
        "SELECT (SELECT count(*) FROM eoms.estate_responsibilities)::int AS responsibility,(SELECT count(*) FROM eoms.responsibility_cancel_requests)::int AS cancellations,(SELECT count(*) FROM eoms.placement_move_requests)::int AS moves",
      )
    ).rows[0];
    await c.query(
      await readFile("db/migrations/015_decision_ledger_indexes.sql", "utf8"),
    );
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='eoms' AND indexname IN ('responsibility_ledger_page','cancellation_ledger_page','move_ledger_page')",
        )
      ).rows[0].n,
      3,
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT (SELECT count(*) FROM eoms.estate_responsibilities)::int AS responsibility,(SELECT count(*) FROM eoms.responsibility_cancel_requests)::int AS cancellations,(SELECT count(*) FROM eoms.placement_move_requests)::int AS moves",
        )
      ).rows[0],
      ledgerCounts,
    );
    const preservedTask = (
      await c.query(
        "SELECT id,block_code,block_unit_id,version FROM eoms.occurrences WHERE id=$1",
        [legacyTask],
      )
    ).rows[0];
    assert.deepEqual(preservedTask, {
      id: legacyTask,
      block_code: "OLD-BLOCK",
      block_unit_id: null,
      version: 1,
    });
    const rows = (
      await c.query(
        "SELECT e.id,e.customer_id,c.customer_id AS company_customer FROM eoms.estates e JOIN eoms.companies c ON c.id=e.company_id WHERE e.id=$1",
        [estate],
      )
    ).rows;
    assert.equal(rows[0].id, estate);
    assert.equal(rows[0].customer_id, rows[0].company_customer);
    assert.equal(
      (await c.query("SELECT action FROM eoms.customer_history")).rows[0]
        .action,
      "customer.created",
    );
    await c.query("COMMIT");
    const r = await runtime.connect();
    try {
      await r.query("BEGIN");
      assert.equal((await r.query("SELECT * FROM eoms.customers")).rowCount, 0);
      await r.query("SELECT set_config('app.user_id',$1,true)", [user]);
      assert.equal((await r.query("SELECT * FROM eoms.customers")).rowCount, 1);
      assert.equal(
        (await r.query("SELECT * FROM eoms.estates")).rows[0].id,
        estate,
      );
      await r.query("ROLLBACK");
    } finally {
      r.release();
    }
  } finally {
    c.release();
  }
  console.log(
    "PASS F06 upgrade: legacy company/estate/membership preserved, customer mapping and history created, runtime RLS verified.",
  );
} finally {
  await runtime?.end();
  await root?.end();
  if (created) await control.query(`DROP DATABASE "${name}"`);
  await control.end();
}
