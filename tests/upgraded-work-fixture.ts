import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type { Server } from "node:http";
import { createApp } from "../apps/api/src/app";
import { hash, token } from "../apps/api/src/security";

// Dedicated synthetic database: actual records precede migration 009.
// No disabled guards, runtime bypass role, guessed backfill or invented audit events.
export async function upgradedWorkFixture() {
  const rootURL = new URL(process.env.ADMIN_DATABASE_URL!),
    runtimeURL = new URL(process.env.DATABASE_URL!);
  if (rootURL.hostname !== "127.0.0.1" || runtimeURL.hostname !== "127.0.0.1")
    throw Error(
      "Historical browser fixture requires local synthetic PostgreSQL",
    );
  const database = "eoms_history_ui_" + randomUUID().replaceAll("-", ""),
    control = new pg.Pool({ connectionString: rootURL.href });
  let root: pg.Pool | undefined,
    runtime: pg.Pool | undefined,
    server: Server | undefined,
    created = false;
  async function close() {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server!.close((e) => (e ? reject(e) : resolve())),
      );
    }
    await runtime?.end();
    await root?.end();
    try {
      if (created) await control.query(`DROP DATABASE "${database}"`);
    } finally {
      await control.end();
    }
  }
  try {
    await control.query(`CREATE DATABASE "${database}"`);
    created = true;
    rootURL.pathname = runtimeURL.pathname = "/" + database;
    root = new pg.Pool({ connectionString: rootURL.href });
    runtime = new pg.Pool({ connectionString: runtimeURL.href });
    const company = randomUUID(),
      estate = randomUUID(),
      hidden = randomUUID(),
      user = randomUUID(),
      worker = randomUUID(),
      task = randomUUID();
    const c = await root.connect();
    let oldRows: any[] = [];
    try {
      await c.query("BEGIN");
      const files = (await readdir("db/migrations"))
        .filter((f) => f.endsWith(".sql"))
        .sort();
      for (const file of files.filter((f) => f < "005_"))
        await c.query(await readFile("db/migrations/" + file, "utf8"));
      await c.query(
        "INSERT INTO eoms.companies(id,name) VALUES($1,'Current baseline company is not historical evidence')",
        [company],
      );
      await c.query(
        "INSERT INTO eoms.estates(id,company_id,code,name) VALUES($1,$2,'HIST-OWN','Historical assigned estate'),($3,$2,'HIST-HIDDEN','Hidden historical sibling')",
        [estate, company, hidden],
      );
      await c.query(
        "INSERT INTO eoms.users(id,email,display_name,password_hash) VALUES($1,'history-reader@fixture.local','Historical review clerk','not-a-login-password')",
        [user],
      );
      await c.query(
        "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'clerk')",
        [user, estate],
      );
      await c.query(
        "INSERT INTO eoms.workers(id,estate_id,code,name) VALUES($1,$2,'OLD-WORKER','Historical fixture worker')",
        [worker, estate],
      );
      await c.query(
        "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'OLD-GANG','Historical fixture gang')",
        [estate],
      );
      await c.query(
        "INSERT INTO eoms.occurrences(id,estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,$2,'OLD-BLOCK','OLD-TASK-%_','Historical activity','OLD',10)",
        [task, estate],
      );
      oldRows = (
        await c.query(
          "INSERT INTO eoms.musters(estate_id,occurrence_id,business_date,gang_code,quantity_ha,status,created_by,confirmed_at) SELECT $1,$2,'2026-01-15','OLD-GANG',0.1,'confirmed',$3,'2026-01-16T08:00:00Z' FROM generate_series(1,28) RETURNING id",
          [estate, task, user],
        )
      ).rows.sort((a, b) => a.id.localeCompare(b.id));
      await c.query(
        "INSERT INTO eoms.muster_shares(estate_id,muster_id,worker_id,quantity_ha,man_days) SELECT estate_id,id,$2,quantity_ha,1 FROM eoms.musters WHERE estate_id=$1",
        [estate, worker],
      );
      for (const file of files.filter((f) => f >= "005_"))
        await c.query(await readFile("db/migrations/" + file, "utf8"));
      // A modern insert must receive a real snapshot and remain outside the unresolved queue.
      const modern = (
        await c.query(
          "INSERT INTO eoms.musters(estate_id,occurrence_id,business_date,gang_code,quantity_ha,created_by) VALUES($1,$2,'2026-02-15','OLD-GANG',0.1,$3) RETURNING legal_company_id",
          [estate, task, user],
        )
      ).rows[0];
      if (modern.legal_company_id !== company)
        throw Error("Modern fixture attribution was not captured");
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    const raw = token();
    await root.query(
      "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'synthetic-history-ui',now()+interval '1 hour')",
      [hash(raw), user],
    );
    const runtimeRole = (
      await runtime.query(
        "SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    if (
      runtimeRole.name !== "eoms_app" ||
      runtimeRole.rolsuper ||
      runtimeRole.rolbypassrls
    )
      throw Error(
        "Historical browser API requires the restricted runtime role",
      );
    const app = createApp(runtime);
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Historical API address unavailable");
    async function snapshot() {
      return {
        work: (
          await root!.query(
            "SELECT * FROM eoms.musters WHERE estate_id=$1 ORDER BY id",
            [estate],
          )
        ).rows,
        shares: (
          await root!.query(
            "SELECT * FROM eoms.muster_shares WHERE estate_id=$1 ORDER BY muster_id,worker_id",
            [estate],
          )
        ).rows,
        audit: (
          await root!.query(
            "SELECT * FROM eoms.audit WHERE estate_id=$1 ORDER BY id",
            [estate],
          )
        ).rows,
      };
    }
    return {
      root,
      estate,
      hidden,
      user,
      task,
      worker,
      target: oldRows.at(-1)!.id,
      oldIds: oldRows.map((r) => r.id),
      raw,
      apiURL: `http://127.0.0.1:${address.port}`,
      snapshot,
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
