import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import {
  freshSyntheticSession,
  independentSourceReviewer,
} from "../source-review-fixture";
import { accountBrowser, closeAccountBrowser } from "./account-browser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("E2E-JRN-03-007 @regression an explicitly appointed security operator revokes a named account with exact recovery", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture();
  let primaryFailure: unknown = null;
  try {
    const peer = await independentSourceReviewer(f);
    await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/authorize-security-operator.ts",
        f.user,
        "granted",
        "Synthetic browser security authority",
        "Explicit named global revocation appointment",
      ],
      {
        env: {
          ...process.env,
          ADMIN_DATABASE_URL: f.root.options.connectionString,
        },
      },
    );
    await accountBrowser(page, context, f);
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account security", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Security operator revocation",
      exact: true,
    });
    await test.step("Preview a named account under an explicit global revocation mandate", async () => {
      await panel
        .getByLabel("Named account UUID", { exact: true })
        .fill(peer.id);
      await panel
        .getByRole("button", { name: "Preview named account", exact: true })
        .click();
      await expect(
        panel.getByText("Independent synthetic source reviewer", {
          exact: false,
        }),
      ).toBeVisible();
    });
    await test.step("Recover the same administrative revocation without terminating a later fresh session", async () => {
      let lose = true;
      await page.route("**/api/auth/admin/revoke", async (route) => {
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
        .getByLabel("Revocation reference", { exact: true })
        .fill("Synthetic browser incident");
      await panel
        .getByLabel("Revocation reason", { exact: true })
        .fill("Controlled operator ends the exact named user sessions");
      await panel
        .getByRole("button", {
          name: "Revoke all sessions for this account",
          exact: true,
        })
        .click();
      await expect(
        panel.getByRole("button", {
          name: "Retry same operator revocation",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Organization", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", {
          name: "Sign out other sessions",
          exact: true,
        }),
      ).toBeDisabled();
      expect(
        (
          await fetch(f.apiURL + "/api/auth/session", {
            headers: { Cookie: "eoms_session=" + peer.raw },
          })
        ).status,
      ).toBe(401);
      const fresh = await freshSyntheticSession(f, peer.id);
      await panel
        .getByRole("button", {
          name: "Retry same operator revocation",
          exact: true,
        })
        .click();
      await expect(panel.getByRole("status")).toContainText("Audit event");
      await expect(
        page.getByRole("button", { name: "Organization", exact: true }),
      ).toBeEnabled();
      expect(
        (
          await fetch(f.apiURL + "/api/auth/session", {
            headers: { Cookie: "eoms_session=" + fresh },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.root.query(
            "SELECT id FROM eoms.security_events WHERE subject_id=$1 AND actor_id=$2 AND action='admin.sessions-revoked'",
            [peer.id, f.user],
          )
        ).rowCount,
      ).toBe(1);
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    await closeAccountBrowser(page, f, primaryFailure);
  }
});
