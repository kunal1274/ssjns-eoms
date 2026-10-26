import "../apps/api/src/config";
import pg from "pg";
if (!process.env.ADMIN_DATABASE_URL)
  throw Error("An authorized maintenance connection is required.");
const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  c = await pool.connect();
try {
  await c.query("BEGIN");
  const counts: Record<string, number> = {};
  for (const [name, sql] of [
    [
      "sessions",
      "DELETE FROM eoms.sessions WHERE expires_at<=now() OR last_seen_at<=now()-interval '30 minutes'",
    ],
    ["recovery", "DELETE FROM eoms.recovery_tokens WHERE expires_at<=now()"],
    ["oidc", "DELETE FROM eoms.oidc_transactions WHERE expires_at<=now()"],
    [
      "attempts",
      "DELETE FROM eoms.auth_attempt_buckets WHERE window_start<now()-interval '2 hours'",
    ],
  ])
    counts[name] = (await c.query(sql)).rowCount ?? 0;
  await c.query("COMMIT");
  console.log(
    JSON.stringify({
      removedExpiredState: counts,
      securityHistoryRetained: true,
    }),
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
