import {
  routeAccountBrowser,
  closeAccountBrowser,
  waitForAccountBootstrap,
} from "./account-browser";
import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { passwordHash, hash } from "../../apps/api/src/security";
test("E2E-JRN-03-002 @regression session expiry and suspension require a fresh sign-in", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture();
  let primaryFailure: unknown = null;
  try {
    const password = "synthetic-browser-session-password";
    await f.root.query("UPDATE eoms.users SET password_hash=$2 WHERE id=$1", [
      f.user,
      await passwordHash(password),
    ]);
    const email = (
      await f.root.query("SELECT email FROM eoms.users WHERE id=$1", [f.user])
    ).rows[0].email;
    await routeAccountBrowser(page, f);
    async function signIn() {
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      const loaded = waitForAccountBootstrap(page, f.estate);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await loaded;
      await expect(
        page.getByRole("heading", { name: "Muster register", exact: true }),
      ).toBeVisible();
    }
    await test.step("Sign in with a real isolated account and restore the authenticated screen", async () => {
      await page.goto("/");
      await signIn();
      const loaded = waitForAccountBootstrap(page, f.estate);
      await page.reload();
      await loaded;
      await expect(
        page.getByRole("heading", { name: "Muster register", exact: true }),
      ).toBeVisible();
    });
    await test.step("Expire the actual server session and recover with a fresh sign-in", async () => {
      const old = (await context.cookies()).find(
        (c) => c.name === "eoms_session",
      )!;
      await f.root.query(
        "UPDATE eoms.sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [hash(old.value)],
      );
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await signIn();
      const fresh = (await context.cookies()).find(
        (c) => c.name === "eoms_session",
      )!;
      expect(fresh.value).not.toBe(old.value);
    });
    await test.step("Suspend and restore the user without reviving the previous session", async () => {
      const old = (await context.cookies()).find(
        (c) => c.name === "eoms_session",
      )!;
      await f.root.query("UPDATE eoms.users SET active=false WHERE id=$1", [
        f.user,
      ]);
      await f.root.query("UPDATE eoms.users SET active=true WHERE id=$1", [
        f.user,
      ]);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      expect(
        (
          await f.root.query(
            "SELECT 1 FROM eoms.sessions WHERE token_hash=$1",
            [hash(old.value)],
          )
        ).rowCount,
      ).toBe(0);
      await signIn();
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    await closeAccountBrowser(page, f, primaryFailure);
  }
});
