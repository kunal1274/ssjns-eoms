import { browserOptions } from "./browser-options.mjs";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import pg from "pg";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
try {
  loadEnvFile(".env");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  estate = "20000000-0000-4000-8000-000000000001",
  marker = "PWA-" + randomUUID().slice(0, 8),
  month = `${8000 + Math.floor(Math.random() * 1000)}-11-01`,
  date = month.slice(0, 8) + "15";
await admin.query("INSERT INTO eoms.periods(estate_id,month) VALUES($1,$2)", [
  estate,
  month,
]);
await admin.query(
  "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'PWA',$2,'Offline test','PWA',100)",
  [estate, marker],
);
const accounts = JSON.parse(await readFile(".local/dev-accounts.json", "utf8"));
const browser = await chromium.launch(browserOptions()),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function login(email = "supervisor@eoms.local") {
  const a = accounts.find((a) => a.email === email);
  await page.getByLabel("Email", { exact: true }).fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(a.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Muster register", exact: true })
    .waitFor();
}
async function prepare() {
  await page.getByRole("button", { name: "+ New muster", exact: true }).click();
  await page.getByLabel("Find task", { exact: true }).fill(marker);
  await page.getByRole("button", { name: "Search tasks", exact: true }).click();
  await page
    .locator('select[name="task"] option')
    .filter({ hasText: marker })
    .waitFor({ state: "attached" });
  await page.getByLabel("Gang code", { exact: true }).selectOption("G-01");
  await page.getByLabel("Work date", { exact: true }).fill(date);
  await page.getByLabel("Area (Ha)", { exact: true }).fill("0.20");
  await page.getByRole("checkbox").first().check();
}
async function queueOne() {
  await prepare();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Save on device", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Device drafts (1)", exact: true })
    .waitFor();
}
async function deviceRows() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("eoms-device-drafts", 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("drafts").objectStore("drafts").getAll();
          q.onsuccess = () => {
            db.close();
            resolve(q.result);
          };
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
try {
  await page.goto(process.env.PWA_BASE_URL || "http://localhost:5175");
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15000 },
  );
  await page.reload();
  await login();
  await queueOne();
  const key = (await deviceRows())[0].id;
  await page.screenshot({ path: "docs/offline-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: "docs/offline-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.reload();
  await page.getByText(/Offline. Reconnect to sign in/).waitFor();
  assert.equal((await deviceRows()).length, 1);
  const cached = await page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys())
      for (const r of await (await caches.open(name)).keys())
        result.push(r.url);
    return result;
  });
  assert.ok(cached.some((u) => u.endsWith("/index.html")));
  assert.ok(!cached.some((u) => u.includes("/api/")));
  await context.setOffline(false);
  await page.reload();
  await page
    .getByRole("heading", { name: "Device drafts (1)", exact: true })
    .waitFor();
  // Server failures must retain the draft and explain recovery without private bodies.
  await page.route("**/api/estates/*/musters", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "PRIVATE-SYNC-DETAIL",
            requestId: "12345678-1234-1234-1234-123456789abc",
          }),
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Sync drafts", exact: true }).click();
  const pause = page.getByRole("status").filter({ hasText: "Sync paused" });
  await pause.filter({ hasText: "Support reference:" }).waitFor();
  assert.doesNotMatch(await pause.innerText(), /PRIVATE-SYNC-DETAIL/);
  assert.equal((await deviceRows())[0].id, key);
  assert.equal((await deviceRows())[0].status, "pending");
  await page.unroute("**/api/estates/*/musters");
  let intercepted = false;
  await page.route("**/api/estates/*/musters", async (route) => {
    if (route.request().method() === "POST" && !intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Sync drafts", exact: true }).click();
  await page.getByText(/Sync paused/).waitFor();
  assert.equal((await deviceRows())[0].id, key);
  await page.unroute("**/api/estates/*/musters");
  await page.getByRole("button", { name: "Sync drafts", exact: true }).click();
  await page
    .getByRole("heading", { name: "Device drafts (0)", exact: true })
    .waitFor();
  const stored = await admin.query(
    "SELECT response FROM eoms.idempotency WHERE estate_id=$1 AND key=$2",
    [estate, key],
  );
  assert.equal(stored.rowCount, 1);
  const saved = await admin.query(
    "SELECT status FROM eoms.musters WHERE id=$1",
    [stored.rows[0].response.id],
  );
  assert.equal(saved.rows[0].status, "draft");
  await queueOne();
  await context.setOffline(false);
  await context.clearCookies();
  await page.getByRole("button", { name: "Sync drafts", exact: true }).click();
  await page
    .getByRole("status")
    .filter({
      hasText: "Sign in again before syncing. Your drafts are retained.",
    })
    .waitFor();
  assert.equal((await deviceRows()).length, 1);
  await page.reload();
  await login("manager@eoms.local");
  await page
    .getByRole("heading", { name: "Device drafts (0)", exact: true })
    .waitFor();
  assert.equal((await deviceRows()).length, 1);
  await context.clearCookies();
  await page.reload();
  await login();
  await page
    .getByRole("heading", { name: "Device drafts (1)", exact: true })
    .waitFor();
  await admin.query(
    "UPDATE eoms.periods SET locked=true WHERE estate_id=$1 AND month=$2",
    [estate, month],
  );
  await page.getByRole("button", { name: "Sync drafts", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "This operational period is locked" })
    .waitFor();
  assert.equal((await deviceRows())[0].status, "blocked");
  await page.reload();
  await page
    .getByRole("alert")
    .filter({ hasText: "This operational period is locked" })
    .waitFor();
  await admin.query(
    "UPDATE eoms.periods SET locked=false WHERE estate_id=$1 AND month=$2",
    [estate, month],
  );
  await page
    .getByRole("button", { name: "Retry after correction", exact: true })
    .click();
  await page.getByRole("button", { name: "Sync drafts", exact: true }).click();
  await page
    .getByRole("heading", { name: "Device drafts (0)", exact: true })
    .waitFor();
  await queueOne();
  await context.setOffline(false);

  await Promise.all([
    page.waitForEvent("dialog").then((d) => d.dismiss()),
    page.getByRole("button", { name: "Sign out", exact: true }).click(),
  ]);
  await page
    .getByRole("heading", { name: "Device drafts (1)", exact: true })
    .waitFor();
  await Promise.all([
    page.waitForEvent("dialog").then((d) => d.accept()),
    page.getByRole("button", { name: "Sign out", exact: true }).click(),
  ]);
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  assert.equal((await deviceRows()).length, 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS PWA: static-only cache, offline capture/reload retention, lost-response exactly-once retry, session expiry, account isolation, locked-period conflict and logout discard protection.",
  );
} catch (e) {
  await page.screenshot({ path: ".local/offline-failure.png", fullPage: true });
  throw e;
} finally {
  await context.setOffline(false);
  await admin.query(
    "UPDATE eoms.periods SET locked=false WHERE estate_id=$1 AND month=$2",
    [estate, month],
  );
  await admin.end();
  await browser.close();
}
