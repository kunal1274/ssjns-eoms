import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { independentSourceReviewer } from "../source-review-fixture";
test("E2E-JRN-02-019 @regression hand over customer setup without work grants and independently revoke access", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  let primary: unknown = null;
  try {
    const peer = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    await f.root.query("DELETE FROM eoms.memberships WHERE user_id=$1", [
      peer.id,
    ]);
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url()),
        r = await route.fetch({
          url: f.apiURL + u.pathname + u.search,
          headers: await route.request().allHeaders(),
        });
      await route.fulfill({ response: r });
    });
    await context.addCookies([
      {
        name: "eoms_session",
        value: f.raw,
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
    const panel = page.getByRole("region", {
        name: "Customer setup access handover",
        exact: true,
      }),
      save = panel.getByRole("button", {
        name: "Record setup access change",
        exact: true,
      });
    async function fields() {
      await panel
        .getByLabel("Setup authority reference", { exact: true })
        .fill("Synthetic separate administrator authority");
      await panel
        .getByLabel("Setup handover reason", { exact: true })
        .fill(
          "Change setup metadata authority without creating work memberships",
        );
    }
    await test.step("Grant a separate setup recipient with frozen receipt recovery and detailed actual audit", async () => {
      await panel
        .getByLabel("Setup recipient ID", { exact: true })
        .fill(peer.id);
      await expect(panel.locator("[data-setup-recipient]")).toContainText(
        "Setup not granted",
      );
      await expect(save).toBeDisabled();
      await fields();
      let lost = true;
      await page.route("**/provisioning/setup-grant", async (route) => {
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
              error: "Temporary setup handover response interruption",
            }),
          });
        } else await route.fallback();
      });
      const first = page.waitForResponse(
        (r) =>
          r.url().endsWith("/provisioning/setup-grant") &&
          r.request().method() === "POST",
      );
      await save.click();
      expect((await first).status()).toBe(503);
      await expect(panel.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        panel.getByLabel("Setup assignment action", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Task capacity", exact: true }),
      ).toBeDisabled();
      const retried = page.waitForResponse(
        (r) =>
          r.url().endsWith("/provisioning/setup-grant") &&
          r.request().method() === "POST",
      );
      await save.click();
      expect((await retried).status()).toBe(200);
      await expect(panel).toContainText(
        "Recovered existing receipt. Customer setup granted",
      );
      await expect(panel.locator("[data-setup-recipient]")).toContainText(
        "Setup granted",
      );
      await panel
        .getByText("View detailed setup access receipt", { exact: true })
        .click();
      const receipt = (
        await f.root.query(
          "SELECT * FROM eoms.hierarchy_provision_receipts WHERE operation='setup-grant'",
        )
      ).rows[0];
      await expect(panel).toContainText(receipt.request_id);
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.hierarchy_provision_receipts WHERE operation='setup-grant'",
          )
        ).rowCount,
      ).toBe(1);
    });
    await test.step("Verify configuration capability is separate from every estate work membership", async () => {
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
      const cap = await fetch(
        f.apiURL + "/api/provisioning/capabilities?customerId=" + f.customer,
        { headers: { Cookie: "eoms_session=" + peer.raw } },
      );
      expect((await cap.json()).canManageCustomer).toBe(true);
    });
    await test.step("Revoke the separate recipient retain last administrator and prevent self authority changes", async () => {
      await panel
        .getByLabel("Setup assignment action", { exact: true })
        .selectOption("revoked");
      await fields();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/provisioning/setup-grant") &&
          r.request().method() === "POST",
      );
      await save.click();
      expect((await response).status()).toBe(200);
      await expect(panel.locator("[data-setup-recipient]")).toContainText(
        "Setup not granted",
      );
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
            [f.customer, f.user],
          )
        ).rowCount,
      ).toBe(1);
      await panel
        .getByLabel("Setup recipient ID", { exact: true })
        .fill(f.user);
      await expect(panel).toContainText(
        "Self changes require another administrator",
      );
      await expect(save).toBeDisabled();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    });
  } catch (e) {
    primary = e;
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
