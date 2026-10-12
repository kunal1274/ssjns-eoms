import pg from "pg";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
try {
  loadEnvFile(".env");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const fixtureDb = new pg.Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
});
const taskCode = "SMOKE-" + randomUUID().slice(0, 8);
await fixtureDb.query(
  "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES('20000000-0000-4000-8000-000000000001','SMOKE',$1,'Smoke spraying','QA',2)",
  [taskCode],
);
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const accounts = JSON.parse(await readFile(".local/dev-accounts.json", "utf8"));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.BROWSER_BASE_URL || "http://localhost:5174");
  const a = accounts.find(
    (x) => x.role === "supervisor" && x.email.startsWith("supervisor"),
  );
  await page.getByLabel("Email", { exact: true }).fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(a.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Muster register", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "+ New muster", exact: true }).click();
  await page.getByLabel("Work date", { exact: true }).fill("2026-09-28");
  await page.getByLabel("Find task", { exact: true }).fill(taskCode);
  await page.getByRole("button", { name: "Search tasks", exact: true }).click();
  await page
    .locator('select[name="task"] option')
    .filter({ hasText: taskCode })
    .waitFor({ state: "attached" });

  await page.getByLabel("Area (Ha)", { exact: true }).fill("0.10");
  const gang = "G-01";
  await page.getByLabel("Gang code", { exact: true }).selectOption("G-01");
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = await (await responsePromise).json();
  const row = page.locator(`[data-record-id="${saved.id}"]`);
  while (
    !(await row.count()) &&
    (await page.getByRole("button", { name: "Load more", exact: true }).count())
  )
    await page.getByRole("button", { name: "Load more", exact: true }).click();
  await row.waitFor();
  await row.getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm muster", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Muster detail · confirmed", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Muster register", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "+ New muster", exact: true })
    .waitFor();
  while (
    !(await row.count()) &&
    (await page.getByRole("button", { name: "Load more", exact: true }).count())
  )
    await page.getByRole("button", { name: "Load more", exact: true }).click();
  await page
    .locator(`[data-record-id="${saved.id}"]`)
    .filter({ hasText: "confirmed" })
    .waitFor();
  const denied = await page.evaluate(
    async () =>
      (await fetch("/api/estates/20000000-0000-4000-8000-000000000002/musters"))
        .status,
  );
  if (denied !== 403) throw Error("Cross-estate access not denied");
  await page.getByRole("button", { name: "Audit trail", exact: true }).click();
  await page.getByText("muster.confirmed", { exact: true }).first().waitFor();
  await page
    .getByRole("button", { name: "Muster register", exact: true })
    .click();
  await page.screenshot({ path: "docs/browser-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "docs/browser-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS browser: authenticated create, confirm, persisted refresh, audit, cross-estate denial, logout; desktop/mobile screenshots saved.",
  );
} finally {
  await browser.close();
  await fixtureDb.end();
}
