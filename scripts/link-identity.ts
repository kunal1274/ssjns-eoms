import "../apps/api/src/config";
import pg from "pg";
import { z } from "zod";
const [user, issuer, subject, action, reference, ...reasonParts] =
    process.argv.slice(2),
  reason = reasonParts.join(" ");
z.string().uuid().parse(user);
const url = new URL(issuer);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.hash ||
  url.search
)
  throw Error("Explicit HTTPS issuer required.");
z.string().min(1).max(255).parse(subject);
z.enum(["link", "revoke"]).parse(action);
z.string().min(5).max(200).parse(reference);
z.string().min(10).max(500).parse(reason);
if (!process.env.ADMIN_DATABASE_URL)
  throw Error(
    "ADMIN_DATABASE_URL is required for the authorized identity operator.",
  );
const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  c = await pool.connect();
try {
  await c.query("BEGIN");
  if (
    !(
      await c.query(
        "SELECT id FROM eoms.users WHERE id=$1 AND active FOR UPDATE",
        [user],
      )
    ).rowCount
  )
    throw Error("Active named user required.");
  const prior = await c.query(
    "SELECT user_id FROM eoms.identity_links WHERE issuer=$1 AND subject=$2 FOR UPDATE",
    [issuer, subject],
  );
  if (prior.rowCount && prior.rows[0].user_id !== user)
    throw Error(
      "Identity already belongs to another account. Reassignment is not implicit.",
    );
  if (action === "revoke" && !prior.rowCount)
    throw Error("Identity link unavailable.");
  await c.query(
    "INSERT INTO eoms.identity_links(issuer,subject,user_id,active,reference,reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(issuer,subject) DO UPDATE SET active=excluded.active,reference=excluded.reference,reason=excluded.reason",
    [issuer, subject, user, action === "link", reference, reason],
  );
  await c.query("COMMIT");
  console.log(
    "Explicit identity link recorded. No tenant or operational assignments were created.",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
