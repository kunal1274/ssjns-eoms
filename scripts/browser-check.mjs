import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const accounts = JSON.parse(await readFile(".local/dev-accounts.json", "utf8"));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:5174");
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
  await page.getByLabel("Area (Ha)", { exact: true }).fill("0.10");
  const gang = "QA-" + Date.now();
  await page.getByLabel("Gang code", { exact: true }).fill(gang);
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: gang });
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
    .getByRole("row")
    .filter({ hasText: gang })
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
}
