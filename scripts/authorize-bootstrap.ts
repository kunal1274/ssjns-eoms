import "../apps/api/src/config";
import pg from "pg";
import { z } from "zod";
// Explicit operator action through the administrative connection; never automatic seed behavior.
const [subjectArg, actionArg, referenceArg, reasonArg, ...extra] =
  process.argv.slice(2);
if (extra.length)
  throw Error(
    "Use: npm run provisioning:authorize -- USER_UUID granted|revoked REFERENCE REASON",
  );
const subject = z.string().uuid().parse(subjectArg),
  action = z.enum(["granted", "revoked"]).parse(actionArg),
  reference = z.string().trim().min(3).max(240).parse(referenceArg),
  reason = z.string().trim().min(3).max(500).parse(reasonArg);
if (!process.env.ADMIN_DATABASE_URL)
  throw Error("Explicit administrative database configuration is required.");
const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,624))", [
    subject,
  ]);
  const user = await c.query(
    "SELECT id FROM eoms.users WHERE id=$1 AND active FOR SHARE",
    [subject],
  );
  if (!user.rowCount) throw Error("An existing active user is required.");
  await c.query(
    "INSERT INTO eoms.platform_bootstrap_authority(subject_id,action,user_scope_revision,reference,reason) SELECT $1,$2,coalesce(max(id),0),$3,$4 FROM eoms.mapping_policy_scope_events WHERE subject_id=$1 AND kind='user-active'",
    [subject, action, reference, reason],
  );
  await c.query("COMMIT");
  console.log(
    "Recorded explicit platform bootstrap authority change. Tenant access was not granted.",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
