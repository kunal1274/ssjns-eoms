import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const accounts = JSON.parse(await readFile(".local/dev-accounts.json", "utf8"));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const suffix = String(Date.now());
try {
  await page.goto("http://localhost:5174");
  const a = accounts.find((x) => x.email === "manager@eoms.local");
  await page.getByLabel("Email", { exact: true }).fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(a.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Muster register", exact: true })
    .waitFor();
  await page
    .getByLabel("Estate", { exact: true })
    .selectOption({ label: "Senama Estate" });
  await page.getByRole("button", { name: "Workers", exact: true }).click();
  await page.getByRole("button", { name: "Add worker", exact: true }).click();
  await page.getByLabel("Worker code", { exact: true }).fill("QA-" + suffix);
  await page
    .getByLabel("Worker name", { exact: true })
    .fill("Browser Worker " + suffix);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page.getByLabel("Search workers", { exact: true }).fill(suffix);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  let row = page.getByRole("row").filter({ hasText: "QA-" + suffix });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Active worker", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await row.getByText("Inactive", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Task capacity", exact: true })
    .click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("Block code", { exact: true }).fill("QA");
  await page.getByLabel("Task code", { exact: true }).fill(suffix);
  await page.getByLabel("Activity", { exact: true }).fill("Browser spraying");
  await page.getByLabel("Round code", { exact: true }).fill("QA-1");
  await page.getByLabel("Capacity (Ha)", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page.getByLabel("Search tasks", { exact: true }).fill(suffix);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  row = page.getByRole("row").filter({ hasText: "QA / " + suffix });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Capacity (Ha)", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await row.getByText("3.00 Ha", { exact: true }).first().waitFor();
  await page
    .getByRole("button", { name: "Operational periods", exact: true })
    .click();
  const year = String(4000 + Math.floor(Math.random() * 4000));
  await page.getByLabel("Calendar year", { exact: true }).fill(year);
  await page.getByRole("button", { name: "Add period", exact: true }).click();
  await page.getByLabel("Month", { exact: true }).fill(year + "-02");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  row = page.getByRole("row").filter({ hasText: year + "-02" });
  await row.getByRole("button", { name: "Lock", exact: true }).click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Browser verification closure");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await row.getByText("Locked", { exact: true }).waitFor();
  await row.getByRole("button", { name: "Reopen", exact: true }).click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Browser verification correction");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await row.getByText("Open", { exact: true }).waitFor();
  await page.screenshot({
    path: "docs/maintenance-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({
    path: "docs/maintenance-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Muster register", exact: true })
    .click();
  await page.getByRole("button", { name: "+ New muster", exact: true }).click();
  await page.getByLabel("Find task", { exact: true }).fill(suffix);
  await page.getByRole("button", { name: "Search tasks", exact: true }).click();
  await page
    .getByRole("option")
    .filter({ hasText: suffix })
    .waitFor({ state: "attached" });
  await page.getByLabel("Find worker", { exact: true }).fill(suffix);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/catalog/workers") && r.status() === 200,
    ),
    page.getByRole("button", { name: "Search workers", exact: true }).click(),
  ]);
  await page
    .getByRole("button", { name: "Search workers", exact: true })
    .waitFor();
  assert.equal(await page.getByRole("checkbox").count(), 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS maintenance browser: worker create/deactivate/search, task create/capacity edit/search, period open/lock/reopen, capture selectors and responsive screenshots.",
  );
} finally {
  await browser.close();
}
