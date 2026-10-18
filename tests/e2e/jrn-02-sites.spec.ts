import { test, expect } from "./fixtures";
import { randomUUID } from "node:crypto";
test("E2E-JRN-02-014 @regression typed sites connect setup history and scoped estate handoff", async ({
  page,
  work,
  setupAdmin,
  muster,
}) => {
  const suffix = randomUUID().slice(0, 10),
    customerCode = "SITES-" + suffix;
  const actor = (
    await work.db.query("SELECT id FROM eoms.users WHERE email=$1", [
      setupAdmin.email,
    ])
  ).rows[0].id;
  const customer = (
    await work.db.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,'Journey facility customer') RETURNING id",
      [customerCode],
    )
  ).rows[0].id;
  const company = (
    await work.db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Journey facility company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const estate = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Journey facility estate') RETURNING id",
      [customer, company, "FACILITY-" + suffix],
    )
  ).rows[0].id;
  await work.db.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [customer, actor],
  );
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [actor, estate],
  );
  try {
    await muster.signIn(setupAdmin);
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    const guide = page.getByRole("region", {
      name: "Organization guide",
      exact: true,
    });
    await guide
      .getByLabel("Search Customer", { exact: true })
      .fill(customerCode);
    await guide
      .getByRole("button", { name: "Find Customer", exact: true })
      .click();
    await guide.getByLabel("Customer", { exact: true }).selectOption(customer);
    const panel = page.getByRole("region", {
        name: "Operational sites",
        exact: true,
      }),
      form = panel.getByRole("form", {
        name: "Operational site form",
        exact: true,
      });
    const siteCode = "MILL-" + suffix;
    let siteId = "";
    await test.step("Create an explicit linked facility with field validation and current scope", async () => {
      await panel
        .getByRole("button", { name: "Create operational site", exact: true })
        .click();
      await form
        .getByLabel("Site responsible company", { exact: true })
        .selectOption(company);
      await form
        .getByLabel("Site linked estate", { exact: true })
        .selectOption(estate);
      const save = form.getByRole("button", {
        name: "Save operational site",
        exact: true,
      });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(form.getByLabel("Site code", { exact: true })).toBeFocused();
      await form.getByLabel("Site code", { exact: true }).fill(siteCode);
      await form.getByLabel("Site name", { exact: true }).fill("Journey mill");
      await form
        .getByLabel("Site change reason", { exact: true })
        .fill("Create facility for estate journey");
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/customers/${customer}/sites`) &&
          r.request().method() === "POST",
      );
      await save.click();
      const result = await saved;
      expect(result.status()).toBe(201);
      const row = await result.json();
      siteId = row.id;
      expect(row.estate_id).toBe(estate);
      expect(row.company_id).toBe(company);
      await expect(panel.locator(`[data-site-id="${siteId}"]`)).toContainText(
        "Version 1",
      );
      await expect(
        panel.getByRole("region", { name: "Operational site history" }),
      ).toContainText("Create facility for estate journey");
    });
    await test.step("Search retry retains current site and editable fields", async () => {
      await panel
        .getByRole("button", { name: "Edit operational site", exact: true })
        .click();
      await form
        .getByLabel("Site name", { exact: true })
        .fill("Reviewed journey mill");
      await form
        .getByLabel("Site change reason", { exact: true })
        .fill("Preserve reason through search retry");
      let fail = true;
      await page.route(
        `**/api/navigation/customers/${customer}/sites?**`,
        (route) =>
          fail
            ? route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({
                  error: "private storage error",
                  requestId: "57912261-4000-4000-8000-000000000001",
                }),
              })
            : route.continue(),
      );
      await panel
        .getByLabel("Search Operational site", { exact: true })
        .fill(siteCode);
      await panel
        .getByRole("button", { name: "Find Operational site", exact: true })
        .click();
      await expect(
        panel.getByRole("button", {
          name: "Retry Operational site",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        form.getByLabel("Site change reason", { exact: true }),
      ).toHaveValue("Preserve reason through search retry");
      await expect(panel.locator(`[data-site-id="${siteId}"]`)).toContainText(
        "Journey mill",
      );
      fail = false;
      await panel
        .getByRole("button", { name: "Retry Operational site", exact: true })
        .click();
      await expect(
        panel.getByRole("button", {
          name: "Retry Operational site",
          exact: true,
        }),
      ).toHaveCount(0);
      await page.unroute(`**/api/navigation/customers/${customer}/sites?**`);
    });
    await test.step("Reject stale edits then save reviewed availability with short and detailed history", async () => {
      const session = await (
        await page.request.get("/api/auth/session")
      ).json();
      const update = await page.request.post(
        `/api/customers/${customer}/sites/${siteId}`,
        {
          headers: {
            Origin: "http://localhost:5284",
            "X-CSRF-Token": session.csrf,
          },
          data: {
            name: "Concurrent facility name",
            active: true,
            version: 1,
            reason: "Independent concurrent name change",
          },
        },
      );
      expect(update.status()).toBe(200);
      await form
        .getByRole("button", { name: "Save operational site", exact: true })
        .click();
      await expect(
        panel.getByRole("alert").filter({ hasText: "This site changed" }),
      ).toBeVisible();
      await expect(
        form.getByLabel("Site change reason", { exact: true }),
      ).toHaveValue("Preserve reason through search retry");
      await panel
        .getByRole("button", { name: "Refresh operational site", exact: true })
        .click();
      await expect(panel.locator(`[data-site-id="${siteId}"]`)).toContainText(
        "Version 2",
      );
      await panel
        .getByRole("button", { name: "Edit operational site", exact: true })
        .click();
      await form
        .getByLabel("Site name", { exact: true })
        .fill("Reviewed journey mill");
      await form
        .getByLabel("Site availability", { exact: true })
        .selectOption("false");
      await form
        .getByLabel("Site change reason", { exact: true })
        .fill("Pause facility after independent review");
      let failSavedRead = true;
      const savedReadPattern = `**/api/customers/${customer}/sites/${siteId}`;
      await page.route(savedReadPattern, (route) =>
        failSavedRead && route.request().method() === "GET"
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: "private refresh failure",
                requestId: "57912261-4000-4000-8000-000000000002",
              }),
            })
          : route.continue(),
      );
      await form
        .getByRole("button", { name: "Save operational site", exact: true })
        .click();
      await expect(
        panel.getByRole("status").filter({ hasText: "Site saved." }),
      ).toBeVisible();
      await expect(panel.getByRole("alert")).toContainText(
        "57912261-4000-4000-8000-000000000002",
      );
      await expect(form).toHaveCount(0);
      expect(
        (
          await (
            await page.request.get(`/api/customers/${customer}/sites/${siteId}`)
          ).json()
        ).version,
      ).toBe(3);
      failSavedRead = false;
      await panel
        .getByRole("button", { name: "Refresh operational site", exact: true })
        .click();
      await expect(panel.locator(`[data-site-id="${siteId}"]`)).toContainText(
        "Paused · Version 3",
      );
      await page.unroute(savedReadPattern);
      const history = panel.getByRole("region", {
        name: "Operational site history",
      });
      await expect(history).toContainText(
        "Pause facility after independent review",
      );
      const event = history
        .locator("[data-site-event]")
        .filter({ hasText: "Pause facility after independent review" });
      await event
        .getByText("View site change details", { exact: true })
        .click();
      await expect(event).toContainText("Concurrent facility name");
      await expect(event).toContainText("Reviewed journey mill");
      const h = await (
        await page.request.get(
          `/api/customers/${customer}/sites/${siteId}/history`,
        )
      ).json();
      expect(h.items[0].actor_id).toBe(actor);
      await expect(event).toContainText(h.items[0].request_id);
    });
    await test.step("Reload persisted site and open only its assigned estate", async () => {
      await panel
        .getByRole("button", { name: "Refresh operational site", exact: true })
        .click();
      await expect(panel.locator(`[data-site-id="${siteId}"]`)).toContainText(
        "Version 3",
      );
      await panel
        .getByRole("button", { name: "Open linked estate", exact: true })
        .click();
      await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
        estate,
      );
      const r = await page.request.get(
        `/api/customers/${customer}/sites/${siteId}`,
      );
      expect((await r.json()).name).toBe("Reviewed journey mill");
    });
  } finally {
    await work.db.query(
      "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
      [actor, estate],
    );
    await work.db.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1 AND customer_id=$2",
      [actor, customer],
    );
  }
});
