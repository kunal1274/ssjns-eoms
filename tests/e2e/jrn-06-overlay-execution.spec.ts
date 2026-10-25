import { test, expect } from "./fixtures";
import { mappingWorkflowFixture } from "../mapping-workflow-fixture";
test("E2E-JRN-06-012 @regression authorize apply reconcile and independently compensate immutable attribution overlays", async ({
  page,
  context,
}) => {
  const x = await mappingWorkflowFixture(),
    f = x.f;
  let failure: unknown = null;
  let stage = "setup";
  try {
    const baseline = await f.snapshot(),
      request = (await x.post(x.sourcePath, x.requestInput())).mappingRequest,
      path = "mapping-requests/" + request.id;
    await x.post(path + "/decisions", x.decisionInput(), x.decider.raw);
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url()),
        r = await route.fetch({
          url: f.apiURL + u.pathname + u.search,
          headers: await route.request().allHeaders(),
        });
      await route.fulfill({ response: r });
    });
    const panel = page.getByRole("region", {
        name: "Overlay execution and reconciliation",
        exact: true,
      }),
      grant = panel.getByRole("button", {
        name: "Record execution authorization",
        exact: true,
      }),
      apply = panel.getByRole("button", {
        name: "Apply attribution overlay",
        exact: true,
      });
    async function open(raw: string) {
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
      await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
        f.estate,
      );
      for (const name of [
        "Task capacity",
        "Open legacy attribution review",
        "Open source mapping preview",
        "Open saved review " + x.job.id,
        "Open mapping requests " + x.check.id,
        "Inspect mapping request " + request.id,
        "Open overlay execution and reconciliation",
      ])
        await page.getByRole("button", { name, exact: true }).click();
      await expect(
        panel.getByLabel("Overlay operation", { exact: true }),
      ).toHaveValue("apply");
      await expect(panel).toContainText("Application state:");
    }
    async function select(subject: string) {
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith("/execution-authority") &&
          new URL(r.url()).searchParams.get("subjectId") === subject,
      );
      await panel
        .getByRole("button", {
          name: new RegExp("^Select execution person .* " + subject + "$"),
        })
        .click();
      expect((await response).status()).toBe(200);
      await expect(
        panel.locator("[data-execution-authority-state]"),
      ).toContainText(subject);
    }
    async function grantFields() {
      await panel
        .getByLabel("Execution authority reference", { exact: true })
        .fill("Synthetic owner exact request mandate");
      await panel
        .getByLabel("Execution authority reason", { exact: true })
        .fill("Explicit named executor separate from recorded decision");
    }
    async function executionFields() {
      await panel
        .getByLabel("Overlay execution reference", { exact: true })
        .fill("Synthetic controlled execution reference");
      await panel
        .getByLabel("Overlay execution reason", { exact: true })
        .fill("Reconcile original and adjusted totals without rewriting work");
      await expect(
        panel.getByRole("button", {
          name: /^(Apply|Compensate) attribution overlay$/,
        }),
      ).toBeDisabled();
      await panel
        .getByLabel(
          "I checked the exact approval authority rows and compensation consequences",
          { exact: true },
        )
        .check();
    }
    async function drop(pattern: string) {
      let lost = true;
      await page.route(pattern, async (route) => {
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
              error: "Temporary execution response interruption",
            }),
          });
        } else await route.fallback();
      });
    }
    await test.step("Authorize a separate exact request executor with frozen lost-response recovery and actual audit", async () => {
      stage = "authorization";
      await open(x.decider.raw);
      await expect(apply).toBeDisabled();
      await select(f.user);
      await expect(grant).toBeDisabled();
      await grantFields();
      await drop("**/execution-authority");
      const interrupted = page.waitForResponse(
        (r) =>
          r.url().endsWith("/execution-authority") &&
          r.request().method() === "POST",
      );
      await grant.click();
      expect((await interrupted).status()).toBe(503);
      await expect(panel.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        panel.getByLabel("Execution authority reason", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", {
          name: "Close overlay execution and reconciliation",
          exact: true,
        }),
      ).toBeDisabled();
      const recovered = page.waitForResponse(
        (r) =>
          r.url().endsWith("/execution-authority") &&
          r.request().method() === "POST",
      );
      await grant.click();
      expect((await recovered).status()).toBe(200);
      await expect(panel).toContainText(
        "Recovered existing receipt. Execution authorization revision 1",
      );
      expect(
        (await f.root.query("SELECT * FROM eoms.mapping_execution_authority"))
          .rowCount,
      ).toBe(1);
      await panel
        .getByText("View detailed execution authorization", { exact: true })
        .click();
      await expect(panel).toContainText(x.decider.id);
      expect(await f.snapshot()).toEqual(baseline);
    });
    let applied: any;
    await test.step("Reject stale authority then apply exactly once with immutable receipt conserved totals and paged reconciliation", async () => {
      stage = "application";
      await open(f.raw);
      await expect(apply).toBeDisabled();
      await executionFields();
      const renewed = (
        await x.post(
          path + "/execution-authority",
          {
            key: crypto.randomUUID(),
            subjectId: f.user,
            purpose: "apply",
            expectedRevision: 1,
            action: "appointed",
            reference: "Synthetic renewed exact mandate",
            reason: "Actual concurrent execution authority renewal",
          },
          x.decider.raw,
        )
      ).authority;
      const stale = page.waitForResponse(
        (r) =>
          r.url().endsWith("/execution") && r.request().method() === "POST",
      );
      await apply.click();
      expect((await stale).status()).toBe(409);
      await expect(panel.getByRole("alert")).toContainText("Refresh");
      await expect(
        panel.getByLabel("Overlay execution reason", { exact: true }),
      ).toHaveValue(
        "Reconcile original and adjusted totals without rewriting work",
      );
      expect(
        (await f.root.query("SELECT * FROM eoms.mapping_overlay_receipts"))
          .rowCount,
      ).toBe(0);
      await panel
        .getByRole("button", {
          name: "Refresh execution and reconciliation",
          exact: true,
        })
        .click();
      await expect(panel).toContainText("Your execution authority current");
      await drop("**/execution");
      const lost = page.waitForResponse(
        (r) =>
          r.url().endsWith("/execution") && r.request().method() === "POST",
      );
      await apply.click();
      expect((await lost).status()).toBe(503);
      await expect(panel.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        panel.getByLabel("Overlay operation", { exact: true }),
      ).toBeDisabled();
      const recovered = page.waitForResponse(
        (r) =>
          r.url().endsWith("/execution") && r.request().method() === "POST",
      );
      await apply.click();
      expect((await recovered).status()).toBe(200);
      await expect(panel).toContainText(
        "Recovered existing receipt. Overlay applied receipt",
      );
      await expect(panel).toContainText("Application state: Active overlay");
      await expect(panel.locator("[data-overlay-totals]")).toContainText(
        "Original unresolved 28 · Adjusted unresolved 27 · Active overlay rows 1",
      );
      applied = (
        await f.root.query("SELECT * FROM eoms.mapping_overlay_receipts")
      ).rows[0];
      expect(applied.authority_id).toBe(renewed.id);
      expect(Number(applied.quantity_ha)).toBe(0.1);
      await panel
        .getByText("View detailed overlay receipt", { exact: true })
        .click();
      await expect(panel).toContainText(applied.request_id);
      await panel
        .getByText("View request original and adjusted attribution", {
          exact: true,
        })
        .click();
      await expect(panel).toContainText("Unresolved historical company");
      const first = await panel
        .locator("[data-overlay-register]")
        .first()
        .getAttribute("data-overlay-register");
      await panel
        .getByRole("button", {
          name: "Next reconciliation records",
          exact: true,
        })
        .click();
      await expect(
        panel.locator("[data-overlay-register]").first(),
      ).not.toHaveAttribute("data-overlay-register", first!);
      await panel
        .getByRole("button", {
          name: "First reconciliation records",
          exact: true,
        })
        .click();
      await expect(
        panel.locator("[data-overlay-register]").first(),
      ).toHaveAttribute("data-overlay-register", first!);
      expect(await f.snapshot()).toEqual(baseline);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    });
    await test.step("Separately authorize independent compensation after source concerns and retain original application lineage", async () => {
      stage = "compensation-authorization";
      await panel
        .getByLabel("Overlay operation", { exact: true })
        .selectOption("compensate");
      await select(x.decider.id);
      await grantFields();
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/execution-authority") &&
          r.request().method() === "POST",
      );
      await grant.click();
      expect((await saved).status()).toBe(200);
      await expect(panel).toContainText("Execution authorization revision 1");
      await x.observe("concerns", 1);
      stage = "compensation";
      await open(x.decider.raw);
      await panel
        .getByLabel("Overlay operation", { exact: true })
        .selectOption("compensate");
      await expect(panel).toContainText("Approval not current");
      await expect(panel).toContainText("Your execution authority current");
      await executionFields();
      const receipt = page.waitForResponse(
        (r) =>
          r.url().endsWith("/execution") && r.request().method() === "POST",
      );
      await panel
        .getByRole("button", {
          name: "Compensate attribution overlay",
          exact: true,
        })
        .click();
      expect((await receipt).status()).toBe(200);
      await expect(panel).toContainText(
        "Application state: Compensated overlay",
      );
      await expect(panel.locator("[data-overlay-receipt]")).toHaveCount(2);
      await expect(panel.locator("[data-overlay-totals]")).toContainText(
        "Original unresolved 28 · Adjusted unresolved 28 · Active overlay rows 0",
      );
      const receipts = (
        await f.root.query(
          "SELECT * FROM eoms.mapping_overlay_receipts ORDER BY created_at,id",
        )
      ).rows;
      expect(receipts[1].previous_id).toBe(applied.id);
      expect(receipts[1].actor_id).toBe(x.decider.id);
      expect(receipts[1].quantity_ha).toBe(applied.quantity_ha);
      expect(await f.snapshot()).toEqual(baseline);
    });
    await test.step("Clear failed reconciliation reports recover real reads and remove private overlay data after scope denial", async () => {
      stage = "read-recovery";
      let fail = true;
      await page.route("**/overlay-register?*", async (route) => {
        if (fail) {
          fail = false;
          await route.fulfill({
            status: 503,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: "Temporary reconciliation read interruption",
            }),
          });
        } else await route.fallback();
      });
      await panel
        .getByRole("button", {
          name: "Refresh execution and reconciliation",
          exact: true,
        })
        .click();
      await expect(panel.getByRole("alert")).toBeVisible();
      await expect(panel.locator("[data-overlay-receipt]")).toHaveCount(0);
      await panel
        .getByRole("button", {
          name: "Refresh execution and reconciliation",
          exact: true,
        })
        .click();
      await expect(panel.locator("[data-overlay-receipt]")).toHaveCount(2);
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, x.decider.id],
      );
      await panel
        .getByRole("button", {
          name: "Refresh execution and reconciliation",
          exact: true,
        })
        .click();
      await expect(panel).toHaveCount(0);
      await expect(page.locator("[data-overlay-receipt]")).toHaveCount(0);
      expect(await f.snapshot()).toEqual(baseline);
    });
  } catch (e) {
    failure = e;
    console.log("Overlay journey failure stage: " + stage);
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
