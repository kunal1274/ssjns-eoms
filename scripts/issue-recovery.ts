import "../apps/api/src/config";
import pg from "pg";
import { z } from "zod";
import { token, hash } from "../apps/api/src/security";
if (process.env.NODE_ENV === "production")
  throw Error(
    "Local password recovery is restricted to development/test. Use the approved identity provider.",
  );
const [subject, reference, ...reasonParts] = process.argv.slice(2),
  reason = reasonParts.join(" ");
z.string().uuid().parse(subject);
z.string().min(5).max(200).parse(reference);
z.string().min(10).max(500).parse(reason);
if (!process.env.ADMIN_DATABASE_URL)
  throw Error(
    "ADMIN_DATABASE_URL is required for the authorized recovery operator.",
  );
const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  const u = await c.query(
    "SELECT password_hash FROM eoms.users WHERE id=$1 AND active FOR UPDATE",
    [subject],
  );
  if (!u.rowCount) throw Error("Active account unavailable.");
  const raw = token();
  await c.query("DELETE FROM eoms.recovery_tokens WHERE user_id=$1", [subject]);
  await c.query(
    "INSERT INTO eoms.recovery_tokens(token_hash,user_id,credential_version,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes')",
    [hash(raw), subject, u.rows[0].password_hash],
  );
  await c.query(
    "INSERT INTO eoms.security_events(subject_id,action,detail) VALUES($1,'recovery.issued',jsonb_build_object('operator',current_user,'reference',$2::text,'reason',$3::text,'identityProof','operator-declared; not independently attested'))",
    [subject, reference, reason],
  );
  await c.query("COMMIT");
  // This one-time credential is output only to the authorized operator, never normal server logs.
  process.stdout.write(
    JSON.stringify({ token: raw, expiresInMinutes: 15 }) + "\n",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
