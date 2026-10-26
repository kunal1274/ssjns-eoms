import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { accountBrowser } from "./account-browser";
test("E2E-JRN-03-006 @regression an unassigned account receives guidance and can manage its own security", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture();
  try {
    await f.root.query("DELETE FROM eoms.memberships WHERE user_id=$1", [
      f.user,
    ]);
    await accountBrowser(page, context, f);
    await test.step("Guide a user without estate access to account security without granting work scope", async () => {
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "No estate is selected or assigned" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Account security", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Your account security" }),
      ).toBeVisible();
      await expect(
        page.getByText("This session", { exact: true }),
      ).toBeVisible();
      const denied = await page.request.get(
        "/api/estates/" + f.estate + "/musters",
      );
      expect(denied.status()).toBe(403);
    });
  } finally {
    await f.close();
  }
});
