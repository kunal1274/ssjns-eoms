import { test, expect } from "./fixtures";
import { mappingWorkflowFixture } from "../mapping-workflow-fixture";
test("E2E-JRN-06-011 @regression submit bound mapping requests and independently return correct approve and withdraw without applying history", async ({
  page,
  context,
}) => {
  const x = await mappingWorkflowFixture(),
    f = x.f;
  try {
    const baseline = await f.snapshot();
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url()),
        r = await route.fetch({
          url: f.apiURL + u.pathname + u.search,
          headers: await route.request().allHeaders(),
        });
      await route.fulfill({ response: r });
    });
    async function navigate(raw: string) {
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
      await page
        .getByRole("button", {
          name: "Open saved review " + x.job.id,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: "Open mapping requests " + x.check.id,
          exact: true,
        })
        .click();
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
          expect(r.status()).toBe(200);
          await route.fulfill({
            status: 503,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: "Temporary mapping response interruption",
            }),
          });
        } else await route.fallback();
      });
    }
    const panel = page.getByRole("region", {
        name: "Governed mapping requests",
        exact: true,
      }),
      selected = panel.getByRole("region", {
        name: "Selected mapping decision",
        exact: true,
      }),
      submit = panel.getByRole("button", {
        name: "Submit bound mapping request",
        exact: true,
      }),
      record = panel.getByRole("button", {
        name: "Record independent mapping decision",
        exact: true,
      }),
      refresh = panel.getByRole("button", {
        name: "Refresh mapping workflow",
        exact: true,
      });
    async function requestForm(reason: string) {
      await panel
        .getByLabel("Mapping custody reference", { exact: true })
        .fill(
          "Synthetic controlled custody reference / " + "archive".repeat(20),
        );
      await panel
        .getByLabel("Mapping request reason", { exact: true })
        .fill(reason);
    }
    async function decisionForm(outcome: string, reason: string) {
      await selected
        .getByLabel("Mapping decision outcome", { exact: true })
        .selectOption(outcome);
      await selected
        .getByLabel("Mapping decision reference", { exact: true })
        .fill("Synthetic independent decision reference");
      await selected
        .getByLabel("Mapping decision reason", { exact: true })
        .fill(reason);
      await expect(record).toBeDisabled();
      await selected
        .getByLabel(
          "I examined the bound manifest custody and current observations",
          { exact: true },
        )
        .check();
    }
    let first: any, child: any, third: any;
    await navigate(f.raw);
    await test.step("Renew explicit mapping appointment and recover one bound submission with actual snapshot audit", async () => {
      await expect(panel).toContainText(
        "Current checks allow a separate request submission",
      );
      await expect(submit).toBeDisabled();
      await panel
        .getByRole("button", {
          name:
            "Select mapping recorder Independent synthetic source reviewer " +
            x.decider.id,
          exact: true,
        })
        .click();
      await panel
        .getByLabel("Mapping appointment reference", { exact: true })
        .fill("Synthetic owner renewal of separate mapping recorder");
      await panel
        .getByLabel("Mapping appointment reason", { exact: true })
        .fill("Explicit appointment renewal for exact accepted policy");
      await panel
        .getByRole("button", {
          name: "Record mapping appointment",
          exact: true,
        })
        .click();
      await expect(panel).toContainText("Mapping appointment revision 2");
      await requestForm("Submit exact historical mapping proposal");
      await drop("**/evidence/*/mapping-requests");
      await submit.click();
      await expect(panel.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        panel.getByLabel("Mapping custody reference", { exact: true }),
      ).toBeDisabled();
      await expect(refresh).toBeDisabled();
      await submit.click();
      await expect(panel).toContainText(
        "Recovered existing receipt. Bound mapping request",
      );
      first = (await f.root.query("SELECT * FROM eoms.mapping_requests"))
        .rows[0];
      expect(
        (await f.root.query("SELECT * FROM eoms.mapping_requests")).rowCount,
      ).toBe(1);
      await selected
        .getByText("View bound mapping snapshot and provenance", {
          exact: true,
        })
        .click();
      await expect(selected).toContainText(first.request_id);
      await expect(selected).toContainText(first.snapshot_sha256);
      await expect(record).toBeDisabled();
      expect(await f.snapshot()).toEqual(baseline);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    });
    await test.step("Record independent return and submit one linked immutable correction", async () => {
      await navigate(x.decider.raw);
      await panel
        .getByRole("button", {
          name: "Inspect mapping request " + first.id,
          exact: true,
        })
        .click();
      await decisionForm(
        "returned",
        "Clarify controlled custody evidence before approval",
      );
      await record.click();
      await expect(selected).toContainText("Decision: returned");
      await navigate(f.raw);
      await panel
        .getByRole("button", {
          name: "Inspect mapping request " + first.id,
          exact: true,
        })
        .click();
      await selected
        .getByRole("button", {
          name: "Prepare linked mapping correction",
          exact: true,
        })
        .click();
      await expect(
        panel.getByLabel("Previous returned or withdrawn request", {
          exact: true,
        }),
      ).toHaveValue(first.id);
      await requestForm(
        "Linked correction supplies clarified custody reference",
      );
      await submit.click();
      await expect(selected).toContainText("Awaiting independent decision");
      child = (
        await f.root.query(
          "SELECT * FROM eoms.mapping_requests WHERE previous_id=$1",
          [first.id],
        )
      ).rows[0];
      expect(child.previous_id).toBe(first.id);
      await selected
        .getByText("View bound mapping snapshot and provenance", {
          exact: true,
        })
        .click();
      await expect(selected).toContainText(first.id);
    });
    await test.step("Reject stale approval after a real observation revision then correct and recover one independent approval", async () => {
      await navigate(x.decider.raw);
      await panel
        .getByRole("button", {
          name: "Inspect mapping request " + child.id,
          exact: true,
        })
        .click();
      await decisionForm(
        "approved",
        "Approve only after examining bound identities",
      );
      await expect(record).toBeEnabled();
      await x.observe("corroborated", 1);
      await record.click();
      await expect(panel.getByRole("alert")).toContainText("changed");
      await expect(
        selected.getByLabel("Mapping decision reason", { exact: true }),
      ).toHaveValue("Approve only after examining bound identities");
      await refresh.click();
      await expect(selected).toContainText("Bound evidence or records changed");
      await expect(record).toBeDisabled();
      await decisionForm(
        "returned",
        "Observation identity changed; request renewed exact review",
      );
      await record.click();
      await expect(selected).toContainText("Decision: returned");
      await navigate(f.raw);
      await panel
        .getByRole("button", {
          name: "Inspect mapping request " + child.id,
          exact: true,
        })
        .click();
      await selected
        .getByRole("button", {
          name: "Prepare linked mapping correction",
          exact: true,
        })
        .click();
      await requestForm(
        "Renewed request binds latest corroborating observation",
      );
      await submit.click();
      third = (
        await f.root.query(
          "SELECT * FROM eoms.mapping_requests WHERE previous_id=$1",
          [child.id],
        )
      ).rows[0];
      expect(third.snapshot.observations[0].revision).toBe(2);
      await navigate(x.decider.raw);
      await panel
        .getByRole("button", {
          name: "Inspect mapping request " + third.id,
          exact: true,
        })
        .click();
      await decisionForm(
        "approved",
        "Independent review of renewed exact mapping snapshot",
      );
      await drop("**/mapping-requests/*/decisions");
      await record.click();
      await expect(panel.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        selected.getByLabel("Mapping decision reason", { exact: true }),
      ).toBeDisabled();
      await record.click();
      await expect(panel).toContainText(
        "Recovered existing receipt. Independent mapping decision revision 1",
      );
      await expect(selected).toContainText("Recorded approval current");
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.mapping_decisions WHERE mapping_request_id=$1",
            [third.id],
          )
        ).rowCount,
      ).toBe(1);
      await selected
        .getByText("View detailed mapping decision", { exact: true })
        .click();
      const d = (
        await f.root.query(
          "SELECT * FROM eoms.mapping_decisions WHERE mapping_request_id=$1",
          [third.id],
        )
      ).rows[0];
      await expect(selected).toContainText(d.request_id);
      expect(await f.snapshot()).toEqual(baseline);
    });
    await test.step("Invalidate approval on a current concern retain withdrawal history and recover read or access failures", async () => {
      await x.observe("concerns", 2);
      await refresh.click();
      await expect(selected).toContainText("No current approval");
      await expect(panel).toContainText("Concerns 1");
      await decisionForm(
        "withdrawn",
        "Withdraw recorded approval after current source concern",
      );
      await record.click();
      await expect(selected).toContainText("Decision: withdrawn");
      await expect(selected.locator("[data-mapping-decision]")).toHaveCount(2);
      const d = (
        await f.root.query(
          "SELECT * FROM eoms.mapping_decisions WHERE mapping_request_id=$1 ORDER BY revision",
          [third.id],
        )
      ).rows;
      expect(d[1].previous_id).toBe(d[0].id);
      await expect(selected).toContainText("Application disabled");
      let fail = true;
      await page.route("**/mapping-requests/context", async (route) => {
        if (fail) {
          fail = false;
          await route.fulfill({
            status: 503,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: "Temporary mapping read interruption",
            }),
          });
        } else await route.fallback();
      });
      await refresh.click();
      await expect(panel.getByRole("alert")).toBeVisible();
      await expect(selected).toHaveCount(0);
      await refresh.click();
      await expect(selected).toContainText("Decision: withdrawn");
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, x.decider.id],
      );
      await refresh.click();
      await expect(panel).toHaveCount(0);
      await expect(page.locator("[data-mapping-decision]")).toHaveCount(0);
      expect(await f.snapshot()).toEqual(baseline);
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});
