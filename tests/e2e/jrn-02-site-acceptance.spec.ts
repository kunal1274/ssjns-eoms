import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { token, hash } from "../../apps/api/src/security";

async function fixture(db: Pool) {
  const code = "SITE-UAT-" + randomUUID().slice(0, 10);
  const actors = (
    await db.query(
      "SELECT id,email FROM eoms.users WHERE email IN ('manager@eoms.local','supervisor@eoms.local')",
    )
  ).rows;
  const manager = actors.find((x) => x.email === "manager@eoms.local")!.id,
    supervisor = actors.find((x) => x.email === "supervisor@eoms.local")!.id;
  const customer = (
    await db.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,'ZZZ site acceptance fixture') RETURNING id",
      [code],
    )
  ).rows[0].id;
  const company = (
    await db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Site acceptance company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const estate = (
    await db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Site acceptance estate') RETURNING id",
      [customer, company, code],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [customer, manager],
  );
  for (const id of [manager, supervisor])
    await db.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,$3)",
      [id, estate, id === manager ? "manager" : "supervisor"],
    );
  return {
    code,
    customer,
    company,
    estate,
    manager,
    supervisor,
    async cleanup() {
      await db.query(
        "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=ANY($2::uuid[])",
        [estate, [manager, supervisor]],
      );
      await db.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [customer, manager],
      );
    },
  };
}
async function open(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const guide = page.getByRole("region", {
    name: "Organization guide",
    exact: true,
  });
  await guide.getByLabel("Search Customer", { exact: true }).fill(f.code);
  await guide
    .getByRole("button", { name: "Find Customer", exact: true })
    .click();
  await guide.getByLabel("Customer", { exact: true }).selectOption(f.customer);
  await guide
    .getByRole("link", {
      name: "Go to operational site setup and history",
      exact: true,
    })
    .click();
  const panel = page.getByRole("region", {
    name: "Operational sites",
    exact: true,
  });
  await expect(panel).toBeInViewport();
  return panel;
}
async function find(panel: any, label: string, q: string) {
  await panel.getByLabel("Search " + label, { exact: true }).fill(q);
  await panel
    .getByRole("button", { name: "Find " + label, exact: true })
    .click();
}
async function writer(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  const session = await (await page.request.get("/api/auth/session")).json();
  const base = `/api/customers/${f.customer}/sites`;
  return {
    base,
    async post(path: string, data: unknown) {
      const r = await page.request.post(path, {
        headers: {
          Origin: "http://localhost:5284",
          "X-CSRF-Token": session.csrf,
        },
        data,
      });
      expect([200, 201], path).toContain(r.status());
      return r.json();
    },
  };
}

