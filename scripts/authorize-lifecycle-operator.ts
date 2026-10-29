import "../apps/api/src/config";
import pg from "pg";
import { z } from "zod";
const [user, action, reference, ...reasonParts] = process.argv.slice(2),
  reason = reasonParts.join(" ");
z.string().uuid().parse(user);
z.enum(["granted", "revoked"]).parse(action);
z.string().min(5).max(200).parse(reference);
z.string().min(10).max(500).parse(reason);
if (!process.env.ADMIN_DATABASE_URL)
  throw Error("Authorized administration connection required.");
const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(6543808)");
  if (
    !(
      await c.query(
        "SELECT id FROM eoms.users WHERE id=$1 AND active FOR UPDATE",
        [user],
      )
    ).rowCount
  )
    throw Error("Named active operator required.");
  await c.query(
    "INSERT INTO eoms.platform_lifecycle_authority(subject_id,action,user_scope_revision,reference,reason) SELECT $1,$2,coalesce(max(id),0),$3,$4 FROM eoms.mapping_policy_scope_events WHERE subject_id=$1 AND kind='user-active'",
    [user, action, reference, reason],
  );
  await c.query(
    "INSERT INTO eoms.security_events(subject_id,action,detail) VALUES($1,'lifecycle.operator-appointment',jsonb_build_object('operator',current_user,'action',$2::text,'reference',$3::text,'reason',$4::text))",
    [user, action, reference, reason],
  );
  await c.query("COMMIT");
  console.log(
    "Explicit global lifecycle authority recorded. No business permissions granted.",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
