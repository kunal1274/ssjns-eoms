import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { independentSourceReviewer } from "../source-review-fixture";
import {
  accountBrowser,
  routeAccountBrowser,
  closeAccountBrowser,
  waitForAccountBootstrap,
} from "./account-browser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
async function appoint(f: any, action = "granted") {
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/authorize-lifecycle-operator.ts",
      f.user,
      action,
      "Synthetic browser lifecycle mandate",
      "Explicit named lifecycle authority for negative UI checks",
    ],
    {
      env: {
        ...process.env,
        ADMIN_DATABASE_URL: f.root.options.connectionString,
      },
    },
  );
}
async function open(page: any, context: any, f: any) {
  await accountBrowser(page, context, f);
  await expect(
    page.getByRole("heading", { name: "Muster register", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Account security", exact: true })
    .click();
}
const onboarding = (page: any) =>
  page.getByRole("region", { name: "User onboarding", exact: true });

test("E2E-JRN-03-010 @regression lifecycle read recovery retains drafts and revoked authority leaves actionable feedback", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture();
  let failure: unknown = null;
  try {
    const peer = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    await appoint(f);
    await accountBrowser(page, context, f);
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    let accessFail = true,
      previewFail = false;
    await page.route("**/api/auth/lifecycle/context*", async (route) => {
      const hasTarget = new URL(route.request().url()).searchParams.has(
        "targetId",
      );
      if ((!hasTarget && accessFail) || (hasTarget && previewFail)) {
        accessFail = false;
        previewFail = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Temporary lifecycle read failure",
            code: "SERVICE_UNAVAILABLE",
            requestId: randomUUID(),
          }),
        });
      } else await route.fallback();
    });
    await test.step("Retry a failed access check and retain the draft after a failed preview read", async () => {
      await page
        .getByRole("button", { name: "Account security", exact: true })
        .click();
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Temporary lifecycle read failure" }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Retry lifecycle access check",
          exact: true,
        })
        .click();
      const p = page.getByRole("region", {
        name: "User lifecycle administration",
        exact: true,
      });
      await p
        .getByRole("button", { name: "Preview lifecycle account", exact: true })
        .click();
      await expect(
        p.getByLabel("Lifecycle account UUID", { exact: true }),
      ).toBeFocused();
      await p
        .getByLabel("Lifecycle account UUID", { exact: true })
        .fill(peer.id);
      await p
        .getByRole("button", { name: "Preview lifecycle account", exact: true })
        .click();
      await expect(
        p.getByLabel("New account state", { exact: true }),
      ).toBeEnabled();
      await p
        .getByLabel("New account state", { exact: true })
        .selectOption("suspended");
      await p
        .getByLabel("Lifecycle reference", { exact: true })
        .fill("Synthetic UI negative ticket");
      await p
        .getByLabel("Lifecycle reason", { exact: true })
        .fill("Retain this entered reason through a temporary read failure");
      previewFail = true;
      await p
        .getByRole("button", { name: "Preview lifecycle account", exact: true })
        .click();
      await expect(p.getByRole("alert")).toContainText(
        "Temporary lifecycle read failure",
      );
      await expect(
        p.getByLabel("Lifecycle reason", { exact: true }),
      ).toHaveValue(
        "Retain this entered reason through a temporary read failure",
      );
      await p
        .getByRole("button", { name: "Preview lifecycle account", exact: true })
        .click();
      await expect(
        p.getByLabel("New account state", { exact: true }),
      ).toBeEnabled();
    });
    await test.step("A revoked operator cannot write and can still see recovery guidance", async () => {
      const p = page.getByRole("region", {
        name: "User lifecycle administration",
        exact: true,
      });
      await appoint(f, "revoked");
      await p.getByRole("checkbox").check();
      await p
        .getByRole("button", { name: "Record lifecycle change", exact: true })
        .click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Lifecycle access changed" }),
      ).toBeVisible();
      await expect(p).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Organization", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", {
          name: "Retry lifecycle access check",
          exact: true,
        })
        .click();
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Lifecycle administration is unavailable" }),
      ).toBeVisible();
      expect(
        (
          await f.root.query(
            "SELECT id FROM eoms.security_events WHERE subject_id=$1 AND action='lifecycle.suspended'",
            [peer.id],
          )
        ).rowCount,
      ).toBe(0);
    });
  } catch (e) {
    failure = e;
    throw e;
  } finally {
    await closeAccountBrowser(page, f, failure);
  }
});

