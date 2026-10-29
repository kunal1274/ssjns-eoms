import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { browserOptions } from "./browser-options.mjs";
const ledger = JSON.parse(
  await readFile(".local/e2e-ledger/coverage.json", "utf8"),
);
assert.equal(
  ledger.run?.status,
  "passed",
  "A completed real journey run is required",
);
assert.ok(
  ledger.counts.passed > 0 && ledger.counts.untested > 0,
  "Initial inventory must show evidence and known gaps",
);
const browser = await chromium.launch(browserOptions());
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve(".local/e2e-ledger/index.html")).href);
  const rows = page.locator("tbody tr:visible");
  assert.equal(await rows.count(), ledger.rows.length);
  await page.getByLabel("Status", { exact: true }).selectOption("passed");
  assert.equal(await rows.count(), ledger.counts.passed);
  await page.getByLabel("Status", { exact: true }).selectOption("untested");
  await page.getByLabel("Screen", { exact: true }).selectOption("Audit trail");
  const expected = ledger.rows.filter(
    (r) => r.status === "untested" && r.screen === "Audit trail",
  ).length;
  assert.equal(await rows.count(), expected);
  assert.equal(
    await page.getByRole("status").innerText(),
    expected + " inventory/project rows shown",
  );
  await page.getByLabel("Status", { exact: true }).selectOption("");
  await page.getByLabel("Screen", { exact: true }).selectOption("");
  assert.equal(await rows.count(), ledger.rows.length);
  assert.deepEqual(errors, []);
  console.log(
    "PASS coverage ledger UI: real run, status/screen filters, known gaps and restored rows.",
  );
} finally {
  await browser.close();
}
