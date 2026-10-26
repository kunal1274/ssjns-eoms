import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { freshSyntheticSession } from "../source-review-fixture";
import { hash } from "../../apps/api/src/security";
import { accountBrowser } from "./account-browser";
test("E2E-JRN-03-003 @regression review and revoke sessions with lost-response recovery and actual security history", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture();
  try {
    const other = await freshSyntheticSession(f, f.user),
      sid = (
        await f.root.query("SELECT id FROM eoms.sessions WHERE token_hash=$1", [
          hash(other),
        ])
      ).rows[0].id;
    await accountBrowser(page, context, f);
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    const panel = page.getByRole("region", {
      name: "Account security controls",
    });
    await test.step("Open own account security and identify current and other sessions", async () => {
      await page
        .getByRole("button", { name: "Account security", exact: true })
        .click();
      await expect(
        panel.getByRole("heading", { name: "Your account security" }),
      ).toBeVisible();
      await expect(
        panel.getByText("This session", { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", {
          name: "Revoke session " + sid,
          exact: true,
        }),
      ).toBeVisible();
    });
    await test.step("Recover a committed revocation after losing its response without replaying new effects", async () => {
      let lose = true;
      await page.route("**/api/auth/sessions/revoke", async (route) => {
        if (lose) {
          lose = false;
          const u = new URL(route.request().url()),
            r = await route.fetch({
              url: f.apiURL + u.pathname,
              headers: await route.request().allHeaders(),
            });
          expect(r.status()).toBe(200);
          await route.abort("failed");
        } else await route.fallback();
      });
      await panel
        .getByRole("button", { name: "Revoke session " + sid, exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: "Retry same session revocation" }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Organization", exact: true }),
      ).toBeDisabled();
      const denied = await fetch(f.apiURL + "/api/auth/session", {
        headers: { Cookie: "eoms_session=" + other },
      });
      expect(denied.status).toBe(401);
      await panel
        .getByRole("button", { name: "Retry same session revocation" })
        .click();
      await expect(
        panel
          .getByRole("status")
          .filter({ hasText: "Current session retained" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Organization", exact: true }),
      ).toBeEnabled();
    });
    await test.step("Inspect the real revocation audit and revoke only other sessions", async () => {
      const event = (
        await f.root.query(
          "SELECT id::text FROM eoms.security_events WHERE subject_id=$1 AND action='session.revoked'",
          [f.user],
        )
      ).rows;
      expect(event.length).toBe(1);
      await panel
        .getByRole("button", {
          name: "Details for security event " + event[0].id,
          exact: true,
        })
        .click();
      await expect(panel.getByText(f.user, { exact: true })).toBeVisible();
      await freshSyntheticSession(f, f.user);
      await panel
        .getByRole("button", { name: "Refresh account security", exact: true })
        .click();
      await expect(
        panel.getByText("Other session", { exact: true }),
      ).toBeVisible();
      await panel
        .getByRole("button", { name: "Sign out other sessions", exact: true })
        .click();
      await expect(
        panel
          .getByRole("status")
          .filter({ hasText: "Current session retained" }),
      ).toBeVisible();
      expect(
        (
          await f.root.query("SELECT id FROM eoms.sessions WHERE user_id=$1", [
            f.user,
          ])
        ).rowCount,
      ).toBe(1);
    });
    await test.step("Confirm sign out everywhere and return to the sign-in journey", async () => {
      await panel
        .getByRole("button", { name: "Review sign out everywhere" })
        .click();
      await panel
        .getByRole("button", { name: "Confirm sign out everywhere" })
        .click();
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      expect(
        (
          await f.root.query("SELECT id FROM eoms.sessions WHERE user_id=$1", [
            f.user,
          ])
        ).rowCount,
      ).toBe(0);
    });
  } finally {
    await f.close();
  }
});
