import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { controlledIssuer } from "../oidc-issuer-fixture";
import { accountBrowser } from "./account-browser";
test("E2E-JRN-03-005 @regression organization sign-in requires MFA and an explicitly linked account", async ({
  page,
  context,
}) => {
  const idp = await controlledIssuer(),
    f = await upgradedWorkFixture({ appOptions: { oidc: idp.config } });
  try {
    await f.root.query(
      "INSERT INTO eoms.identity_links(issuer,subject,user_id,reference,reason) VALUES($1,'fixture-subject',$2,'Synthetic browser mapping','Explicit controlled identity association')",
      [idp.config.issuer, f.user],
    );
    await accountBrowser(page, context, f, false);
    await test.step("Recover safely from an identity response without required MFA", async () => {
      idp.setMode("no-mfa");
      await page
        .getByRole("button", {
          name: "Sign in with your organization",
          exact: true,
        })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "Organization sign-in could not be completed",
      );
      expect(
        (
          await f.root.query(
            "SELECT id FROM eoms.sessions WHERE auth_method='oidc'",
          )
        ).rowCount,
      ).toBe(0);
    });
    await test.step("Complete controlled MFA sign-in and open provider-managed account security", async () => {
      idp.setMode("valid");
      await page
        .getByRole("button", {
          name: "Sign in with your organization",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("heading", { name: "Muster register", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Account security", exact: true })
        .click();
      const panel = page.getByRole("region", {
        name: "Account security controls",
      });
      await expect(
        panel.getByText("MFA verified", { exact: false }),
      ).toBeVisible();
      await expect(
        panel.getByRole("link", {
          name: "Manage password and MFA with your organization",
        }),
      ).toHaveAttribute("href", idp.config.securityUrl);
      await expect(
        panel.getByLabel("Current password", { exact: true }),
      ).toHaveCount(0);
    });
  } finally {
    await f.close();
    await idp.close();
  }
});
