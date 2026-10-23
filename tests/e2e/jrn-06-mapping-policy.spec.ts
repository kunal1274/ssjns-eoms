import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { independentSourceReviewer } from "../source-review-fixture";
test("E2E-JRN-06-009 @regression version and independently review policy criteria with audit retry and scope recovery", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const peer = await independentSourceReviewer(f),
      baseline = await f.snapshot();
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url()),
        response = await route.fetch({
          url: f.apiURL + url.pathname + url.search,
          headers: await route.request().allHeaders(),
        });
      await route.fulfill({ response });
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
      await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
        f.estate,
      );
      await page
        .getByRole("button", { name: "Task capacity", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Open legacy attribution review",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: "Open source mapping preview",
          exact: true,
        })
        .click();
    }
    await identity(f.raw);
    const panel = page.getByRole("region", {
        name: "Mapping policy design review",
        exact: true,
      }),
      save = panel.getByRole("button", {
        name: "Save policy proposal",
        exact: true,
      }),
      refresh = panel.getByRole("button", {
        name: "Refresh policy history",
        exact: true,
      }),
      selected = panel.getByRole("region", {
        name: "Selected policy version",
        exact: true,
      });
    const labels = [
      "Proposed custody criteria",
      "Proposed independent approver criteria",
      "Proposed evidence and concern resolution criteria",
    ];
    await test.step("Author explicit R0 criteria and recover a lost committed proposal response without duplicate versions", async () => {
      await expect(save).toBeDisabled();
      await expect(panel).toContainText("Latest proposal version: None");
      await panel.getByLabel(labels[0], { exact: true }).fill("short");
      await panel
        .getByLabel("Policy proposal reason", { exact: true })
        .fill("Prepare controlled design discussion");
      await expect(save).toBeDisabled();
      for (const [i, label] of labels.entries())
        await panel
          .getByLabel(label, { exact: true })
          .fill(
            [
              "Named archive custodian and controlled original reference",
              "Independent scoped mapping approver distinct from evidence actors",
              "Resolve every current concern and bind exact evidence revisions",
            ][i],
          );
      let lost = true;
      const url = "**/reconciliation/policies";
      // Drop only the response, after the real backend commits.
      await page.route(url, async (route) => {
        if (lost && route.request().method() === "POST") {
          lost = false;
          const u = new URL(route.request().url());
          const response = await route.fetch({
            url: f.apiURL + u.pathname,
            headers: await route.request().allHeaders(),
          });
          expect(response.status()).toBe(200);
          await route.fulfill({
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "X-Request-Id": "synthetic-policy-lost-response",
            },
            body: JSON.stringify({
              error: "Temporary policy response interruption",
            }),
          });
        } else await route.fallback();
      });
      await save.click();
      await expect(panel.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(panel.getByLabel(labels[0], { exact: true })).toBeDisabled();
      await expect(refresh).toBeDisabled();
      await save.click();
      await expect(panel).toContainText(
        "Recovered existing receipt. Policy proposal version 1",
      );
      await expect(selected).toContainText("Selected proposal version 1");
      await expect(
        selected.getByRole("button", {
          name: "Record policy review",
          exact: true,
        }),
      ).toBeDisabled();
      expect(
        (await f.root.query("SELECT * FROM eoms.mapping_policy_versions"))
          .rowCount,
      ).toBe(1);
      await selected
        .getByText("View detailed policy provenance", { exact: true })
        .click();
      const p = (
        await f.root.query("SELECT * FROM eoms.mapping_policy_versions")
      ).rows[0];
      await expect(selected).toContainText(p.request_id);
      await expect(selected).toContainText(p.sha256);
    });
    await test.step("Record independent design concerns and linked corrections with short and detailed audit", async () => {
      await identity(peer.raw);
      await panel
        .getByRole("button", { name: "Inspect policy version 1", exact: true })
        .click();
      const record = selected.getByRole("button", {
        name: "Record policy review",
        exact: true,
      });
      await expect(record).toBeDisabled();
      await selected
        .getByLabel("Policy review reference", { exact: true })
        .fill("Synthetic design workshop / custody");
      await selected
        .getByLabel("Policy review reason", { exact: true })
        .fill("Custodian responsibility needs clarification");
      await record.click();
      await expect(panel).toContainText("Policy review revision 1");
      await expect(selected.locator("[data-policy-review]")).toHaveCount(1);
      await selected
        .getByLabel("Policy review outcome", { exact: true })
        .selectOption("support-for-design");
      await selected
        .getByLabel("Policy review reference", { exact: true })
        .fill("Synthetic clarified design workshop");
      await selected
        .getByLabel("Policy review reason", { exact: true })
        .fill("Support design only after clarifying archive responsibility");
      await record.click();
      await expect(panel).toContainText("Policy review revision 2");
      await expect(selected.locator("[data-policy-review]")).toHaveCount(2);
      await expect(selected).toContainText("Superseded review");
      await expect(selected).toContainText("support-for-design: 1");
      const history = (
        await f.root.query(
          "SELECT * FROM eoms.mapping_policy_reviews ORDER BY revision",
        )
      ).rows;
      expect(history[1].previous_id).toBe(history[0].id);
      await selected
        .getByText("View detailed policy review", { exact: true })
        .last()
        .click();
      await expect(selected).toContainText(history[1].request_id);
    });
    await test.step("Revise criteria into a linked new version while retaining superseded proposal and review history", async () => {
      await selected
        .getByRole("button", {
          name: "Copy criteria into new proposal",
          exact: true,
        })
        .click();
      await panel
        .getByLabel(labels[0], { exact: true })
        .fill(
          "Revised named archive custodian with signed controlled original reference",
        );
      await panel
        .getByLabel("Policy proposal reason", { exact: true })
        .fill("Clarify custody criteria in a new immutable version");
      await save.click();
      await expect(selected).toContainText("Selected proposal version 2");
      await expect(panel).toContainText("Latest proposal version: 2");
      await panel
        .getByRole("button", { name: "Inspect policy version 1", exact: true })
        .click();
      await expect(selected).toContainText(
        "Superseded proposal — new reviews disabled",
      );
      await expect(selected.locator("[data-policy-review]")).toHaveCount(2);
      await expect(
        selected.getByRole("button", {
          name: "Record policy review",
          exact: true,
        }),
      ).toBeDisabled();
      expect(
        (await f.root.query("SELECT * FROM eoms.mapping_policy_versions"))
          .rowCount,
      ).toBe(2);
      expect(await f.snapshot()).toEqual(baseline);
      await expect(panel).toContainText("Approval and application disabled");
    });
    await test.step("Recover a policy read interruption and clear private criteria after setup and membership revocation", async () => {
      let fail = true;
      await page.route("**/reconciliation/policies?*", async (route) => {
        if (fail) {
          fail = false;
          await route.fulfill({
            status: 503,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: "Temporary policy read interruption",
            }),
          });
        } else await route.fallback();
      });
      await refresh.click();
      await expect(panel.getByRole("alert")).toBeVisible();
      await expect(selected).toHaveCount(0);
      await refresh.click();
      await expect(panel).toContainText("Latest proposal version: 2");
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, peer.id],
      );
      await refresh.click();
      await expect(panel).toHaveCount(0);
      await expect(page.getByLabel(labels[0], { exact: true })).toHaveCount(0);
      await f.root.query(
        "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
        [f.customer, peer.id],
      );
      await identity(peer.raw);
      await expect(panel).toContainText("Latest proposal version: 2");
      await f.root.query(
        "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
        [f.estate, peer.id],
      );
      await refresh.click();
      await expect(panel).toHaveCount(0);
      expect(await f.snapshot()).toEqual(baseline);
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});
