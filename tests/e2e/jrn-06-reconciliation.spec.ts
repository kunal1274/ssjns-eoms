import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { randomUUID } from "node:crypto";
test("E2E-JRN-06-004 @regression upload and preview source mappings without applying or approving historical changes", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const division = (
      await f.root.query(
        "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) VALUES($1,$2,'division','MAP-D','Mapping division') RETURNING id",
        [f.customer, f.estate],
      )
    ).rows[0].id;
    const block = (
      await f.root.query(
        "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name,parent_id) VALUES($1,$2,'block','OLD-BLOCK','Reviewed source block',$3) RETURNING id",
        [f.customer, f.estate, division],
      )
    ).rows[0].id;
    const before = await f.snapshot(),
      manifest = {
        version: 1,
        source: {
          system: "Legacy export",
          documentRef: "Private source review document A",
          sha256: "a".repeat(64),
        },
        rows: [
          {
            sourceRow: "Sheet1:2",
            kind: "task-block",
            recordId: f.task,
            recordVersion: 1,
            targetId: block,
            reason: "Review block mapping against original source",
          },
          {
            sourceRow: "Sheet1:3",
            kind: "work-company",
            recordId: f.target,
            recordVersion: 1,
            targetId: f.company,
            reason: "Reconcile missing attribution against original evidence",
          },
          {
            sourceRow: "Sheet1:4",
            kind: "task-block",
            recordId: randomUUID(),
            recordVersion: 1,
            targetId: block,
            reason: "Unresolved source identity requires review",
          },
        ],
      };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
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
      .getByRole("button", { name: "Open source mapping preview", exact: true })
      .click();
    const panel = page.getByRole("region", {
        name: "Source mapping preview",
        exact: true,
      }),
      form = panel.getByRole("form", {
        name: "Mapping manifest preview",
        exact: true,
      }),
      file = form.getByLabel("Mapping manifest file", { exact: true }),
      draft = form.getByLabel("Mapping manifest JSON", { exact: true }),
      submit = form.getByRole("button", {
        name: "Preview source mappings",
        exact: true,
      }),
      result = panel.getByRole("region", {
        name: "Reconciliation preview results",
        exact: true,
      });
    let firstDigest = "";
    async function upload(value: any) {
      await file.setInputFiles({
        name: "source-mappings.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(value)),
      });
      await expect(draft).toHaveValue(JSON.stringify(value));
    }
    async function preview() {
      const response = page.waitForResponse((r) =>
        r.url().endsWith("/reconciliation/preview"),
      );
      await submit.click();
      const r = await response;
      expect(r.status()).toBe(200);
      return r.json();
    }
    await test.step("Validate uploaded manifest size and JSON and retain the proposal through a temporary preview failure", async () => {
      await expect(file).toBeEnabled();
      await file.setInputFiles({
        name: "large.json",
        mimeType: "application/json",
        buffer: Buffer.alloc(60001, 32),
      });
      await expect(panel.getByRole("alert")).toContainText("60 KB");
      await expect(submit).toBeDisabled();
      await file.setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from("{"),
      });
      await expect(draft).toHaveValue("{");
      await submit.click();
      await expect(panel.getByRole("alert")).toContainText("not valid JSON");
      await upload(manifest);
      await page.route(
        `**/api/estates/${f.estate}/reconciliation/preview`,
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "private mapping preview failure",
              requestId: "11111111-4000-4000-8000-000000000006",
            }),
          }),
        { times: 1 },
      );
      await submit.click();
      await expect(panel.getByRole("alert")).toContainText(
        "11111111-4000-4000-8000-000000000006",
      );
      await expect(panel).not.toContainText("private mapping preview failure");
      await expect(draft).toHaveValue(JSON.stringify(manifest));
      await expect(result).toHaveCount(0);
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Inspect actual blocked and review-required rows with unverified source and computed manifest provenance", async () => {
      const v = await preview();
      expect(v.applied).toBe(false);
      expect(v.sourceEvidenceVerified).toBe(false);
      expect(v.summary).toEqual({ total: 3, blocked: 1, reviewRequired: 2 });
      firstDigest = v.manifestSha256;
      expect(firstDigest).toMatch(/^[a-f0-9]{64}$/);
      await expect(result).toContainText(
        "3 rows · 1 blocked · 2 require review. No changes applied.",
      );
      await expect(result.locator("[data-mapping-row]")).toHaveCount(3);
      await result
        .getByText("View preview provenance", { exact: true })
        .click();
      await expect(result).toContainText(
        "Declared source SHA-256 — not verified",
      );
      await expect(result).toContainText(firstDigest);
      await expect(result).toContainText(f.user);
      await expect(result).toContainText(v.requestId);
      const work = result.locator('[data-mapping-row="1"]');
      await expect(work).toContainText(
        "Historical attribution remains unchanged",
      );
      await work.getByText("View mapping details", { exact: true }).click();
      await expect(work).toContainText(f.target);
      await expect(work).toContainText("2026-01-15");
      await expect(work).toContainText(
        "Reconcile missing attribution against original evidence",
      );
      await expect(
        panel.getByRole("button", { name: /apply|approve|import/i }),
      ).toHaveCount(0);
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Invalidate old results after proposal edits and block duplicate source rows and stale versions on revalidation", async () => {
      const edited = structuredClone(manifest);
      edited.rows[1].recordVersion = 99;
      edited.rows[2].sourceRow = edited.rows[0].sourceRow;
      await draft.fill(JSON.stringify(edited));
      await expect(result).toHaveCount(0);
      const v = await preview();
      expect(v.summary).toEqual({ total: 3, blocked: 3, reviewRequired: 0 });
      expect(v.manifestSha256).not.toBe(firstDigest);
      await expect(result).toContainText("recorded version has changed");
      await expect(
        result.getByText(
          "This source-row reference occurs more than once. Reconcile every duplicate before review.",
          { exact: true },
        ),
      ).toHaveCount(2);
      expect(await f.snapshot()).toEqual(before);
    });
    await test.step("Clear source proposals after setup authority loss and reject revoked membership even after access was restored", async () => {
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, f.user],
      );
      await panel
        .getByRole("button", { name: "Refresh mapping access", exact: true })
        .click();
      await expect(panel).toContainText("Read-only access");
      await expect(draft).toHaveValue("");
      await expect(draft).toBeDisabled();
      await expect(file).toHaveValue("");
      await expect(result).toHaveCount(0);
      await expect(panel).not.toContainText(manifest.source.documentRef);
      await f.root.query(
        "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
        [f.customer, f.user],
      );
      await panel
        .getByRole("button", { name: "Refresh mapping access", exact: true })
        .click();
      await expect(file).toBeEnabled();
      await upload(manifest);
      await preview();
      await f.root.query(
        "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
        [f.user, f.estate],
      );
      await submit.click();
      await expect(panel).toHaveCount(0);
      const legacy = page.getByRole("region", {
        name: "Legacy attribution review",
        exact: true,
      });
      await expect(legacy).toContainText(
        "Cached records and private review inputs were cleared",
      );
      await expect(legacy.locator("[data-legacy-id]")).toHaveCount(0);
      await expect(legacy).not.toContainText(manifest.source.documentRef);
      await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
        f.estate,
      );
      expect(await f.snapshot()).toEqual(before);
      expect(
        (
          await f.root.query(
            "SELECT block_unit_id,version FROM eoms.occurrences WHERE id=$1",
            [f.task],
          )
        ).rows[0],
      ).toEqual({ block_unit_id: null, version: 1 });
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});