test("E2E-JRN-02-015 @regression unlinked facilities filters and paged history recover without losing drafts", async ({
  page,
  work,
  setupAdmin,
  muster,
}) => {
  const f = await fixture(work.db);
  try {
    await muster.signIn(setupAdmin);
    const api = await writer(page, f),
      panel = await open(page, f);
    const form = panel.getByRole("form", {
      name: "Operational site form",
      exact: true,
    });
    const sites: any[] = [];
    await test.step("Create all five unlinked facility types with required field and format prevention", async () => {
      for (const kind of [
        "mill",
        "nursery",
        "warehouse",
        "workshop",
        "other",
      ]) {
        await panel
          .getByRole("button", { name: "Create operational site", exact: true })
          .click();
        await expect(
          form.getByLabel("Site linked estate", { exact: true }),
        ).toHaveValue("unlinked");
        const save = form.getByRole("button", {
          name: "Save operational site",
          exact: true,
        });
        await expect(save).toBeDisabled();
        await form.getByLabel("Site type", { exact: true }).selectOption(kind);
        await form
          .getByLabel("Site responsible company", { exact: true })
          .selectOption(f.company);
        await expect(save).toBeEnabled();
        if (!sites.length) {
          await form.getByLabel("Site code", { exact: true }).fill("bad code");
          await save.click();
          await expect(
            form.getByLabel("Site code", { exact: true }),
          ).toBeFocused();
          await form
            .getByLabel("Site code", { exact: true })
            .fill("VALID-CODE");
          await save.click();
          await expect(
            form.getByLabel("Site name", { exact: true }),
          ).toBeFocused();
          await form
            .getByLabel("Site name", { exact: true })
            .fill("Required field check");
          await form
            .getByLabel("Site change reason", { exact: true })
            .fill("x");
          await save.click();
          await expect(
            form.getByLabel("Site change reason", { exact: true }),
          ).toBeFocused();
        }
        const code = `U-${kind.toUpperCase()}-${f.code.slice(-10)}`;
        await form.getByLabel("Site code", { exact: true }).fill(code);
        await form
          .getByLabel("Site name", { exact: true })
          .fill("Unlinked " + kind);
        await form
          .getByLabel("Site change reason", { exact: true })
          .fill("Create unlinked " + kind);
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/customers/${f.customer}/sites`) &&
            r.request().method() === "POST",
        );
        await save.click();
        const r = await response;
        expect(r.status()).toBe(201);
        const site = await r.json();
        sites.push(site);
        expect(site.estate_id).toBeNull();
        expect(site.company_id).toBe(f.company);
        expect(site.kind).toBe(kind);
        await expect(
          panel.locator(`[data-site-id="${site.id}"]`),
        ).toContainText("Not linked to an estate");
        await expect(
          panel.getByRole("button", {
            name: "Open linked estate",
            exact: true,
          }),
        ).toHaveCount(0);
      }
    });
    const bulk = "PAGE-" + f.code.slice(-10);
    await test.step("Page site choices with a real retry while retaining an unsaved facility draft", async () => {
      for (let i = 0; i < 27; i++)
        await api.post(api.base, {
          kind: "warehouse",
          code: `${bulk}-${i}`,
          name: "Paged warehouse " + i,
          companyId: f.company,
          estateId: null,
          reason: "Prepare authorized page fixture",
        });
      await panel
        .getByRole("button", { name: "Create operational site", exact: true })
        .click();
      await form
        .getByLabel("Site name", { exact: true })
        .fill("Retained unlinked draft");
      await form
        .getByLabel("Site change reason", { exact: true })
        .fill("Retain draft across failed site page");
      await find(panel, "Operational site", bulk);
      const select = panel.getByLabel("Operational site", { exact: true });
      await expect(select.locator('option:not([value=""])')).toHaveCount(25);
      let fail = true;
      const pattern = `**/api/navigation/customers/${f.customer}/sites?**`;
      await page.route(pattern, (route) =>
        fail && new URL(route.request().url()).searchParams.has("cursor")
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: "private site page failure",
                requestId: "11111111-4000-4000-8000-000000000001",
              }),
            })
          : route.continue(),
      );
      await panel
        .getByRole("button", { name: "More Operational site", exact: true })
        .click();
      await expect(
        panel.getByRole("button", {
          name: "Retry Operational site",
          exact: true,
        }),
      ).toBeVisible();
      await expect(select.locator('option:not([value=""])')).toHaveCount(25);
      await expect(
        form.getByLabel("Site change reason", { exact: true }),
      ).toHaveValue("Retain draft across failed site page");
      await expect(panel).not.toContainText("private site page failure");
      fail = false;
      await panel
        .getByRole("button", { name: "Retry Operational site", exact: true })
        .click();
      await expect(select.locator('option:not([value=""])')).toHaveCount(27);
      await expect(form.getByLabel("Site name", { exact: true })).toHaveValue(
        "Retained unlinked draft",
      );
      await page.unroute(pattern);
    });
    await test.step("Apply type and availability filters while retaining an explicitly selected out-of-filter site", async () => {
      await find(panel, "Operational site", "");
      for (const kind of [
        "mill",
        "nursery",
        "warehouse",
        "workshop",
        "other",
      ]) {
        const response = page.waitForResponse(
          (r) =>
            r.url().includes(`/navigation/customers/${f.customer}/sites?`) &&
            new URL(r.url()).searchParams.get("kind") === kind,
        );
        await panel
          .getByLabel("Site type filter", { exact: true })
          .selectOption(kind);
        const r = await response;
        expect(r.status()).toBe(200);
        const rows = (await r.json()).items;
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((x: any) => x.kind === kind)).toBe(true);
        await expect(
          panel
            .getByLabel("Operational site", { exact: true })
            .locator('option:not([value=""])'),
        ).toHaveCount(rows.length);
      }
      const target = sites.find((x) => x.kind === "other");
      await panel
        .getByLabel("Operational site", { exact: true })
        .selectOption(target.id);
      await expect(
        panel.locator(`[data-site-id="${target.id}"]`),
      ).toBeVisible();
      await panel
        .getByRole("button", { name: "Edit operational site", exact: true })
        .click();
      await form
        .getByLabel("Site availability", { exact: true })
        .selectOption("false");
      await form
        .getByLabel("Site change reason", { exact: true })
        .fill("Pause unlinked other facility");
      await form
        .getByRole("button", { name: "Save operational site", exact: true })
        .click();
      await expect(
        panel.locator(`[data-site-id="${target.id}"]`),
      ).toContainText("Paused · Version 2");
      await panel
        .getByRole("button", { name: "Clear site selection", exact: true })
        .click();
      const response = page.waitForResponse(
        (r) =>
          r.url().includes(`/navigation/customers/${f.customer}/sites?`) &&
          new URL(r.url()).searchParams.get("status") === "inactive",
      );
      await panel
        .getByLabel("Site status filter", { exact: true })
        .selectOption("inactive");
      expect(
        (await (await response).json()).items.map((x: any) => x.id),
      ).toEqual([target.id]);
      await expect(
        panel
          .getByLabel("Operational site", { exact: true })
          .locator('option:not([value=""])'),
      ).toHaveCount(1);
      await panel
        .getByLabel("Operational site", { exact: true })
        .selectOption(target.id);
      const activeResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/navigation/customers/${f.customer}/sites?`) &&
          new URL(r.url()).searchParams.get("status") === "active" &&
          new URL(r.url()).searchParams.get("selectedId") === target.id,
      );
      await panel
        .getByLabel("Site status filter", { exact: true })
        .selectOption("active");
      const active = await (await activeResponse).json();
      expect(active.items.every((x: any) => x.active)).toBe(true);
      expect(active.selected.id).toBe(target.id);
      expect(active.selected.eligible).toBe(false);
      await expect(
        panel
          .getByLabel("Operational site", { exact: true })
          .locator(`option[value="${target.id}"]`),
      ).toHaveJSProperty("disabled", true);
      await expect(
        panel.locator(`[data-site-id="${target.id}"]`),
      ).toContainText(target.code);
      await panel
        .getByLabel("Site status filter", { exact: true })
        .selectOption("all");
    });
    await test.step("Page search and retry actual history with actor labels while preserving an edit draft", async () => {
      const target = sites.find((x) => x.kind === "other");
      let version = 2;
      for (let i = 0; i < 28; i++) {
        const r = await api.post(api.base + "/" + target.id, {
          name: "History facility " + i,
          active: false,
          version,
          reason: "History event " + i,
        });
        version = r.version;
      }
      await panel
        .getByRole("button", { name: "Refresh operational site", exact: true })
        .click();
      await expect(
        panel.locator(`[data-site-id="${target.id}"]`),
      ).toContainText("Version 30");
      const history = panel.getByRole("region", {
        name: "Operational site history",
        exact: true,
      });
      await expect(history.locator("[data-site-event]")).toHaveCount(25);
      await panel
        .getByRole("button", { name: "Edit operational site", exact: true })
        .click();
      await form
        .getByLabel("Site name", { exact: true })
        .fill("Pending reviewed name");
      await form
        .getByLabel("Site change reason", { exact: true })
        .fill("Preserve edit during history retry");
      let fail = true;
      const pattern = `**/api/customers/${f.customer}/sites/${target.id}/history?**`;
      await page.route(pattern, (route) =>
        fail && new URL(route.request().url()).searchParams.has("cursor")
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: "private history page failure",
                requestId: "11111111-4000-4000-8000-000000000002",
              }),
            })
          : route.continue(),
      );
      await history
        .getByRole("button", { name: "More site history", exact: true })
        .click();
      await expect(
        history.getByRole("button", {
          name: "Retry site history",
          exact: true,
        }),
      ).toBeVisible();
      await expect(history.locator("[data-site-event]")).toHaveCount(25);
      await expect(
        form.getByLabel("Site change reason", { exact: true }),
      ).toHaveValue("Preserve edit during history retry");
      await expect(history).not.toContainText("private history page failure");
      fail = false;
      await history
        .getByRole("button", { name: "Retry site history", exact: true })
        .click();
      await expect(history.locator("[data-site-event]")).toHaveCount(30);
      await page.unroute(pattern);
      const h = await (
        await page.request.get(
          api.base + "/" + target.id + "/history?limit=100",
        )
      ).json();
      const oldest = h.items.at(-1);
      expect(oldest.action).toBe("created");
      await find(history, "site history", oldest.request_id);
      await expect(history.locator("[data-site-event]")).toHaveCount(1);
      const event = history.locator(`[data-site-event="${oldest.id}"]`);
      await expect(event).toContainText(oldest.actor);
      await event
        .getByText("View site change details", { exact: true })
        .click();
      await expect(event).toContainText(f.manager);
      await expect(event).toContainText(oldest.request_id);
      await expect(form.getByLabel("Site name", { exact: true })).toHaveValue(
        "Pending reviewed name",
      );
      await find(history, "site history", "NO-MATCH-" + f.code);
      await expect(history.locator("[data-site-event]")).toHaveCount(0);
      await expect(history).toContainText("No matching recorded changes");
      await find(history, "site history", "");
      await expect(history.locator("[data-site-event]")).toHaveCount(25);
    });
    await test.step("Reload an unlinked facility without inventing an estate handoff", async () => {
      const target = sites.find((x) => x.kind === "other");
      await page.reload();
      const fresh = await open(page, f);
      await find(fresh, "Operational site", target.code);
      await fresh
        .getByLabel("Operational site", { exact: true })
        .selectOption(target.id);
      await expect(
        fresh.locator(`[data-site-id="${target.id}"]`),
      ).toContainText("Version 30");
      await expect(
        fresh.getByRole("button", { name: "Open linked estate", exact: true }),
      ).toHaveCount(0);
      await expect(page.getByLabel("Estate", { exact: true })).not.toHaveValue(
        f.estate,
      );
    });
  } finally {
    await f.cleanup();
  }
});

