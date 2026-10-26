import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { accountBrowser, closeAccountBrowser } from "./account-browser";
import { passwordHash } from "../../apps/api/src/security";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("E2E-JRN-03-004 @regression recover a development credential and change it through a fresh session", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture();
  let primaryFailure: unknown = null;
  try {
    await f.root.query("UPDATE eoms.users SET password_hash=$2 WHERE id=$1", [
      f.user,
      await passwordHash("synthetic-original-password"),
    ]);
    const email = (
      await f.root.query("SELECT email FROM eoms.users WHERE id=$1", [f.user])
    ).rows[0].email;
    await accountBrowser(page, context, f, false);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    const help = page.getByRole("region", { name: "Sign-in help" });
    await test.step("Request non-enumerating recovery guidance with accessible field validation", async () => {
      await help
        .getByRole("button", { name: "Recover access", exact: true })
        .click();
      await help
        .getByRole("button", { name: "Request recovery guidance" })
        .click();
      await expect(
        help.getByLabel("Recovery email", { exact: true }),
      ).toBeFocused();
      await help.getByLabel("Recovery email", { exact: true }).fill(email);
      await help
        .getByRole("button", { name: "Request recovery guidance" })
        .click();
      await expect(help.getByRole("status")).toContainText(
        "No password has been changed",
      );
    });
    await test.step("Reject an invalid token then consume an operator-issued token and sign in", async () => {
      await help
        .getByLabel("Recovery token", { exact: true })
        .fill("a".repeat(64));
      await help
        .getByLabel("Replacement password", { exact: true })
        .fill("synthetic-recovered-password");
      await help
        .getByRole("button", { name: "Reset development password" })
        .click();
      await expect(help.getByRole("alert")).toContainText(
        "unavailable or expired",
      );
      const issued = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/issue-recovery.ts",
          f.user,
          "Synthetic browser support ticket",
          "Controlled operator declared identity verification",
        ],
        {
          env: {
            ...process.env,
            ADMIN_DATABASE_URL: f.root.options.connectionString,
            NODE_ENV: "test",
          },
        },
      );
      await help
        .getByLabel("Recovery token", { exact: true })
        .fill(JSON.parse(issued.stdout).token);
      await help
        .getByRole("button", { name: "Reset development password" })
        .click();
      await expect(help.getByRole("status")).toContainText("Password changed");
      await expect(
        help.getByLabel("Recovery token", { exact: true }),
      ).toHaveValue("");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page
        .getByLabel("Password", { exact: true })
        .fill("synthetic-recovered-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Muster register", exact: true }),
      ).toBeVisible();
    });
    await test.step("Verify the current password before changing it and ending all sessions", async () => {
      await page
        .getByRole("button", { name: "Account security", exact: true })
        .click();
      const panel = page.getByRole("region", {
        name: "Account security controls",
      });
      await expect(
        panel.getByLabel("Current password", { exact: true }),
      ).toBeEnabled();
      await panel.getByLabel("Current password", { exact: true }).fill("wrong");
      await panel
        .getByLabel("New password", { exact: true })
        .fill("synthetic-final-password");
      await panel
        .getByRole("button", { name: "Change password and end sessions" })
        .click();
      await expect(panel.getByRole("alert")).toContainText(
        "could not be verified",
      );
      await panel
        .getByLabel("Current password", { exact: true })
        .fill("synthetic-recovered-password");
      await panel
        .getByRole("button", { name: "Change password and end sessions" })
        .click();
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toContainText("Password changed");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page
        .getByLabel("Password", { exact: true })
        .fill("synthetic-final-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Muster register", exact: true }),
      ).toBeVisible();
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    await closeAccountBrowser(page, f, primaryFailure);
  }
});
