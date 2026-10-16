import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { MusterPage } from "./pages/MusterPage";
type Account = { email: string; password: string };
type Work = { taskCode: string; date: string; db: pg.Pool };
export const estateId = "20000000-0000-4000-8000-000000000001";
export const test = base.extend<{
  supervisor: Account;
  setupAdmin: Account;
  muster: MusterPage;
  work: Work;
}>({
  supervisor: async ({}, use) => {
    const accounts = JSON.parse(
      await readFile(".local/test-accounts.json", "utf8"),
    ) as Account[];
    const account = accounts.find((a) => a.email === "supervisor@eoms.local");
    if (!account)
      throw Error("Seed isolated test accounts with npm run db:test first.");
    await use(account);
  },
  setupAdmin: async ({}, use) => {
    const accounts = JSON.parse(
      await readFile(".local/test-accounts.json", "utf8"),
    ) as Account[];
    const account = accounts.find((a) => a.email === "manager@eoms.local");
    if (!account) throw Error("Seed explicit synthetic setup grant first.");
    await use(account);
  },
  muster: async ({ page }, use) => {
    await use(new MusterPage(page));
  },
  work: async ({}, use) => {
    const url = new URL(process.env.ADMIN_DATABASE_URL!);
    if (url.hostname !== "127.0.0.1")
      throw Error("Fixtures require local synthetic PostgreSQL.");
    url.pathname = "/eoms_test";
    const db = new pg.Pool({ connectionString: url.href });
    const taskCode = "JRN-" + randomUUID().slice(0, 12);
    // One fixture owns its task. Append-only audit/work remains as synthetic evidence.
    const month = "8800-12-01";
    try {
      await db.query(
        "INSERT INTO eoms.periods(estate_id,month) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [estateId, month],
      );
      await db.query(
        "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'E2E',$2,'Journey spraying','E2E',2)",
        [estateId, taskCode],
      );
      await use({ taskCode, date: "8800-12-15", db });
    } finally {
      await db.end();
    }
  },
});
export { expect };
