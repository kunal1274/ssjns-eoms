import { randomUUID } from "node:crypto";
import { hash, token } from "../apps/api/src/security";
import type { upgradedWorkFixture } from "./upgraded-work-fixture";
export async function independentSourceReviewer(
  f: Awaited<ReturnType<typeof upgradedWorkFixture>>,
) {
  const id = randomUUID(),
    raw = token();
  await f.root.query(
    "INSERT INTO eoms.users(id,email,display_name,password_hash) VALUES($1,$2,'Independent synthetic source reviewer','not-a-login-password')",
    [id, "source-review-" + id + "@fixture.local"],
  );
  await f.root.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [id, f.estate],
  );
  await f.root.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [f.customer, id],
  );
  await f.root.query(
    "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'synthetic-history-ui',now()+interval '1 hour')",
    [hash(raw), id],
  );
  return { id, raw };
}

// A restored synthetic user must authenticate again; never resurrect the old token.
export async function freshSyntheticSession(
  f: Awaited<ReturnType<typeof upgradedWorkFixture>>,
  user: string,
) {
  const raw = token();
  await f.root.query(
    "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'synthetic-history-ui',now()+interval '1 hour')",
    [hash(raw), user],
  );
  return raw;
}
