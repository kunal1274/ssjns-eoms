import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
test("E2E-JRN-06-005 @regression save recover and reopen scoped reconciliation review with actual audit", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const before = await f.snapshot(),
      manifest = {
        version: 1,
        source: {
          system: "Synthetic legacy export",
          documentRef: "Review retention evidence / A",
          sha256: "c".repeat(64),
        },
        rows: [
          {
            sourceRow: "A:2",
            kind: "work-company",
            recordId: f.target,
            recordVersion: 1,
            targetId: f.company,
            reason: "Review original historical attribution",
          },
        ],
      };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url()),
        response = await route.fetch({
          url: f.apiURL + url.pathname + url.search,
          headers: await route.request().allHeaders(),
        });
      await route.fulfill({ response });
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
    async function navigate() {
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
    await page.goto("/");
    await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
      f.estate,
    );
    await navigate();
    const panel = page.getByRole("region", {
        name: "Source mapping preview",
        exact: true,
      }),
      draft = panel.getByLabel("Mapping manifest JSON", { exact: true }),
      preview = panel.getByRole("button", {
        name: "Preview source mappings",
        exact: true,
      }),
      reviews = panel.getByRole("region", {
        name: "Saved reconciliation reviews",
        exact: true,
      }),
      reason = reviews.getByLabel("Review retention reason", { exact: true }),
      save = reviews.getByRole("button", {
        name: "Save review snapshot",
        exact: true,
      }),
      detail = reviews.getByRole("region", {
        name: "Saved review detail",
        exact: true,
      });
    let jobId = "",
      requestId = "";
    await test.step("Recover a committed save after a lost response with exactly one review and audit event", async () => {
      await expect(save).toBeDisabled();
      await draft.fill(JSON.stringify(manifest));
      await preview.click();
      await expect(
        panel.getByRole("region", {
          name: "Reconciliation preview results",
          exact: true,
        }),
      ).toContainText("1 rows · 0 blocked · 1 require review");
      await reason.fill("x");
      await expect(save).toBeDisabled();
      await reason.fill("Retain source proposal for independent review");
      const jobURL = "**/reconciliation/jobs";
      let lost = true;
      await page.route(jobURL, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const url = new URL(route.request().url()),
          response = await route.fetch({
            url: f.apiURL + url.pathname,
            headers: await route.request().allHeaders(),
          });
        if (lost) {
          lost = false;
          expect(response.status()).toBe(200);
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Temporary response interruption",
              requestId: "synthetic-lost-save",
            }),
          });
        } else await route.fulfill({ response });
      });
      await save.click();
      await expect(reviews.getByRole("alert")).toContainText(
        "Retry the same save",
      );
      await expect(reason).toBeDisabled();
      await expect(draft).toBeDisabled();
      await save.click();
      await expect(reviews).toContainText(
        "Saved review recovered. No duplicate review or audit event was created.",
      );
      await expect(draft).toBeEnabled();
      const jobs = (
        await f.root.query("SELECT * FROM eoms.reconciliation_jobs")
      ).rows;
      expect(jobs).toHaveLength(1);
      jobId = jobs[0].id;
      requestId = jobs[0].request_id;
      expect(
        (await f.root.query("SELECT * FROM eoms.reconciliation_job_history"))
          .rowCount,
      ).toBe(1);
      expect(await f.snapshot()).toEqual(before);
      await page.unroute(jobURL);
    });
    await test.step("Reload and reopen the saved manifest validation snapshot and short and detailed recorded audit", async () => {
      await page.reload();
      await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
        f.estate,
      );
      await navigate();
      await expect(draft).toHaveValue("");
      await reviews
        .getByRole("button", {
          name: "Open saved review " + jobId,
          exact: true,
        })
        .click();
      await expect(detail).toContainText("Historical records unchanged");
      await expect(detail).toContainText("Audit: 1 recorded event.");
      await expect(detail).toContainText(
        "Retain source proposal for independent review",
      );
      await detail
        .getByText("View detailed review audit", { exact: true })
        .click();
      await expect(detail).toContainText(requestId);
      await expect(detail).toContainText(f.user);
      await detail
        .getByText("View saved manifest and validation details", {
          exact: true,
        })
        .click();
      await expect(detail).toContainText('"sourceEvidenceVerified": false');
      await expect(detail).toContainText(f.target);
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Load a saved manifest for current revalidation and save a distinct blocked snapshot without rewriting history", async () => {
      await detail
        .getByRole("button", {
          name: "Load saved manifest for revalidation",
          exact: true,
        })
        .click();
      // PostgreSQL jsonb preserves values, not object-key serialization order.
      await expect
        .poll(async () => {
          const value = await draft.inputValue();
          return value ? JSON.parse(value) : null;
        })
        .toEqual(manifest);
      await expect(save).toBeDisabled();
      const changed = structuredClone(manifest);
      changed.rows[0].recordVersion = 99;
      await draft.fill(JSON.stringify(changed));
      await preview.click();
      await expect(
        panel.getByRole("region", {
          name: "Reconciliation preview results",
          exact: true,
        }),
      ).toContainText("1 blocked");
      await reason.fill("Retain stale proposal for source correction");
      await save.click();
      await expect(reviews).toContainText(
        "Review saved with a fresh validation snapshot and audit event.",
      );
      expect(
        (await f.root.query("SELECT * FROM eoms.reconciliation_jobs")).rowCount,
      ).toBe(2);
      expect(
        (await f.root.query("SELECT * FROM eoms.reconciliation_job_history"))
          .rowCount,
      ).toBe(2);
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Clear retained manifests and audits after setup loss and deny reopened detail after membership revocation", async () => {
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, f.user],
      );
      await panel
        .getByRole("button", { name: "Refresh mapping access", exact: true })
        .click();
      await expect(panel).toContainText("Read-only access");
      await expect(reviews).toHaveCount(0);
      await expect(draft).toHaveValue("");
      await expect(panel).not.toContainText(manifest.source.documentRef);
      await f.root.query(
        "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
        [f.customer, f.user],
      );
      await panel
        .getByRole("button", { name: "Refresh mapping access", exact: true })
        .click();
      await expect(
        reviews.getByRole("button", {
          name: "Open saved review " + jobId,
          exact: true,
        }),
      ).toBeVisible();
      await f.root.query(
        "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
        [f.estate, f.user],
      );
      await reviews
        .getByRole("button", {
          name: "Open saved review " + jobId,
          exact: true,
        })
        .click();
      await expect(panel).toHaveCount(0);
      await expect(
        page.getByRole("region", {
          name: "Legacy attribution review",
          exact: true,
        }),
      ).toContainText("Cached records and private review inputs were cleared");
      expect(await f.snapshot()).toEqual(before);
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});
