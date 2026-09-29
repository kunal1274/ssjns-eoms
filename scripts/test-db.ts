import "../apps/api/src/config.ts";
import pg from "pg";
import { spawnSync } from "node:child_process";
const adminURL = new URL(process.env.ADMIN_DATABASE_URL!);
const runtimeURL = new URL(process.env.DATABASE_URL!);
if (adminURL.hostname !== "127.0.0.1")
  throw Error("Test setup is restricted to local PostgreSQL");
const pool = new pg.Pool({ connectionString: adminURL.href });
const exists = await pool.query(
  "SELECT 1 FROM pg_database WHERE datname='eoms_test'",
);
if (!exists.rowCount) await pool.query("CREATE DATABASE eoms_test");
await pool.end();
adminURL.pathname = "/eoms_test";
runtimeURL.pathname = "/eoms_test";
for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) {
  const run = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      ADMIN_DATABASE_URL: adminURL.href,
      DATABASE_URL: runtimeURL.href,
      ACCOUNTS_FILE: ".local/test-accounts.json",
    },
  });
  if (run.status !== 0) process.exit(run.status || 1);
}
console.log("Isolated eoms_test database ready.");
