import { test, expect } from "./fixtures";
import { createHash } from "node:crypto";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { independentSourceReviewer } from "../source-review-fixture";
test("E2E-JRN-06-007 @regression independent provenance observations recover and preserve correction lineage", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true }),
    reviewer = await independentSourceReviewer(f);
  try {
    const bytes = Buffer.from("controlled provenance original A"),
      sha = createHash("sha256").update(bytes).digest("hex"),
      before = await f.snapshot(),
      manifest = {
        version: 1,
        source: {
          system: "Synthetic controlled source",
          documentRef: "Original reference for independent review",
          sha256: sha,
        },
        rows: [
          {
            sourceRow: "A:2",
            kind: "work-company",
            recordId: f.target,
            recordVersion: 1,
            targetId: f.company,
            reason: "Review original attribution proposal",
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
    }
    async function navigate() {
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
    await page.goto("/");
    await navigate();
    const panel = page.getByRole("region", {
        name: "Source mapping preview",
        exact: true,
      }),
      jobs = panel.getByRole("region", {
        name: "Saved reconciliation reviews",
        exact: true,
      }),
      source = jobs.getByRole("region", {
        name: "Source file checks",
        exact: true,
      }),
      review = source.getByRole("region", {
        name: "Independent provenance review",
        exact: true,
      }),
      submit = review.getByRole("button", {
        name: "Record provenance observation",
        exact: true,
      }),
      outcome = review.getByLabel("Review outcome", { exact: true }),
      examined = review.getByLabel(
        "I examined the controlled original and its provenance",
        { exact: true },
      ),
      reference = review.getByLabel("Controlled document reference", {
        exact: true,
      }),
      reason = review.getByLabel("Provenance review reason", { exact: true });
    await panel
      .getByLabel("Mapping manifest JSON", { exact: true })
      .fill(JSON.stringify(manifest));
    await panel
      .getByRole("button", { name: "Preview source mappings", exact: true })
      .click();
    await expect(
      panel.getByRole("region", {
        name: "Reconciliation preview results",
        exact: true,
      }),
    ).toContainText("1 require review");
    await jobs
      .getByLabel("Review retention reason", { exact: true })
      .fill("Retain proposal for independent provenance observation");
    await jobs
      .getByRole("button", { name: "Save review snapshot", exact: true })
      .click();
    await source
      .getByLabel("Original source file", { exact: true })
      .setInputFiles({
        name: "controlled-original.bin",
        mimeType: "application/octet-stream",
        buffer: bytes,
      });
    await source
      .getByLabel("Source provenance reason", { exact: true })
      .fill("Compare bytes before independent examination");
    await source
      .getByRole("button", { name: "Check source file digest", exact: true })
      .click();
    await expect(source).toContainText(
      "File bytes match the saved declaration",
    );
    const job = (await f.root.query("SELECT * FROM eoms.reconciliation_jobs"))
        .rows[0],
      check = (
        await f.root.query("SELECT * FROM eoms.reconciliation_evidence_checks")
      ).rows[0];
    let firstId = "",
      secondId = "";
    async function open() {
      await jobs
        .getByRole("button", {
          name: "Open saved review " + job.id,
          exact: true,
        })
        .click();
      await source
        .getByRole("button", {
          name: "Open provenance review " + check.id,
          exact: true,
        })
        .click();
      await expect(review).toContainText("Your current review revision");
    }
    await test.step("Prevent preparer self-review and require a separate reviewer with explicit original examination before corroboration", async () => {
      await source
        .getByRole("button", {
          name: "Open provenance review " + check.id,
          exact: true,
        })
        .click();
      await expect(review).toContainText("cannot record an independent review");
      await expect(submit).toBeDisabled();
      expect(
        (await f.root.query("SELECT * FROM eoms.source_provenance_reviews"))
          .rowCount,
      ).toBe(0);
      await identity(reviewer.raw);
      await page.reload();
      await navigate();
      await open();
      await expect(review).toContainText("Your current review revision: 0");
      await outcome.selectOption("corroborated");
      await reference.fill("Controlled archive / original A");
      await reason.fill("x");
      await expect(submit).toBeDisabled();
      await reason.fill(
        "Independently examined original and custody reference",
      );
      await expect(submit).toBeDisabled();
      await examined.check();
      await expect(submit).toBeEnabled();
      await expect(review).toContainText(
        "does not certify authenticity, approve a mapping or change historical facts",
      );
    });
    await test.step("Recover a committed independent observation after response loss and inspect actual reviewer and request audit", async () => {
      let lost = true;
      const url = "**/reconciliation/jobs/*/evidence/*/reviews";
      await page.route(url, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const u = new URL(route.request().url()),
          response = await route.fetch({
            url: f.apiURL + u.pathname,
            headers: await route.request().allHeaders(),
          });
        if (lost) {
          lost = false;
          expect(response.status()).toBe(200);
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Temporary provenance response interruption",
            }),
          });
        } else await route.fulfill({ response });
      });
      await submit.click();
      await expect(review.getByRole("alert")).toContainText(
        "Retry the same review",
      );
      await expect(reference).toBeDisabled();
      await expect(reason).toBeDisabled();
      await submit.click();
      await expect(review).toContainText("Review recovered. Revision 1.");
      await expect(review.locator("[data-source-review-id]")).toHaveCount(1);
      const rows = (
        await f.root.query("SELECT * FROM eoms.source_provenance_reviews")
      ).rows;
      expect(rows).toHaveLength(1);
      firstId = rows[0].id;
      expect(rows[0].reviewer_id).toBe(reviewer.id);
      await review
        .getByText("View detailed provenance review", { exact: true })
        .click();
      await expect(review).toContainText(rows[0].request_id);
      await expect(review).toContainText(reviewer.id);
      expect(await f.snapshot()).toEqual(before);
      expect(
        (
          await f.root.query(
            "SELECT source_authenticity_verified FROM eoms.reconciliation_evidence_checks",
          )
        ).rows[0].source_authenticity_verified,
      ).toBe(false);
      await page.unroute(url);
    });
    await test.step("Reject a stale tab then refresh and append a correction with previous observations visibly superseded", async () => {
      await expect(review).toContainText("Your current review revision: 1");
      const r = await page.request.post(
        f.apiURL +
          `/api/estates/${f.estate}/reconciliation/jobs/${job.id}/evidence/${check.id}/reviews`,
        {
          headers: {
            Cookie: "eoms_session=" + reviewer.raw,
            Origin: "http://localhost:5284",
            "X-CSRF-Token": "synthetic-history-ui",
          },
          data: {
            key: crypto.randomUUID(),
            expectedRevision: 1,
            outcome: "concerns",
            originalExamined: false,
            sourceRef: "Controlled archive / amended custody",
            reason: "Another tab recorded a custody concern",
          },
        },
      );
      expect(r.status()).toBe(200);
      secondId = (await r.json()).review.id;
      await outcome.selectOption("insufficient");
      await reference.fill("Controlled archive / pending confirmation");
      await reason.fill("Additional provenance required before any decision");
      await submit.click();
      await expect(review.getByRole("alert")).toContainText("revision changed");
      await expect(reason).toHaveValue(
        "Additional provenance required before any decision",
      );
      expect(
        (await f.root.query("SELECT * FROM eoms.source_provenance_reviews"))
          .rowCount,
      ).toBe(2);
      await review
        .getByRole("button", {
          name: "Refresh provenance reviews",
          exact: true,
        })
        .click();
      await expect(review).toContainText("Your current review revision: 2");
      await submit.click();
      await expect(review).toContainText(
        "Independent review recorded. Revision 3.",
      );
      await expect(review.locator("[data-source-review-id]")).toHaveCount(3);
      await expect(
        review
          .locator("[data-source-review-id]")
          .filter({ hasText: "Superseded by later revision" }),
      ).toHaveCount(2);
      const rows = (
        await f.root.query(
          "SELECT * FROM eoms.source_provenance_reviews ORDER BY revision",
        )
      ).rows;
      expect(rows[0].id).toBe(firstId);
      expect(rows[1].previous_id).toBe(firstId);
      expect(rows[2].previous_id).toBe(secondId);
      expect(
        (await f.root.query("SELECT * FROM eoms.reconciliation_jobs")).rows[0],
      ).toEqual(job);
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Reopen persisted provenance lineage and clear private observations after setup and membership revocation", async () => {
      await page.reload();
      await navigate();
      await open();
      await expect(review).toContainText("Your current review revision: 3");
      await expect(review.locator("[data-source-review-id]")).toHaveCount(3);
      await expect(reference).toHaveValue("");
      await reference.fill("Private controlled document draft");
      await reason.fill("Private review input to be cleared");
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, reviewer.id],
      );
      await review
        .getByRole("button", {
          name: "Refresh provenance reviews",
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
      await f.root.query(
        "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
        [f.customer, reviewer.id],
      );
      await page.reload();
      await navigate();
      await open();
      await expect(reference).toHaveValue("");
      await expect(reason).toHaveValue("");
      await reference.fill("Controlled archive / revoked attempt");
      await reason.fill("Attempt after membership revocation");
      await f.root.query(
        "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
        [f.estate, reviewer.id],
      );
      await submit.click();
      await expect(panel).toHaveCount(0);
      expect(
        (await f.root.query("SELECT * FROM eoms.source_provenance_reviews"))
          .rowCount,
      ).toBe(3);
      expect(await f.snapshot()).toEqual(before);
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});
