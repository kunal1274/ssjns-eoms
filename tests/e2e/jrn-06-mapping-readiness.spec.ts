import { test, expect } from "./fixtures";
import { randomUUID, createHash } from "node:crypto";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { independentSourceReviewer } from "../source-review-fixture";
test("E2E-JRN-06-008 @regression inspect mapping drift conflicts and draft policy without granting application", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const peer = await independentSourceReviewer(f),
      other = await independentSourceReviewer(f),
      bytes = Buffer.from("controlled readiness original"),
      sha = createHash("sha256").update(bytes).digest("hex"),
      manifest = {
        version: 1,
        source: {
          system: "Synthetic readiness source",
          documentRef: "Readiness controlled original",
          sha256: sha,
        },
        rows: [
          {
            sourceRow: "A:2",
            kind: "work-company",
            recordId: f.target,
            recordVersion: 1,
            targetId: f.company,
            reason: "Inspect proposed historical attribution",
          },
        ],
      };
    await f.root.query(
      "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2026-01-01')",
      [f.estate],
    );
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
      readiness = source.getByRole("region", {
        name: "Mapping readiness inspection",
        exact: true,
      }),
      refresh = readiness.getByRole("button", {
        name: "Refresh mapping readiness",
        exact: true,
      });
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
      .fill("Retain proposal for inspection");
    await jobs
      .getByRole("button", { name: "Save review snapshot", exact: true })
      .click();
    await source
      .getByLabel("Original source file", { exact: true })
      .setInputFiles({
        name: "readiness-original.bin",
        mimeType: "application/octet-stream",
        buffer: bytes,
      });
    await source
      .getByLabel("Source provenance reason", { exact: true })
      .fill("Compare controlled original bytes");
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
      ).rows[0],
      before = await f.snapshot();
    async function observe(
      person: typeof peer,
      outcome: string,
      expectedRevision = 0,
    ) {
      const r = await page.request.post(
        f.apiURL +
          `/api/estates/${f.estate}/reconciliation/jobs/${job.id}/evidence/${check.id}/reviews`,
        {
          headers: {
            Cookie: "eoms_session=" + person.raw,
            Origin: "http://localhost:5284",
            "X-CSRF-Token": "synthetic-history-ui",
          },
          data: {
            key: randomUUID(),
            expectedRevision,
            outcome,
            originalExamined: outcome === "corroborated",
            sourceRef: "Controlled archive / inspection",
            reason: "Independent inspection observation: " + outcome,
          },
        },
      );
      expect(r.status()).toBe(200);
    }
    await test.step("Open fresh saved-mapping inspection and inspect support provenance and unapproved policy with no write authorization", async () => {
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/readiness") && r.request().method() === "GET",
      );
      await source
        .getByRole("button", {
          name: "Inspect mapping readiness " + check.id,
          exact: true,
        })
        .click();
      const r = await response;
      expect(r.headers()["cache-control"]).toBe("no-store");
      const v = await r.json();
      expect(v.approvalEnabled).toBe(false);
      expect(v.applicationEnabled).toBe(false);
      expect(v.applied).toBe(false);
      await expect(readiness).toContainText(
        "0 currently blocked · 0 record changes since save",
      );
      await expect(readiness).toContainText(
        "No independent provenance observations",
      );
      await readiness
        .getByText("View readiness provenance", { exact: true })
        .click();
      await expect(readiness).toContainText(v.requestId);
      await expect(readiness).toContainText(job.manifest_sha256);
      await readiness
        .getByText("View proposed mapping policy R0", { exact: true })
        .click();
      await expect(readiness).toContainText("Draft — owner review required");
      await expect(
        readiness.getByRole("button", { name: /approve|apply|execute/i }),
      ).toHaveCount(0);
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Refresh latest observations without hiding conflicts superseded outcomes or concerns from a reviewer whose access changed", async () => {
      await observe(peer, "corroborated");
      await observe(other, "concerns");
      await refresh.click();
      await expect(readiness).toContainText(
        "Current observations: 2 · corroborated 1 · concerns 1 · insufficient 0",
      );
      await expect(
        readiness.locator('[data-readiness-finding="REVIEWER_CONCERNS"]'),
      ).toBeVisible();
      await observe(other, "insufficient", 1);
      await refresh.click();
      await expect(readiness).toContainText(
        "Current observations: 2 · corroborated 1 · concerns 0 · insufficient 1",
      );
      await observe(other, "concerns", 2);
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, other.id],
      );
      await refresh.click();
      await expect(readiness).toContainText("reviewer access changed 1");
      await expect(
        readiness.locator('[data-readiness-finding="REVIEWER_CONCERNS"]'),
      ).toBeVisible();
      await expect(
        readiness.locator('[data-readiness-finding="REVIEWER_ACCESS_CHANGED"]'),
      ).toBeVisible();
      await readiness
        .getByText("View current reviewer observations", { exact: true })
        .click();
      await expect(
        readiness.locator("[data-readiness-observation]"),
      ).toHaveCount(2);
      await expect(readiness).toContainText("Review authority changed");
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Detect separately committed record-version drift and retain the original saved snapshot without approving application", async () => {
      const r = await page.request.post(
        f.apiURL + `/api/estates/${f.estate}/musters/${f.target}/approve`,
        {
          headers: {
            Cookie: "eoms_session=" + f.raw,
            Origin: "http://localhost:5284",
            "X-CSRF-Token": "synthetic-history-ui",
          },
          data: {
            version: 1,
            reason: "Separately guarded operational review before refresh",
          },
        },
      );
      expect(r.status()).toBe(200);
      const afterOperation = await f.snapshot();
      await refresh.click();
      await expect(readiness).toContainText(
        "1 currently blocked · 1 record changes since save",
      );
      await expect(readiness).toContainText(
        "Saved snapshot: 0 blocked at save",
      );
      await expect(readiness).toContainText("recorded version has changed");
      await expect(
        readiness.locator('[data-readiness-finding="RECORD_DRIFT"]'),
      ).toBeVisible();
      expect(
        (await f.root.query("SELECT * FROM eoms.reconciliation_jobs")).rows[0],
      ).toEqual(job);
      expect(await f.snapshot()).toEqual(afterOperation);
    });
    await test.step("Recover a temporary inspection failure and clear report metadata after setup and membership revocation", async () => {
      const url = "**/reconciliation/jobs/*/evidence/*/readiness";
      await page.route(
        url,
        async (route) => {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Temporary readiness interruption" }),
          });
        },
        { times: 1 },
      );
      await refresh.click();
      await expect(readiness.getByRole("alert")).toBeVisible();
      await expect(readiness.locator("[data-readiness-row]")).toHaveCount(0);
      await refresh.click();
      await expect(readiness).toContainText("1 currently blocked");
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, f.user],
      );
      await refresh.click();
      await expect(panel).toHaveCount(0);
      await expect(
        page.getByRole("region", {
          name: "Legacy attribution review",
          exact: true,
        }),
      ).toContainText("Cached records and private review inputs were cleared");
      await f.root.query(
        "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
        [f.customer, f.user],
      );
      await page.reload();
      await navigate();
      await jobs
        .getByRole("button", {
          name: "Open saved review " + job.id,
          exact: true,
        })
        .click();
      await source
        .getByRole("button", {
          name: "Inspect mapping readiness " + check.id,
          exact: true,
        })
        .click();
      await expect(readiness).toContainText("1 currently blocked");
      await f.root.query(
        "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
        [f.estate, f.user],
      );
      await refresh.click();
      await expect(panel).toHaveCount(0);
      expect(
        (await f.root.query("SELECT * FROM eoms.reconciliation_job_history"))
          .rowCount,
      ).toBe(1);
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});