test("E2E-JRN-03-011 @regression register multiple estates recover the same creation and accept a real development invitation", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  let failure: unknown = null,
    recipient: any = null,
    recipientPage: any = null;
  let secret = "",
    userId = "";
  const email = randomUUID() + "@fixture.local",
    password = "synthetic-new-employee-password";
  try {
    await open(page, context, f);
    const p = onboarding(page);
    await p
      .getByLabel("Onboarding customer", { exact: true })
      .selectOption(f.customer);
    await expect(
      p.getByRole("checkbox", { name: /Historical assigned estate/ }),
    ).toBeVisible();
    await test.step("Validate registration fields and recover a committed multi-estate creation exactly once", async () => {
      await p
        .getByRole("button", { name: "Create staged user", exact: true })
        .click();
      await expect(
        p.getByLabel("New user email", { exact: true }),
      ).toBeFocused();
      await p.getByLabel("New user email", { exact: true }).fill(email);
      await p
        .getByLabel("Full name", { exact: true })
        .fill("Browser synthetic new employee");
      await p.getByLabel("User ID", { exact: true }).fill("BROWSER-EMP-01");
      await p
        .getByLabel("Employee ID reference", { exact: true })
        .fill("Synthetic HR employee 01");
      await p
        .getByLabel("Proposed estate role", { exact: true })
        .selectOption("supervisor");
      await p
        .getByRole("checkbox", { name: /Historical assigned estate/ })
        .check();
      await p
        .getByRole("checkbox", { name: /Hidden historical sibling/ })
        .check();
      await p
        .getByLabel("Registration reference", { exact: true })
        .fill("Synthetic HR onboarding ticket");
      await p
        .getByLabel("Registration reason", { exact: true })
        .fill(
          "Two explicitly selected estates for this new synthetic employee",
        );
      let lose = true;
      await page.route("**/api/auth/onboarding/write", async (route) => {
        const body = route.request().postDataJSON();
        if (body.operation === "stage" && lose) {
          lose = false;
          let r;
          try {
            r = await route.fetch({
              url: f.apiURL + "/api/auth/onboarding/write",
              headers: await route.request().allHeaders(),
            });
          } catch {
            throw Error("Synthetic onboarding creation transport failed");
          }
          expect(r.status()).toBe(200);
          userId = (await r.json()).targetId;
          await route.abort("failed");
        } else await route.fallback();
      });
      await p
        .getByRole("button", { name: "Create staged user", exact: true })
        .click();
      await expect(
        p.getByRole("button", {
          name: "Retry same onboarding action",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Organization", exact: true }),
      ).toBeDisabled();
      await p
        .getByRole("button", {
          name: "Retry same onboarding action",
          exact: true,
        })
        .click();
      await expect(
        p
          .getByRole("status")
          .filter({ hasText: "Recovered the original receipt." }),
      ).toBeVisible();
      await expect(
        p.getByText(
          "Browser synthetic new employee · Account: staged · Customer access: pending-activation",
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.memberships WHERE user_id=$1",
            [userId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.security_events WHERE subject_id=$1 AND action='registration.stage'",
            [userId],
          )
        ).rowCount,
      ).toBe(1);
    });
    await test.step("Find the staged user by scoped email without requiring a copied UUID", async () => {
      await p
        .getByLabel("Search onboarding users", { exact: true })
        .fill(email);
      await p
        .getByRole("button", { name: "Find onboarding users", exact: true })
        .click();
      const found = p.getByRole("list", {
        name: "Scoped onboarding search results",
        exact: true,
      });
      await expect(found).toContainText("Browser synthetic new employee");
      await found
        .getByRole("button", {
          name: "Open onboarding user " + userId,
          exact: true,
        })
        .click();
      await expect(
        p.getByText(
          "Browser synthetic new employee · Account: staged · Customer access: pending-activation",
          { exact: true },
        ),
      ).toBeVisible();
    });
    await test.step("Correct staged fields and cancel outdated invitation proof before final handover", async () => {
      await p
        .getByLabel("Invitation reference", { exact: true })
        .fill("Synthetic initial correction ticket");
      await p
        .getByLabel("Invitation reason", { exact: true })
        .fill(
          "Prepare an invitation that will be replaced by a reviewed correction",
        );
      await p
        .getByRole("button", {
          name: "Prepare or reissue invitation",
          exact: true,
        })
        .click();
      const first = (
        await p
          .getByLabel("Prepared invitation link", { exact: true })
          .inputValue()
      ).split("#invite=")[1];
      await p
        .getByText("Correct the staged registration before acceptance", {
          exact: true,
        })
        .click();
      await p
        .getByLabel("Revised employee reference", { exact: true })
        .fill("Corrected synthetic HR employee 01");
      await p
        .getByLabel("Correction reference", { exact: true })
        .fill("Synthetic corrected HR reference");
      await p
        .getByLabel("Correction reason", { exact: true })
        .fill(
          "Correct this supplied employee reference and invalidate the earlier invitation",
        );
      await p
        .getByRole("checkbox", { name: /I reviewed the corrected identity/ })
        .check();
      await p
        .getByRole("button", {
          name: "Save staged registration correction",
          exact: true,
        })
        .click();
      await expect(
        p.getByRole("status").filter({ hasText: "Recorded amend." }),
      ).toBeVisible();
      const consume = (proof: string) =>
        fetch(f.apiURL + "/api/auth/enrollment/accept", {
          method: "POST",
          headers: {
            Origin: "http://localhost:5284",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: proof,
            password: "synthetic-rejected-invitation",
          }),
        });
      expect((await consume(first)).status).toBe(422);
      await p
        .getByLabel("Invitation reference", { exact: true })
        .fill("Synthetic cancellable handover");
      await p
        .getByLabel("Invitation reason", { exact: true })
        .fill(
          "Prepare an invitation that the administrator then explicitly cancels",
        );
      await p
        .getByRole("button", {
          name: "Prepare or reissue invitation",
          exact: true,
        })
        .click();
      const second = (
        await p
          .getByLabel("Prepared invitation link", { exact: true })
          .inputValue()
      ).split("#invite=")[1];
      const pending = (
        await f.root.query(
          "SELECT id FROM eoms.user_invitations WHERE user_id=$1 AND state='pending'",
          [userId],
        )
      ).rows[0].id;
      await p
        .getByLabel("Cancellation reference", { exact: true })
        .fill("Synthetic cancellation ticket");
      await p
        .getByLabel("Cancellation reason", { exact: true })
        .fill(
          "Cancel this pending invitation before handing over the final reviewed proof",
        );
      await p
        .getByRole("button", {
          name: "Cancel invitation " + pending,
          exact: true,
        })
        .click();
      await expect(
        p.getByRole("status").filter({ hasText: "Recorded cancel." }),
      ).toBeVisible();
      expect((await consume(second)).status).toBe(422);
    });
    await test.step("Prepare a secret invitation with an honest delivery status and recipient-selected password", async () => {
      await p
        .getByLabel("Invitation reference", { exact: true })
        .fill("Synthetic secure handover");
      await p
        .getByLabel("Invitation reason", { exact: true })
        .fill(
          "Prepare the selected employee invitation for controlled secure handover",
        );
      await p
        .getByRole("button", {
          name: "Prepare or reissue invitation",
          exact: true,
        })
        .click();
      await expect(
        p
          .getByRole("status")
          .filter({ hasText: "Invitation prepared, not sent." }),
      ).toBeVisible();
      const link = await p
        .getByLabel("Prepared invitation link", { exact: true })
        .inputValue();
      secret = link.split("#invite=")[1];
      expect(secret.length).toBe(64);
      recipient = await context
        .browser()!
        .newContext({ viewport: page.viewportSize()! });
      recipientPage = await recipient.newPage();
      await routeAccountBrowser(recipientPage, f);
      await recipientPage.goto(link);
      const accept = recipientPage.getByRole("region", {
        name: "Accept user invitation",
        exact: true,
      });
      await expect(
        accept.getByLabel("Invitation token", { exact: true }),
      ).toBeVisible();
      await accept
        .getByRole("button", {
          name: "Accept development invitation",
          exact: true,
        })
        .click();
      await expect(
        accept.getByLabel("Choose your development password", { exact: true }),
      ).toBeFocused();
      await accept
        .getByLabel("Choose your development password", { exact: true })
        .fill(password);
      await accept
        .getByRole("button", {
          name: "Accept development invitation",
          exact: true,
        })
        .click();
      await expect(accept.getByRole("status")).toContainText(
        "Invitation accepted",
      );
      expect(
        (
          await accept
            .getByLabel("Invitation token", { exact: true })
            .inputValue()
        ).length,
      ).toBe(0);
    });
    await test.step("Sign in freshly and inspect the employee registration and synchronized estate access", async () => {
      await recipientPage.getByLabel("Email", { exact: true }).fill(email);
      await recipientPage
        .getByLabel("Password", { exact: true })
        .fill(password);
      const ready = waitForAccountBootstrap(
        recipientPage,
        [f.estate, f.hidden].sort()[0],
      );
      await recipientPage
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await ready;
      await recipientPage
        .getByRole("button", { name: "Account security", exact: true })
        .click();
      const manifest = recipientPage.getByRole("region", {
        name: "Account and device access sync",
        exact: true,
      });
      await expect(manifest.getByRole("status")).toContainText(
        "Account active",
      );
      await expect(manifest).toContainText("BROWSER-EMP-01");
      await expect(manifest.getByRole("listitem")).toHaveCount(2);
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.organization_admins WHERE user_id=$1",
            [userId],
          )
        ).rowCount,
      ).toBe(0);
    });
  } catch (e) {
    failure = e;
    throw e;
  } finally {
    try {
      if (recipientPage)
        await closeAccountBrowser(
          recipientPage,
          { close: () => recipient.close() },
          failure,
        );
    } finally {
      await closeAccountBrowser(page, f, failure);
    }
  }
});

