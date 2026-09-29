import "../apps/api/src/config.ts";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(6543271)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS public.eoms_schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  for (const file of (await readdir("db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const existing = await client.query(
      "SELECT 1 FROM public.eoms_schema_migrations WHERE name=$1",
      [file],
    );
    if (!existing.rowCount) {
      await client.query(await readFile("db/migrations/" + file, "utf8"));
      await client.query(
        "INSERT INTO public.eoms_schema_migrations(name) VALUES($1)",
        [file],
      );
      console.log("Applied", file);
    }
  }
  if (!process.env.APP_DB_PASSWORD)
    throw Error("APP_DB_PASSWORD required to configure runtime role");
  const result = await client.query(
    "SELECT format('ALTER ROLE eoms_app PASSWORD %L',$1::text) AS sql",
    [process.env.APP_DB_PASSWORD],
  );
  await client.query(result.rows[0].sql);
  await client.query("COMMIT");
  console.log("Migrations complete; restricted runtime role configured.");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
