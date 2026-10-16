import { browserOptions } from "./browser-options.mjs";
import { chromium } from "playwright";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const dir = await mkdtemp(join(tmpdir(), "eoms-install-"));
let context;
try {
  context = await chromium.launchPersistentContext(dir, browserOptions());
  const page = await context.newPage();
  await page.goto(process.env.PWA_BASE_URL || "http://localhost:5175");
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15000 },
  );
  await page.reload();
  const c = await context.newCDPSession(page);
  const manifest = await c.send("Page.getAppManifest"),
    result = await c.send("Page.getInstallabilityErrors");
  assert.deepEqual(manifest.errors, []);
  assert.deepEqual(result.installabilityErrors, []);
  await writeFile(
    "docs/pwa-installability.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        browser: context.browser()?.version() || "Chrome persistent context",
        manifestErrors: manifest.errors,
        installabilityErrors: result.installabilityErrors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS Chrome manifest and installability checks (non-incognito profile).",
  );
} finally {
  await context?.close();
  await rm(dir, { recursive: true, force: true });
}