test("E2E-JRN-03-012 @regression a customer administrator replaces estate access then suspends and restores only that customer", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  let failure: unknown = null;
  try {
    const peer = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    await open(page, context, f);
    const p = onboarding(page);
    await p
      .getByLabel("Onboarding customer", { exact: true })
      .selectOption(f.customer);
    await p
      .getByLabel("Onboarding account UUID", { exact: true })
      .fill(peer.id);
    await p
      .getByRole("button", { name: "Preview onboarding account", exact: true })
      .click();
    await test.step("Replace the exact selected estate role after explicit review", async () => {
      await expect(
        p.getByRole("list", {
          name: "Current customer estate assignments",
          exact: true,
        }),
      ).toContainText("Historical assigned estate");
      await p
        .getByRole("checkbox", { name: /Hidden historical sibling/ })
        .check();
      await p
        .getByLabel("Replacement estate role", { exact: true })
        .selectOption("clerk");
      await p
        .getByLabel("Assignment reference", { exact: true })
        .fill("Synthetic assignment replacement");
      await p
        .getByLabel("Assignment reason", { exact: true })
        .fill(
          "Explicitly replace this customer assignment with the hidden sibling estate",
        );
      await p
        .getByRole("checkbox", {
          name: /I reviewed the replacement estate selection/,
        })
        .check();
      await p
        .getByRole("button", {
          name: "Replace customer estate assignments",
          exact: true,
        })
        .click();
      await expect(
        p.getByRole("list", {
          name: "Current customer estate assignments",
          exact: true,
        }),
      ).toContainText("Hidden historical sibling");
      const rows = (
        await f.root.query(
          "SELECT estate_id,role FROM eoms.memberships WHERE user_id=$1",
          [peer.id],
        )
      ).rows;
      expect(rows).toEqual([{ estate_id: f.hidden, role: "clerk" }]);
    });
    await test.step("Suspend and reactivate customer access while preserving the global account and the live session", async () => {
      await p
        .getByLabel("New customer access state", { exact: true })
        .selectOption("suspended");
      await p
        .getByLabel("Customer access reference", { exact: true })
        .fill("Synthetic customer suspension");
      await p
        .getByLabel("Customer access reason", { exact: true })
        .fill(
          "Suspend this customer assignment without changing the global account",
        );
      await p
        .getByRole("button", {
          name: "Record customer access change",
          exact: true,
        })
        .click();
      await expect(
        p.getByText(
          "Independent synthetic source reviewer · Account: active · Customer access: suspended",
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        (
          await fetch(f.apiURL + "/api/auth/session", {
            headers: { Cookie: "eoms_session=" + peer.raw },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(f.apiURL + "/api/estates/" + f.hidden + "/musters", {
            headers: { Cookie: "eoms_session=" + peer.raw },
          })
        ).status,
      ).toBe(403);
      await p
        .getByLabel("New customer access state", { exact: true })
        .selectOption("active");
      await p
        .getByLabel("Customer access reference", { exact: true })
        .fill("Synthetic reviewed restoration");
      await p
        .getByLabel("Customer access reason", { exact: true })
        .fill("Restore the retained customer assignment after explicit review");
      await p
        .getByRole("button", {
          name: "Record customer access change",
          exact: true,
        })
        .click();
      await expect(
        p.getByText(
          "Independent synthetic source reviewer · Account: active · Customer access: active",
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        (
          await fetch(f.apiURL + "/api/estates/" + f.hidden + "/musters", {
            headers: { Cookie: "eoms_session=" + peer.raw },
          })
        ).status,
      ).toBe(200);
      const e = (
        await f.root.query(
          "SELECT id FROM eoms.security_events WHERE subject_id=$1 AND action='registration.access' ORDER BY id DESC LIMIT 1",
          [peer.id],
        )
      ).rows[0];
      await p
        .getByRole("button", {
          name: "Details for registration event " + e.id,
          exact: true,
        })
        .click();
      await expect(
        p.getByText("Synthetic reviewed restoration", { exact: true }),
      ).toBeVisible();
    });
  } catch (e) {
    failure = e;
    throw e;
  } finally {
    await closeAccountBrowser(page, f, failure);
  }
});
