import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { independentSourceReviewer } from "../source-review-fixture";
import { randomUUID } from "node:crypto";
test("E2E-JRN-02-018 @regression explicitly grant node or descendant hierarchy visibility without operational access", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  let primary: unknown = null,
    stage = "setup";
  try {
    const peer = await independentSourceReviewer(f),
      division = randomUUID(),
      block = randomUUID();
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    await f.root.query("DELETE FROM eoms.memberships WHERE user_id=$1", [
      peer.id,
    ]);
    await f.root.query(
      "INSERT INTO eoms.operating_units(id,customer_id,estate_id,kind,code,name) VALUES($1,$2,$3,'division','VIEW-DIV','Synthetic assigned division')",
      [division, f.customer, f.estate],
    );
    await f.root.query(
      "INSERT INTO eoms.operating_units(id,customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,$3,'block','VIEW-BLOCK','Synthetic descendant block',$4)",
      [block, f.customer, f.estate, division],
    );
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url()),
        r = await route.fetch({
          url: f.apiURL + u.pathname + u.search,
          headers: await route.request().allHeaders(),
        });
      await route.fulfill({ response: r });
    });
    const panel = page.getByRole("region", {
        name: "Explicit hierarchy read scopes",
        exact: true,
      }),
      save = panel.getByRole("button", {
        name: "Save hierarchy-read assignment",
        exact: true,
      });
    async function identity(raw: string) {
      await context.addCookies([
        {
          name: "eoms_session",
          value: raw,
          domain: "localhost",
          path: "/api",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await page.goto("/");
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      await expect(
        panel.getByLabel("Granted hierarchy customer", { exact: true }),
      ).toBeVisible();
    }
    async function target(revision: number) {
      await panel
        .getByLabel("Hierarchy reader ID", { exact: true })
        .fill(peer.id);
      await panel
        .getByLabel("Hierarchy scope node kind", { exact: true })
        .selectOption("unit");
      await expect(
        panel
          .getByLabel("Hierarchy assignment node", { exact: true })
          .locator('option[value="' + division + '"]'),
      ).toBeAttached();
      const loaded = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith("/hierarchy-scopes") &&
          new URL(r.url()).searchParams.get("nodeId") === division &&
          new URL(r.url()).searchParams.get("subjectId") === peer.id,
      );
      await panel
        .getByLabel("Hierarchy assignment node", { exact: true })
        .selectOption(division);
      expect((await loaded).status()).toBe(200);
      await expect(panel.locator("[data-hierarchy-grant-head]")).toContainText(
        "Revision " + revision,
      );
    }
    async function fields() {
      await panel
        .getByLabel("Hierarchy scope authority reference", { exact: true })
        .fill("Synthetic explicit hierarchy-read authority");
      await panel
        .getByLabel("Hierarchy scope reason", { exact: true })
        .fill("Read only the assigned node and explicitly chosen descendants");
    }
    await test.step("Record node-only hierarchy read with exact uncertain-response recovery and actual audit", async () => {
      stage = "node-grant";
      await identity(f.raw);
      await target(0);
      await expect(save).toBeDisabled();
      await fields();
      let lost = true;
      await page.route("**/hierarchy-scopes", async (route) => {
        if (lost && route.request().method() === "POST") {
          lost = false;
          const u = new URL(route.request().url()),
            r = await route.fetch({
              url: f.apiURL + u.pathname,
              headers: await route.request().allHeaders(),
            });
          if (r.status() !== 200) {
            await route.fulfill({ response: r });
            expect(r.status()).toBe(200);
            return;
          }
          await route.fulfill({
            status: 503,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: "Temporary scope receipt interruption",
            }),
          });
        } else await route.fallback();
      });
      const first = page.waitForResponse(
        (r) =>
          r.url().endsWith("/hierarchy-scopes") &&
          r.request().method() === "POST",
      );
      await save.click();
      expect((await first).status()).toBe(503);
      await expect(panel.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        panel.getByLabel("Hierarchy scope inheritance", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Task capacity", exact: true }),
      ).toBeDisabled();
      const retry = page.waitForResponse(
        (r) =>
          r.url().endsWith("/hierarchy-scopes") &&
          r.request().method() === "POST",
      );
      await save.click();
      expect((await retry).status()).toBe(200);
      await expect(panel).toContainText(
        "Recovered existing receipt. Hierarchy-read assignment revision 1",
      );
      expect(
        (await f.root.query("SELECT * FROM eoms.hierarchy_read_grants"))
          .rowCount,
      ).toBe(1);
      await panel
        .getByText("View detailed hierarchy scope audit", { exact: true })
        .click();
      const grant = (
        await f.root.query("SELECT * FROM eoms.hierarchy_read_grants")
      ).rows[0];
      await expect(panel).toContainText(grant.request_id);
    });
    await test.step("Read only the named node with no parent sibling or operational estate access", async () => {
      stage = "node-read";
      await identity(peer.raw);
      await panel
        .getByLabel("Granted hierarchy customer", { exact: true })
        .selectOption(f.customer);
      await expect(panel.locator("[data-scope-node]")).toHaveCount(1);
      await expect(panel.locator("[data-scope-node]")).toHaveAttribute(
        "data-scope-node",
        "unit/" + division,
      );
      await expect(panel).toContainText("Work access granted: No");
      await expect(
        panel.getByRole("region", {
          name: "Assign hierarchy visibility",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.memberships WHERE user_id=$1",
            [peer.id],
          )
        ).rowCount,
      ).toBe(0);
      const denied = await fetch(
        f.apiURL + "/api/estates/" + f.estate + "/musters",
        { headers: { Cookie: "eoms_session=" + peer.raw } },
      );
      expect(denied.status).toBe(403);
    });
    await test.step("Explicitly renew descendant inheritance and recover a failed scoped read without widening work permissions", async () => {
      stage = "descendant-grant";
      await identity(f.raw);
      await target(1);
      await panel
        .getByLabel("Hierarchy scope inheritance", { exact: true })
        .selectOption("descendants");
      await fields();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/hierarchy-scopes") &&
          r.request().method() === "POST",
      );
      await save.click();
      expect((await response).status()).toBe(200);
      await expect(panel.locator("[data-hierarchy-grant-head]")).toContainText(
        "Revision 2",
      );
      await identity(peer.raw);
      await panel
        .getByLabel("Granted hierarchy customer", { exact: true })
        .selectOption(f.customer);
      await expect(panel.locator("[data-scope-node]")).toHaveCount(2);
      await expect(
        panel.locator('[data-scope-node="unit/' + block + '"]'),
      ).toBeVisible();
      let fail = true;
      await page.route("**/hierarchy-scopes/read?*", async (route) => {
        if (fail) {
          fail = false;
          await route.fulfill({
            status: 503,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: "Temporary hierarchy read interruption",
            }),
          });
        } else await route.fallback();
      });
      await panel
        .getByRole("button", { name: "Refresh hierarchy scope", exact: true })
        .click();
      await expect(panel.getByRole("alert")).toBeVisible();
      await expect(panel.locator("[data-scope-node]")).toHaveCount(0);
      await panel
        .getByRole("button", { name: "Refresh hierarchy scope", exact: true })
        .click();
      await expect(panel.locator("[data-scope-node]")).toHaveCount(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    });
    await test.step("Revoke exact inherited metadata rights retain history and clear the reader context", async () => {
      stage = "revocation";
      await identity(f.raw);
      await target(2);
      await panel
        .getByLabel("Hierarchy scope inheritance", { exact: true })
        .selectOption("descendants");
      await panel
        .getByLabel("Hierarchy scope action", { exact: true })
        .selectOption("revoked");
      await fields();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/hierarchy-scopes") &&
          r.request().method() === "POST",
      );
      await save.click();
      expect((await response).status()).toBe(200);
      await expect(panel.locator("[data-hierarchy-grant-head]")).toContainText(
        "Revision 3",
      );
      await expect(panel.locator("[data-hierarchy-grant]")).toHaveCount(3);
      await identity(peer.raw);
      await expect(panel).toContainText(
        "No current explicit hierarchy-read context is available",
      );
      await expect(panel.locator("[data-scope-node]")).toHaveCount(0);
      const r = await fetch(
        f.apiURL + "/api/customers/" + f.customer + "/hierarchy-scopes/read",
        { headers: { Cookie: "eoms_session=" + peer.raw } },
      );
      expect(r.status).toBe(403);
    });
  } catch (e) {
    primary = e;
    console.log("Hierarchy scope journey failure stage: " + stage);
    throw e;
  } finally {
    try {
      if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" });
    } catch (e) {
      if (!primary && !page.isClosed()) throw e;
    } finally {
      await f.close();
    }
  }
});