test("E2E-JRN-02-016 @regression site permission revocation clears restricted views and restores only checked actions", async ({
  page,
  browser,
  work,
  setupAdmin,
  muster,
}) => {
  const f = await fixture(work.db);
  let viewer: any = null;
  const raw = token(),
    csrf = token();
  try {
    await muster.signIn(setupAdmin);
    const api = await writer(page, f);
    const linked = await api.post(api.base, {
      kind: "workshop",
      code: "LINK-" + f.code.slice(-10),
      name: "Restricted linked workshop",
      companyId: f.company,
      estateId: f.estate,
      reason: "Create linked permission fixture",
    });
    const unlinked = await api.post(api.base, {
      kind: "nursery",
      code: "FREE-" + f.code.slice(-10),
      name: "Restricted unlinked nursery",
      companyId: f.company,
      estateId: null,
      reason: "Create unlinked permission fixture",
    });
    const panel = await open(page, f);
    await test.step("Read assigned linked sites as a viewer without exposing unlinked configuration or write actions", async () => {
      await work.db.query(
        "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [hash(raw), f.supervisor, csrf],
      );
      viewer = await browser.newContext({ viewport: page.viewportSize()! });
      await viewer.addCookies([
        {
          name: "eoms_session",
          value: raw,
          domain: "localhost",
          path: "/api",
          httpOnly: true,
          secure: false,
          sameSite: "Strict",
        },
      ]);
      const vp = await viewer.newPage();
      await vp.goto("/");
      const read = await open(vp, f);
      await expect(
        read.getByRole("button", {
          name: "Create operational site",
          exact: true,
        }),
      ).toHaveCount(0);
      await find(read, "Operational site", linked.code);
      await read
        .getByLabel("Operational site", { exact: true })
        .selectOption(linked.id);
      await expect(read.locator(`[data-site-id="${linked.id}"]`)).toBeVisible();
      await expect(
        read.getByRole("button", {
          name: "Edit operational site",
          exact: true,
        }),
      ).toHaveCount(0);
      const denied = await vp.request.post(api.base + "/" + linked.id, {
        headers: { Origin: "http://localhost:5284", "X-CSRF-Token": csrf },
        data: {
          name: "Viewer must not edit",
          active: true,
          version: 1,
          reason: "Forbidden direct write",
        },
      });
      expect(denied.status()).toBe(403);
      expect(
        (await vp.request.get(api.base + "/" + unlinked.id)).status(),
      ).toBe(404);
      await read
        .getByRole("button", { name: "Clear site selection", exact: true })
        .click();
      await find(read, "Operational site", unlinked.code);
      await expect(
        read
          .getByLabel("Operational site", { exact: true })
          .locator('option:not([value=""])'),
      ).toHaveCount(0);
      await expect(read).not.toContainText(unlinked.name);
    });
    await test.step("Revoke setup authority and clear a denied history view and private draft", async () => {
      await find(panel, "Operational site", unlinked.code);
      await panel
        .getByLabel("Operational site", { exact: true })
        .selectOption(unlinked.id);
      await expect(
        panel.locator(`[data-site-id="${unlinked.id}"]`),
      ).toBeVisible();
      let permissionFailure = true;
      const permissionPattern = `**/api/customers/${f.customer}/sites/context`;
      await page.route(permissionPattern, (route) =>
        permissionFailure
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: "private permission service failure",
                requestId: "11111111-4000-4000-8000-000000000003",
              }),
            })
          : route.continue(),
      );
      await panel
        .getByRole("button", { name: "Refresh site access", exact: true })
        .click();
      await expect(
        panel.getByRole("button", {
          name: "Retry site permissions",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        panel.locator(`[data-site-id="${unlinked.id}"]`),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", {
          name: "Edit operational site",
          exact: true,
        }),
      ).toHaveCount(0);
      await work.db.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, f.manager],
      );
      permissionFailure = false;
      await panel
        .getByRole("button", { name: "Retry site permissions", exact: true })
        .click();
      await expect(panel.locator("[data-site-id]")).toHaveCount(0);
      await expect(panel).not.toContainText(unlinked.name);
      await page.unroute(permissionPattern);
      await work.db.query(
        "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
        [f.customer, f.manager],
      );
      await panel
        .getByRole("button", { name: "Refresh site access", exact: true })
        .click();
      await expect(
        panel.getByRole("button", {
          name: "Edit operational site",
          exact: true,
        }),
      ).toBeEnabled();
      await panel
        .getByRole("button", { name: "Edit operational site", exact: true })
        .click();
      const form = panel.getByRole("form", {
        name: "Operational site form",
        exact: true,
      });
      await form
        .getByLabel("Site name", { exact: true })
        .fill("Private pending nursery name");
      await form
        .getByLabel("Site change reason", { exact: true })
        .fill("Private pending setup reason");
      const history = panel.getByRole("region", {
        name: "Operational site history",
        exact: true,
      });
      await expect(history.locator("[data-site-event]")).toHaveCount(1);
      await work.db.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, f.manager],
      );
      await find(history, "site history", "Create");
      await expect(panel.locator("[data-site-id]")).toHaveCount(0);
      await expect(
        panel.getByRole("region", {
          name: "Operational site history",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(form).toHaveCount(0);
      await expect(
        panel.getByRole("button", {
          name: "Create operational site",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(panel).not.toContainText(unlinked.name);
      await expect(panel).not.toContainText("Private pending setup reason");
      await expect(
        panel.getByRole("alert").filter({ hasText: "not available" }),
      ).not.toHaveCount(0);
      expect(
        (
          await page.request.get(api.base + "/" + unlinked.id + "/history")
        ).status(),
      ).toBe(404);
      expect(
        (
          await work.db.query(
            "SELECT count(*)::int AS n FROM eoms.site_history WHERE site_id=$1",
            [unlinked.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    await test.step("Recover an explicitly chosen linked read then restore setup only after an access check", async () => {
      await panel
        .getByRole("button", { name: "Clear site selection", exact: true })
        .click();
      await find(panel, "Operational site", linked.code);
      await panel
        .getByLabel("Operational site", { exact: true })
        .selectOption(linked.id);
      await expect(
        panel.locator(`[data-site-id="${linked.id}"]`),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", {
          name: "Edit operational site",
          exact: true,
        }),
      ).toHaveCount(0);
      await work.db.query(
        "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
        [f.customer, f.manager],
      );
      await panel
        .getByRole("button", { name: "Refresh site access", exact: true })
        .click();
      await expect(
        panel.getByRole("button", {
          name: "Edit operational site",
          exact: true,
        }),
      ).toBeEnabled();
      await panel
        .getByRole("button", { name: "Edit operational site", exact: true })
        .click();
      const form = panel.getByRole("form", {
        name: "Operational site form",
        exact: true,
      });
      await form
        .getByLabel("Site name", { exact: true })
        .fill("Recovered workshop");
      await form
        .getByLabel("Site change reason", { exact: true })
        .fill("Save only after explicit restored access");
      await form
        .getByRole("button", { name: "Save operational site", exact: true })
        .click();
      await expect(
        panel.locator(`[data-site-id="${linked.id}"]`),
      ).toContainText("Version 2");
    });
    await test.step("Revoke estate membership and remove cached detail history and handoff without retargeting", async () => {
      const history = panel.getByRole("region", {
        name: "Operational site history",
        exact: true,
      });
      await expect(history.locator("[data-site-event]")).toHaveCount(2);
      let release!: () => void, fetched!: () => void;
      const held = new Promise<void>((resolve) => {
          release = resolve;
        }),
        ready = new Promise<void>((resolve) => {
          fetched = resolve;
        });
      const pattern = `**/api/customers/${f.customer}/sites/${linked.id}/history?**`;
      await page.route(pattern, async (route) => {
        if (new URL(route.request().url()).searchParams.get("q") === "Create") {
          const snapshot = await route.fetch();
          expect(snapshot.status()).toBe(200);
          fetched();
          await held;
          await route.fulfill({ response: snapshot });
        } else await route.continue();
      });
      await find(history, "site history", "Create");
      await ready;
      await work.db.query(
        "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
        [f.manager, f.estate],
      );
      await panel
        .getByRole("button", { name: "Refresh operational site", exact: true })
        .click();
      await expect(panel.locator("[data-site-id]")).toHaveCount(0);
      await expect(
        panel.getByRole("region", {
          name: "Operational site history",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("button", { name: "Open linked estate", exact: true }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("form", { name: "Operational site form", exact: true }),
      ).toHaveCount(0);
      await expect(panel).not.toContainText("Recovered workshop");
      const oldResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/sites/${linked.id}/history?`) &&
          new URL(r.url()).searchParams.get("q") === "Create",
      );
      release();
      await (await oldResponse).finished();
      await page.unroute(pattern);
      await expect(
        panel.getByRole("region", {
          name: "Operational site history",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(panel.locator("[data-site-id]")).toHaveCount(0);
      expect(
        (
          await page.request.get(api.base + "/" + linked.id + "/history")
        ).status(),
      ).toBe(404);
      expect(
        (
          await work.db.query(
            "SELECT count(*)::int AS n FROM eoms.site_history WHERE site_id=$1",
            [linked.id],
          )
        ).rows[0].n,
      ).toBe(2);
    });
  } finally {
    await viewer?.close();
    await work.db.query("DELETE FROM eoms.sessions WHERE token_hash=$1", [
      hash(raw),
    ]);
    await f.cleanup();
  }
});
