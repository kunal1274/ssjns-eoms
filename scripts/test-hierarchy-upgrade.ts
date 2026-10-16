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
    await c.query(
      await readFile("db/migrations/005_customer_boundary.sql", "utf8"),
    );
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
