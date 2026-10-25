import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { independentSourceReviewer } from "../source-review-fixture";
import { randomUUID } from "node:crypto";
test("E2E-JRN-02-017 @regression provision tenant company and estate with explicit administrator handoff and immutable recovery", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  let failure: unknown = null;
  let stage = "setup";
  try {
    const peer = await independentSourceReviewer(f),
      code = "BOOT-" + randomUUID().slice(0, 8).toUpperCase();
    await f.root.query(
      "INSERT INTO eoms.platform_bootstrap_authority(subject_id,action,user_scope_revision,reference,reason) VALUES($1,'granted',0,'Synthetic explicit owner authority','Prepare controlled bootstrap operator without implicit tenant access')",
      [f.user],
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
        name: "Hierarchy provisioning",
        exact: true,
      }),
      save = panel.getByRole("button", {
        name: "Save hierarchy provision",
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
        panel.getByLabel("Provisioning operation", { exact: true }),
      ).toBeVisible();
    }
    async function fill(fields: Record<string, string>) {
      for (const [k, v] of Object.entries(fields))
        await panel.getByLabel(k, { exact: true }).fill(v);
    }
    let created: any, company: any;
    await test.step("Bootstrap an explicit named administrator without granting operator tenant work access", async () => {
      stage = "bootstrap";
      await identity(f.raw);
      await expect(panel).toContainText(
        "Explicit platform bootstrap authority is active.",
      );
      await panel
        .getByLabel("Provisioning operation", { exact: true })
        .selectOption("customer");
      await expect(save).toBeDisabled();
      await fill({
        "New customer code": code,
        "New customer name": "Synthetic bootstrapped tenant",
        "New company code": "LEGAL-ONE",
        "New company name": "Synthetic initial legal company",
        "New estate code": "ESTATE-ONE",
        "New estate name": "Synthetic first estate",
        "Named initial administrator ID": peer.id,
        "Provisioning authority reference":
          "Synthetic controlled owner bootstrap reference",
        "Provisioning reason":
          "Bootstrap a separate tenant with explicit administrator and no implicit access",
      });
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/provisioning/customer") &&
          r.request().method() === "POST",
      );
      await save.click();
      const r = await response;
      expect(r.status()).toBe(200);
      created = (await r.json()).receipt;
      await expect(panel.locator("[data-provision-receipt]")).toHaveAttribute(
        "data-provision-receipt",
        created.id,
      );
      await expect(
        panel.getByRole("button", {
          name: "Open newly assigned estate",
          exact: true,
        }),
      ).toHaveCount(0);
      await panel
        .getByText("View detailed provisioning receipt", { exact: true })
        .click();
      await expect(panel).toContainText(created.request_id);
      expect(created.result.bootstrapperGrantedAccess).toBe(false);
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
            [created.result.estateId, f.user],
          )
        ).rowCount,
      ).toBe(0);
    });
    await test.step("Hand off to the named tenant administrator and recover one coded company from a lost response", async () => {
      stage = "administrator-handoff";
      await identity(peer.raw);
      const org = page.getByRole("region", {
        name: "Organization guide",
        exact: true,
      });
      await org.getByLabel("Search Customer", { exact: true }).fill(code);
      await org
        .getByRole("button", { name: "Find Customer", exact: true })
        .click();
      await expect(
        org
          .getByLabel("Customer", { exact: true })
          .locator('option[value="' + created.result.customerId + '"]'),
      ).toBeAttached();
      await org
        .getByLabel("Customer", { exact: true })
        .selectOption(created.result.customerId);
      await expect(
        panel.getByLabel("Provisioning operation", { exact: true }),
      ).toBeEnabled();
      await panel
        .getByLabel("Provisioning operation", { exact: true })
        .selectOption("company");
      await fill({
        "New company code": "LEGAL-TWO",
        "New company name": "Synthetic additional legal company",
        "Provisioning authority reference":
          "Synthetic customer setup authority",
        "Provisioning reason":
          "Create a tenant-local coded company without sibling access",
      });
      let lost = true;
      await page.route("**/provisioning/company", async (route) => {
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
              error: "Temporary provisioning response interruption",
            }),
          });
        } else await route.fallback();
      });
      const interrupted = page.waitForResponse(
        (r) =>
          r.url().endsWith("/provisioning/company") &&
          r.request().method() === "POST",
      );
      await save.click();
      expect((await interrupted).status()).toBe(503);
      await expect(panel.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        panel.getByLabel("New company code", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Task capacity", exact: true }),
      ).toBeDisabled();
      const recovered = page.waitForResponse(
        (r) =>
          r.url().endsWith("/provisioning/company") &&
          r.request().method() === "POST",
      );
      await save.click();
      const r = await recovered;
      expect(r.status()).toBe(200);
      const result = await r.json();
      expect(result.replayed).toBe(true);
      company = result.receipt;
      await expect(panel).toContainText(
        "Recovered existing receipt. Provisioning receipt " + company.id,
      );
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.companies WHERE customer_id=$1 AND code=$2",
            [created.result.customerId, "LEGAL-TWO"],
          )
        ).rowCount,
      ).toBe(1);
    });
    await test.step("Provision an explicitly assigned estate preserve detailed audit and navigate into its empty work register", async () => {
      stage = "estate";
      await panel
        .getByLabel("Provisioning operation", { exact: true })
        .selectOption("estate");
      await expect(
        panel
          .getByLabel("Provision estate company", { exact: true })
          .locator('option[value="' + company.result.companyId + '"]'),
      ).toBeAttached();
      await panel
        .getByLabel("Provision estate company", { exact: true })
        .selectOption(company.result.companyId);
      await fill({
        "New estate code": "ESTATE-TWO",
        "New estate name": "Synthetic explicitly assigned second estate",
        "Named initial estate manager ID": peer.id,
        "Provisioning authority reference": "Synthetic named estate assignment",
        "Provisioning reason":
          "Create only the explicit assigned estate without inheriting other work",
      });
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/provisioning/estate") &&
          r.request().method() === "POST",
      );
      await save.click();
      const r = await response;
      expect(r.status()).toBe(200);
      const result = await r.json();
      await expect(
        panel.getByRole("button", {
          name: "Open newly assigned estate",
          exact: true,
        }),
      ).toBeVisible();
      await panel
        .getByText("View detailed provisioning receipt", { exact: true })
        .click();
      await expect(panel).toContainText(result.receipt.request_id);
      await expect(panel.locator("[data-provision-history]")).toHaveCount(3);
      await panel
        .getByRole("button", {
          name: "Open newly assigned estate",
          exact: true,
        })
        .click();
      await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
        result.receipt.result.estateId,
      );
      expect(
        (
          await f.root.query("SELECT * FROM eoms.musters WHERE estate_id=$1", [
            result.receipt.result.estateId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    });
    await test.step("Remove provisioning controls and private receipt details after actual setup authority revocation", async () => {
      stage = "revocation";
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      await expect(panel).toBeVisible();
      const org = page.getByRole("region", {
        name: "Organization guide",
        exact: true,
      });
      await org.getByLabel("Search Customer", { exact: true }).fill(code);
      await org
        .getByRole("button", { name: "Find Customer", exact: true })
        .click();
      await expect(
        org
          .getByLabel("Customer", { exact: true })
          .locator('option[value="' + created.result.customerId + '"]'),
      ).toBeAttached();
      const selected = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith("/provisioning/capabilities") &&
          new URL(r.url()).searchParams.get("customerId") ===
            created.result.customerId,
      );
      await org
        .getByLabel("Customer", { exact: true })
        .selectOption(created.result.customerId);
      expect((await selected).status()).toBe(200);
      await expect(panel.locator("[data-provision-customer]")).toContainText(
        "Setup authority current",
      );
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [created.result.customerId, peer.id],
      );
      await panel
        .getByRole("button", { name: "Refresh provisioning", exact: true })
        .click();
      await expect(
        panel.getByRole("form", { name: "Provision hierarchy", exact: true }),
      ).toHaveCount(0);
      await expect(panel.locator("[data-provision-receipt]")).toHaveCount(0);
      await expect(panel.locator("[data-provision-history]")).toHaveCount(0);
    });
  } catch (e) {
    failure = e;
    console.log("Provisioning journey failure stage: " + stage);
    throw e;
  } finally {
    try {
      if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" });
    } catch (e) {
      if (!failure && !page.isClosed()) throw e;
    } finally {
      await f.close();
    }
  }
});
