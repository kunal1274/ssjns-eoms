import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { independentSourceReviewer } from "../source-review-fixture";
test("E2E-JRN-06-010 @regression explicitly appoint external policy recorder and retain acceptance withdrawal and revoked authority history", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  let primaryFailure: unknown = null;
  let stage = "initialization";
  try {
    const peer = await independentSourceReviewer(f),
      baseline = await f.snapshot();
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url()),
        r = await route.fetch({
          url: f.apiURL + u.pathname + u.search,
          headers: await route.request().allHeaders(),
        });
      await route.fulfill({ response: r });
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
    const panel = page.getByRole("region", {
        name: "Mapping policy design review",
        exact: true,
      }),
      gov = panel.getByRole("region", {
        name: "Policy authority and external decisions",
        exact: true,
      }),
      appointments = gov.getByRole("region", {
        name: "Policy recording appointments",
        exact: true,
      }),
      external = gov.getByRole("region", {
        name: "External policy decision",
        exact: true,
      }),
      appoint = gov.getByRole("button", {
        name: "Record policy appointment",
        exact: true,
      }),
      record = gov.getByRole("button", {
        name: "Record external policy decision",
        exact: true,
      }),
      refresh = gov.getByRole("button", {
        name: "Refresh policy governance",
        exact: true,
      });
    async function fields(outcome: string, why: string) {
      await external
        .getByLabel("External policy outcome", { exact: true })
        .selectOption(outcome);
      await external
        .getByLabel("External policy decision reference", { exact: true })
        .fill("Synthetic signed-" + "archive".repeat(25));
      await external
        .getByLabel("External policy decision reason", { exact: true })
        .fill(why);
      await expect(record).toBeDisabled();
      await external
        .getByLabel(
          "I checked my appointment and the referenced external policy decision",
          { exact: true },
        )
        .check();
    }
    async function dropResponse(pattern: string) {
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
              error: "Temporary policy governance response interruption",
            }),
          });
          expect(r.status()).toBe(200);
        } else await route.fallback();
      });
    }
    await identity(f.raw);
    await test.step("Create exact policy criteria and appoint a separate scoped recorder with lost-response receipt recovery", async () => {
      for (const label of [
        "Proposed custody criteria",
        "Proposed independent approver criteria",
        "Proposed evidence and concern resolution criteria",
      ])
        await panel
          .getByLabel(label, { exact: true })
          .fill("Explicit synthetic controlled criterion for " + label);
      await panel
        .getByLabel("Policy proposal reason", { exact: true })
        .fill("Prepare external policy decision journey");
      stage = "policy-save";
      const policySaved = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith("/reconciliation/policies") &&
          r.request().method() === "POST",
      );
      await panel
        .getByRole("button", { name: "Save policy proposal", exact: true })
        .click();
      expect((await policySaved).status()).toBe(200);
      await expect(external).toContainText("No recorded external decision");
      await expect(record).toBeDisabled();
      const self = appointments.getByRole("button", {
        name: new RegExp("Select policy recorder .*" + f.user + "$"),
      });
      await expect(self).toBeDisabled();
      stage = "candidate-selection";
      const candidateSelected = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith(
            "/reconciliation/policy-authority",
          ) &&
          new URL(r.url()).searchParams.get("subjectId") === peer.id &&
          r.request().method() === "GET",
      );
      await appointments
        .getByRole("button", {
          name:
            "Select policy recorder Independent synthetic source reviewer " +
            peer.id,
          exact: true,
        })
        .click();
      expect((await candidateSelected).status()).toBe(200);
      await expect(
        appointments.locator("[data-policy-authority-state]"),
      ).toContainText(peer.id);
      await gov
        .getByLabel("Policy authority reference", { exact: true })
        .fill("Synthetic owner delegated recording appointment");
      await gov
        .getByLabel("Policy authority reason", { exact: true })
        .fill("Explicitly appoint separate recorder for this estate");
      await dropResponse("**/reconciliation/policy-authority");
      stage = "appointment-lost-response";
      const interrupted = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith(
            "/reconciliation/policy-authority",
          ) && r.request().method() === "POST",
      );
      await appoint.click();
      expect((await interrupted).status()).toBe(503);
      await expect(gov.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        gov.getByLabel("Policy authority reference", { exact: true }),
      ).toBeDisabled();
      await expect(
        panel.getByRole("button", {
          name: "Inspect policy version 1",
          exact: true,
        }),
      ).toBeDisabled();
      stage = "appointment-retry";
      const recovered = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith(
            "/reconciliation/policy-authority",
          ) && r.request().method() === "POST",
      );
      await appoint.click();
      const recovery = await recovered;
      expect(recovery.status()).toBe(200);
      expect((await recovery.json()).replayed).toBe(true);
      stage = "appointment-current-state";
      await expect(gov).toContainText(
        "Recovered existing receipt. Policy recording appointment revision 1",
      );
      await expect(
        appointments.locator("[data-policy-authority-state]"),
      ).toContainText("Appointment current");
      expect(
        (await f.root.query("SELECT * FROM eoms.mapping_policy_authority"))
          .rowCount,
      ).toBe(1);
    });
    await test.step("Record referenced external acceptance under an explicit appointment and recover one immutable decision", async () => {
      await identity(peer.raw);
      await panel
        .getByRole("button", { name: "Inspect policy version 1", exact: true })
        .click();
      await expect(external).toContainText("Your appointment: Current");
      await appointments
        .getByRole("button", {
          name: new RegExp("Select policy recorder .*" + f.user + "$"),
        })
        .click();
      await gov
        .getByLabel("Policy authority reference", { exact: true })
        .fill("Unrelated appointment reference draft");
      await gov
        .getByLabel("Policy authority reason", { exact: true })
        .fill(
          "Preserve this separate appointment draft while recording a decision",
        );
      await expect(record).toBeDisabled();
      await fields(
        "accepted-externally",
        "Recorder examined exact synthetic external owner policy decision",
      );
      await dropResponse("**/reconciliation/policies/*/acceptance");
      await record.click();
      await expect(gov.getByRole("alert")).toContainText(
        "Retry unchanged submission",
      );
      await expect(
        external.getByLabel("External policy decision reference", {
          exact: true,
        }),
      ).toBeDisabled();
      await record.click();
      await expect(gov).toContainText(
        "Recovered existing receipt. External policy decision revision 1",
      );
      await expect(external).toContainText("Recorded acceptance current");
      await expect(
        gov.getByLabel("Policy authority reference", { exact: true }),
      ).toHaveValue("Unrelated appointment reference draft");
      const rows = (
        await f.root.query("SELECT * FROM eoms.mapping_policy_acceptance")
      ).rows;
      expect(rows.length).toBe(1);
      await external
        .getByText("View detailed external policy decision", { exact: true })
        .click();
      await expect(external).toContainText(rows[0].request_id);
      await expect(external).toContainText(rows[0].authority_id);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      expect(await f.snapshot()).toEqual(baseline);
    });
    await test.step("Withdraw and renew external acceptance through linked audit events while historical business facts stay unchanged", async () => {
      await fields(
        "withdrawn",
        "Synthetic owner withdrawal of recorded acceptance",
      );
      await record.click();
      await expect(gov).toContainText("External policy decision revision 2");
      await expect(external).toContainText("No current acceptance");
      await expect(external.locator("[data-policy-acceptance]")).toHaveCount(2);
      await fields(
        "accepted-externally",
        "Synthetic owner renewed decision with exact criteria",
      );
      await record.click();
      await expect(gov).toContainText("External policy decision revision 3");
      await expect(external).toContainText("Recorded acceptance current");
      const a = (
        await f.root.query(
          "SELECT * FROM eoms.mapping_policy_acceptance ORDER BY revision",
        )
      ).rows;
      expect(a[1].previous_id).toBe(a[0].id);
      expect(a[2].previous_id).toBe(a[1].id);
      await expect(external).toContainText(
        "Mapping approval and application disabled",
      );
      expect(await f.snapshot()).toEqual(baseline);
    });
    await test.step("Revoke and reappoint without reviving earlier acceptance then recover read failure and clear denied private records", async () => {
      await identity(f.raw);
      await panel
        .getByRole("button", { name: "Inspect policy version 1", exact: true })
        .click();
      await appointments
        .getByRole("button", {
          name:
            "Select policy recorder Independent synthetic source reviewer " +
            peer.id,
          exact: true,
        })
        .click();
      await gov
        .getByLabel("Policy appointment action", { exact: true })
        .selectOption("revoked");
      await gov
        .getByLabel("Policy authority reference", { exact: true })
        .fill("Synthetic owner revocation");
      await gov
        .getByLabel("Policy authority reason", { exact: true })
        .fill("Withdraw recorder delegation independently of history");
      await appoint.click();
      await expect(gov).toContainText(
        "Policy recording appointment revision 2",
      );
      await expect(external).toContainText("No current acceptance");
      await gov
        .getByLabel("Policy appointment action", { exact: true })
        .selectOption("appointed");
      await gov
        .getByLabel("Policy authority reference", { exact: true })
        .fill("Synthetic owner new appointment");
      await gov
        .getByLabel("Policy authority reason", { exact: true })
        .fill("New appointment requires a new exact decision");
      await appoint.click();
      await expect(gov).toContainText(
        "Policy recording appointment revision 3",
      );
      await expect(external).toContainText("No current acceptance");
      let fail = true;
      await page.route(
        "**/reconciliation/policy-authority/candidates?*",
        async (route) => {
          if (fail) {
            fail = false;
            await route.fulfill({
              status: 503,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                error: "Temporary authority read interruption",
              }),
            });
          } else await route.fallback();
        },
      );
      await refresh.click();
      await expect(gov.getByRole("alert")).toBeVisible();
      await expect(external).toHaveCount(0);
      await refresh.click();
      await expect(external).toContainText("No current acceptance");
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1 AND user_id=$2",
        [f.customer, f.user],
      );
      await refresh.click();
      await expect(gov).toHaveCount(0);
      await expect(page.locator("[data-policy-acceptance]")).toHaveCount(0);
      expect(await f.snapshot()).toEqual(baseline);
    });
  } catch (e) {
    primaryFailure = e;
    console.log("Policy acceptance journey failure stage: " + stage);
    throw e;
  } finally {
    try {
      if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" });
    } catch (e) {
      if (!primaryFailure && !page.isClosed()) throw e;
    } finally {
      await f.close();
    }
  }
});
