import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const accounts = JSON.parse(await readFile(".local/dev-accounts.json", "utf8")),
  browser = await chromium.launch({ headless: true, channel: "chrome" }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
  suffix = String(Date.now()),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:5174");
  const a = accounts.find((a) => a.email === "manager@eoms.local");
  await page.getByLabel("Email", { exact: true }).fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(a.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Muster register", exact: true })
    .waitFor();
  await page
    .getByLabel("Estate", { exact: true })
    .selectOption({ label: "Senama Estate" });
  await page.getByRole("button", { name: "Gangs", exact: true }).click();
  await page.getByRole("button", { name: "Add gang", exact: true }).click();
  await page.getByLabel("Gang code", { exact: true }).fill("WF-" + suffix);
  await page
    .getByLabel("Gang name", { exact: true })
    .fill("Browser workflow gang");
  await page.getByLabel("Senama Supervisor", { exact: true }).check();
  await page.getByRole("button", { name: "Save gang", exact: true }).click();
  await page
    .getByRole("heading", { name: "Add gang", exact: true })
    .waitFor({ state: "hidden" });
  await page.getByLabel("Search gangs", { exact: true }).fill(suffix);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "WF-" + suffix })
    .waitFor();
  await page
    .getByRole("button", { name: "Task capacity", exact: true })
    .click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  for (const [label, value] of [
    ["Block code", "WF"],
    ["Task code", suffix],
    ["Activity", "Workflow spraying"],
    ["Round code", "WF-1"],
    ["Capacity (Ha)", "2"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page
    .getByRole("button", { name: "Muster register", exact: true })
    .click();
  await page.getByRole("button", { name: "+ New muster", exact: true }).click();
  await page.getByLabel("Find task", { exact: true }).fill(suffix);
  await page.getByRole("button", { name: "Search tasks", exact: true }).click();
  await page
    .locator('select[name="task"] option')
    .filter({ hasText: suffix })
    .waitFor({ state: "attached" });
  await page.getByLabel("Find gang", { exact: true }).fill(suffix);
  await page.getByRole("button", { name: "Search gangs", exact: true }).click();
  await page
    .getByLabel("Gang code", { exact: true })
    .selectOption("WF-" + suffix);
  await page.getByLabel("Area (Ha)", { exact: true }).fill("1");
  await page.getByRole("checkbox").first().check();
  const pending = page.waitForResponse(
    (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = await (await pending).json();
  const row = page.locator(`[data-record-id="${saved.id}"]`);
  await row.getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm muster", exact: true })
    .click();
  await page.getByRole("button", { name: "Approve work", exact: true }).click();
  await page
    .getByLabel("Action reason", { exact: true })
    .fill("Field evidence verified in browser test");
  await page
    .getByRole("button", { name: "Submit approval", exact: true })
    .click();
  await page.getByText("Review: Approved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Reverse work", exact: true }).click();
  await page
    .getByLabel("Action reason", { exact: true })
    .fill("Duplicate capture identified in browser test");
  await page
    .getByRole("button", { name: "Submit reversal", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Muster detail · reversed", exact: true })
    .waitFor();
  await page.reload();
  await page
    .locator(`[data-record-id="${saved.id}"]`)
    .getByRole("button", { name: "View", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Muster detail · reversed", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Confirm muster", exact: true })
      .count(),
    0,
  );
  await page.screenshot({ path: "docs/workflow-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: "docs/workflow-mobile.png", fullPage: true });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS workflow browser: gang assignment, new task, capture, confirm, approve, reasoned reversal and persisted read-only evidence.",
  );
} catch (error) {
  await page.screenshot({
    path: ".local/workflow-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
