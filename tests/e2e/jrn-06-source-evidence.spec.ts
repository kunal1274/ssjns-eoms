import { test, expect } from "./fixtures";
import { createHash } from "node:crypto";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
test("E2E-JRN-06-006 @regression compare original source bytes and reopen immutable scoped check audit", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const bytes = Buffer.from([0, 255, 10, 32, 128, 65, 66]),
      sha = createHash("sha256").update(bytes).digest("hex"),
      before = await f.snapshot(),
      manifest = {
        version: 1,
        source: {
          system: "Controlled synthetic source",
          documentRef: "Source byte comparison / A",
          sha256: sha,
        },
        rows: [
          {
            sourceRow: "A:2",
            kind: "work-company",
            recordId: f.target,
            recordVersion: 1,
            targetId: f.company,
            reason: "Review original company attribution",
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
      reviews = panel.getByRole("region", {
        name: "Saved reconciliation reviews",
        exact: true,
      }),
      evidence = reviews.getByRole("region", {
        name: "Source file checks",
        exact: true,
      }),
      file = evidence.getByLabel("Original source file", { exact: true }),
      reason = evidence.getByLabel("Source provenance reason", { exact: true }),
      submit = evidence.getByRole("button", {
        name: "Check source file digest",
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
    await reviews
      .getByLabel("Review retention reason", { exact: true })
      .fill("Retain source proposal before checking bytes");
    await reviews
      .getByRole("button", { name: "Save review snapshot", exact: true })
      .click();
    await expect(evidence).toBeVisible();
    const originalJob = (
        await f.root.query("SELECT * FROM eoms.reconciliation_jobs")
      ).rows[0],
      jobId = originalJob.id;
    let matchId = "",
      support = "";
    async function upload(buffer: Buffer, name = "controlled-source.bin") {
      await file.setInputFiles({
        name,
        mimeType: "application/octet-stream",
        buffer,
      });
      await expect(evidence).toContainText("Selected source: " + name);
    }
    await test.step("Validate source-file bounds and record a real mismatch without authenticating or changing historical work", async () => {
      await expect(submit).toBeDisabled();
      await file.setInputFiles({
        name: "empty.bin",
        mimeType: "application/octet-stream",
        buffer: Buffer.alloc(0),
      });
      await expect(evidence.getByRole("alert")).toContainText(
        "non-empty source file",
      );
      await file.setInputFiles({
        name: "too-large.bin",
        mimeType: "application/octet-stream",
        buffer: Buffer.alloc(2097153),
      });
      await expect(evidence.getByRole("alert")).toContainText("2 MiB");
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.reconciliation_evidence_checks",
          )
        ).rowCount,
      ).toBe(0);
      await upload(Buffer.from("wrong source"), "wrong-source.bin");
      await reason.fill("x");
      await expect(submit).toBeDisabled();
      await reason.fill("Check candidate against original reference");
      await submit.click();
      await expect(evidence).toContainText(
        "File bytes do not match the saved declaration",
      );
      await expect(evidence.locator("[data-evidence-id]")).toHaveCount(1);
      await expect(evidence).toContainText("Digest mismatch");
      await expect(evidence).toContainText(
        "Source authenticity: Unverified. No changes applied.",
      );
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Recover a committed matching source check after response loss without recording a duplicate event", async () => {
      await upload(bytes);
      await reason.fill("Compare controlled binary original export");
      let lost = true;
      const url = "**/reconciliation/jobs/*/evidence";
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
              error: "Temporary source-check response interruption",
            }),
          });
        } else await route.fulfill({ response });
      });
      await submit.click();
      await expect(evidence.getByRole("alert")).toContainText(
        "Retry the same source check",
      );
      await expect(file).toBeDisabled();
      await expect(reason).toBeDisabled();
      await submit.click();
      await expect(evidence).toContainText(
        "Source check recovered. File bytes match the saved declaration.",
      );
      await expect(file).toBeEnabled();
      await expect(file).toHaveValue("");
      await expect(evidence.locator("[data-evidence-id]")).toHaveCount(2);
      const checks = (
        await f.root.query("SELECT * FROM eoms.reconciliation_evidence_checks")
      ).rows;
      expect(checks).toHaveLength(2);
      const match = checks.find((v) => v.matches_declared);
      expect(match.computed_sha256).toBe(sha);
      expect(match.source_authenticity_verified).toBe(false);
      matchId = match.id;
      support = match.request_id;
      expect(await f.snapshot()).toEqual(before);
      await page.unroute(url);
    });
    await test.step("Reload saved source checks and inspect short and detailed audit with byte identity separate from authenticity", async () => {
      await page.reload();
      await navigate();
      await reviews
        .getByRole("button", {
          name: "Open saved review " + jobId,
          exact: true,
        })
        .click();
      await expect(evidence.locator("[data-evidence-id]")).toHaveCount(2);
      const match = evidence.locator(`[data-evidence-id="${matchId}"]`);
      await expect(match).toContainText("Digest matches declaration");
      await expect(match).toContainText(
        "Compare controlled binary original export",
      );
      await match
        .getByText("View detailed source check", { exact: true })
        .click();
      await expect(match).toContainText(support);
      await expect(match).toContainText(f.user);
      await expect(match.getByText(sha, { exact: true })).toHaveCount(2);
      await expect(match).toContainText("Source authenticity: Unverified");
      await expect(file).toHaveValue("");
      expect(
        (await f.root.query("SELECT * FROM eoms.reconciliation_jobs")).rows[0],
      ).toEqual(originalJob);
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Clear source-file inputs and recorded metadata after setup and membership revocation", async () => {
      await upload(bytes);
      await reason.fill("Private draft provenance to clear");
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, f.user],
      );
      await evidence
        .getByRole("button", { name: "Refresh source checks", exact: true })
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
        [f.customer, f.user],
      );
      await page.reload();
      await navigate();
      await reviews
        .getByRole("button", {
          name: "Open saved review " + jobId,
          exact: true,
        })
        .click();
      await expect(file).toHaveValue("");
      await expect(reason).toHaveValue("");
      await upload(bytes);
      await reason.fill("Revoked membership source check");
      await f.root.query(
        "DELETE FROM eoms.memberships WHERE estate_id=$1 AND user_id=$2",
        [f.estate, f.user],
      );
      await submit.click();
      await expect(panel).toHaveCount(0);
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.reconciliation_evidence_checks",
          )
        ).rowCount,
      ).toBe(2);
      expect(await f.snapshot()).toEqual(before);
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});
