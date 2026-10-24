import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";

test("E2E-JRN-06-003 @regression inspect genuinely upgraded historical work without inferred attribution", async ({
  page,
  context,
}) => {
  const fixture = await upgradedWorkFixture();
  try {
    const before = await fixture.snapshot();
    // Real isolated API + restricted runtime DB. Relay responses, never stub historical rows.
    await page.route("**/api/**", async (route) => {
      const original = new URL(route.request().url());
      const response = await route.fetch({
        url: fixture.apiURL + original.pathname + original.search,
        headers: await route.request().allHeaders(),
      });
      await route.fulfill({ response });
    });
    await context.addCookies([
      {
        name: "eoms_session",
        value: fixture.raw,
        domain: "localhost",
        path: "/api",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const session = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/session"),
    );
    await page.goto("/");
    expect((await (await session).json()).user.id).toBe(fixture.user);
    await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
      fixture.estate,
    );
    async function openQueue() {
      await page
        .getByRole("button", { name: "Task capacity", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Open legacy attribution review",
          exact: true,
        })
        .click();
      await panel
        .getByLabel("Legacy review queue", { exact: true })
        .selectOption("work");
    }
    const panel = page.getByRole("region", {
        name: "Legacy attribution review",
        exact: true,
      }),
      detail = page.locator("#muster-detail");
    async function find(term: string) {
      await panel
        .getByLabel("Search legacy records", { exact: true })
        .fill(term);
      await panel
        .getByRole("button", { name: "Find legacy records", exact: true })
        .click();
    }
    async function openTarget() {
      await find(fixture.target);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(1);
      await panel
        .getByRole("button", { name: "Open recorded work", exact: true })
        .click();
      await expect(detail).toContainText(
        "Legacy record: company attribution was not captured.",
      );
    }
    await test.step("Page and literally search actual pre-attribution work while excluding modern attributed records", async () => {
      expect(before.work).toHaveLength(29);
      expect(
        before.work.filter((r) => r.legal_company_id === null),
      ).toHaveLength(28);
      await openQueue();
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(25);
      await expect(
        panel.locator(`[data-legacy-id="${fixture.target}"]`),
      ).toHaveCount(0);
      await panel
        .getByRole("button", { name: "More legacy records", exact: true })
        .click();
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(28);
      expect(
        (
          await panel
            .locator("[data-legacy-id]")
            .evaluateAll((nodes) =>
              nodes.map((n) => n.getAttribute("data-legacy-id")),
            )
        ).sort(),
      ).toEqual(fixture.oldIds);
      await find("%_");
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(25);
      await panel
        .getByRole("button", { name: "More legacy records", exact: true })
        .click();
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(28);
      await expect(panel).not.toContainText("Hidden historical sibling");
    });
    await test.step("Retain the selected historical row through a detail failure then open real detail and return to its work queue", async () => {
      await find(fixture.target);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(1);
      await page.route(
        `**/api/estates/${fixture.estate}/musters/${fixture.target}`,
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "private historical detail diagnostic",
              requestId: "11111111-4000-4000-8000-000000000005",
            }),
          }),
        { times: 1 },
      );
      await panel
        .getByRole("button", { name: "Open recorded work", exact: true })
        .click();
      await expect(panel.getByRole("alert")).toContainText(
        "11111111-4000-4000-8000-000000000005",
      );
      await expect(panel).not.toContainText(
        "private historical detail diagnostic",
      );
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(1);
      await expect(
        panel.getByLabel("Search legacy records", { exact: true }),
      ).toHaveValue(fixture.target);
      await expect(detail).toHaveCount(0);
      await panel
        .getByRole("button", { name: "Open recorded work", exact: true })
        .click();
      await expect(detail).toBeFocused();
      await expect(detail).toContainText("2026-01-15");
      await expect(detail).toContainText("Historical fixture worker");
      await expect(detail.locator("[data-work-attribution]")).toHaveText(
        "Legacy record: company attribution was not captured.",
      );
      await expect(detail).not.toContainText(
        "Current baseline company is not historical evidence",
      );
      const guidance = detail.getByRole("region", {
        name: "Historical attribution guidance",
        exact: true,
      });
      await expect(guidance).toContainText(
        "does not assign or correct attribution",
      );
      await guidance
        .getByText("View historical record references", { exact: true })
        .click();
      await expect(guidance).toContainText(fixture.target);
      await expect(guidance).toContainText(fixture.estate);
      await expect(guidance).toContainText(fixture.task);
      await expect(
        detail.getByRole("button", { name: "Confirm muster", exact: true }),
      ).toHaveCount(0);
      await guidance
        .getByRole("button", {
          name: "Return to unresolved work review",
          exact: true,
        })
        .click();
      await expect(panel).toBeFocused();
      await expect(
        panel.getByLabel("Legacy review queue", { exact: true }),
      ).toHaveValue("work");
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(25);
    });
    await test.step("Reload and reopen the persisted historical record without changing attribution allocations state or audit", async () => {
      await page.reload();
      await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
        fixture.estate,
      );
      await openQueue();
      await openTarget();
      await expect(detail).toContainText("Muster detail · confirmed");
      const record = (await fixture.snapshot()).work.find(
        (r) => r.id === fixture.target,
      );
      expect(record.legal_company_id).toBeNull();
      expect(record.legal_company_name).toBeNull();
      expect(record.legal_responsibility_id).toBeNull();
      expect(record.version).toBe(1);
      expect(await fixture.snapshot()).toEqual(before);
      await detail
        .getByRole("button", {
          name: "Return to unresolved work review",
          exact: true,
        })
        .click();
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(25);
    });
    await test.step("Deny foreign and revoked historical reads clear cached work and recover only after explicit restored access", async () => {
      const hidden = await page.evaluate(async (id) => {
        const r = await fetch(`/api/estates/${id}/legacy-review/work`);
        return { status: r.status, body: await r.json() };
      }, fixture.hidden);
      expect(hidden.status).toBe(403);
      expect(hidden.body.error).toContain("Estate access denied");
      await find(fixture.target);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(1);
      await fixture.root.query(
        "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
        [fixture.user, fixture.estate],
      );
      await panel
        .getByRole("button", { name: "Open recorded work", exact: true })
        .click();
      await expect(panel).toContainText(
        "Cached records and private review inputs were cleared",
      );
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(0);
      await expect(
        panel.getByLabel("Search legacy records", { exact: true }),
      ).toHaveValue("");
      await expect(detail).toHaveCount(0);
      await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
        fixture.estate,
      );
      await fixture.root.query(
        "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'clerk')",
        [fixture.user, fixture.estate],
      );
      await panel
        .getByRole("button", { name: "Refresh legacy queue", exact: true })
        .click();
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(25);
      await openTarget();
      await expect(detail).toBeFocused();
      expect(await fixture.snapshot()).toEqual(before);
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await fixture.close();
  }
});
