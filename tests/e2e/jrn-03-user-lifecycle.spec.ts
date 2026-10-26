import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import {
  independentSourceReviewer,
  freshSyntheticSession,
} from "../source-review-fixture";
import { accountBrowser, closeAccountBrowser } from "./account-browser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
async function authorize(f: any) {
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/authorize-lifecycle-operator.ts",
      f.user,
      "granted",
      "Synthetic browser lifecycle mandate",
      "Explicit named account lifecycle appointment",
    ],
    {
      env: {
        ...process.env,
        ADMIN_DATABASE_URL: f.root.options.connectionString,
      },
    },
  );
}

test("E2E-JRN-03-008 @regression a lifecycle operator suspends and reactivates with exact receipt recovery and detailed history", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture();
  let primaryFailure: unknown = null;
  try {
    const peer = await independentSourceReviewer(f);
    await f.root.query(
      "DELETE FROM eoms.organization_admins WHERE user_id=$1",
      [peer.id],
    );
    await authorize(f);
    await accountBrowser(page, context, f);
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account security", exact: true })
      .click();
    const p = page.getByRole("region", {
      name: "User lifecycle administration",
      exact: true,
    });
    await test.step("Preview the account and prevent an incomplete lifecycle decision", async () => {
      await p
        .getByLabel("Lifecycle account UUID", { exact: true })
        .fill(peer.id);
      await p
        .getByRole("button", { name: "Preview lifecycle account", exact: true })
        .click();
      await expect(
        p.getByText(
          "Independent synthetic source reviewer · Current state: active · Revision 0",
          { exact: true },
        ),
      ).toBeVisible();
      await p
        .getByRole("button", { name: "Record lifecycle change", exact: true })
        .click();
      await expect(
        p.getByLabel("New account state", { exact: true }),
      ).toBeFocused();
      await p
        .getByLabel("New account state", { exact: true })
        .selectOption("suspended");
      await p
        .getByLabel("Lifecycle reference", { exact: true })
        .fill("Synthetic HR suspension");
      await p
        .getByLabel("Lifecycle reason", { exact: true })
        .fill("Reviewed retained assignments for a controlled suspension");
      await p
        .getByRole("button", { name: "Record lifecycle change", exact: true })
        .click();
      await expect(p.getByRole("checkbox")).toBeFocused();
    });
    await test.step("Recover a lost response exactly once while navigation remains locked", async () => {
      let lose = true;
      await page.route("**/api/auth/lifecycle/change", async (route) => {
        if (!lose) {
          await route.fallback();
          return;
        }
        lose = false;
        let response;
        try {
          response = await route.fetch({
            url: f.apiURL + "/api/auth/lifecycle/change",
            headers: await route.request().allHeaders(),
          });
        } catch {
          throw Error("Synthetic lifecycle transport failed");
        }
        expect(response.status()).toBe(200);
        await route.abort("failed");
      });
      await p.getByRole("checkbox").check();
      await p
        .getByRole("button", { name: "Record lifecycle change", exact: true })
        .click();
      await expect(
        p.getByRole("button", {
          name: "Retry same lifecycle decision",
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
      await p
        .getByRole("button", {
          name: "Retry same lifecycle decision",
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
          "Independent synthetic source reviewer · Current state: suspended · Revision 1",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Organization", exact: true }),
      ).toBeEnabled();
      const events = (
        await f.root.query(
          "SELECT id FROM eoms.security_events WHERE subject_id=$1 AND action='lifecycle.suspended'",
          [peer.id],
        )
      ).rows;
      expect(events).toHaveLength(1);
      await p
        .getByRole("button", {
          name: "Details for lifecycle event " + events[0].id,
          exact: true,
        })
        .click();
      await expect(
        p.getByText("Synthetic HR suspension", { exact: true }),
      ).toBeVisible();
      await expect(p.getByText(f.user, { exact: true })).toBeVisible();
    });
    await test.step("Reactivate after assignment review without reviving the old session", async () => {
      await p
        .getByLabel("New account state", { exact: true })
        .selectOption("active");
      await p
        .getByLabel("Lifecycle reference", { exact: true })
        .fill("Synthetic HR reactivation");
      await p
        .getByLabel("Lifecycle reason", { exact: true })
        .fill(
          "Confirmed retained assignments before reactivating this account",
        );
      await p.getByRole("checkbox").check();
      await p
        .getByRole("button", { name: "Record lifecycle change", exact: true })
        .click();
      await expect(
        p.getByText(
          "Independent synthetic source reviewer · Current state: active · Revision 2",
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        (
          await fetch(f.apiURL + "/api/auth/session", {
            headers: { Cookie: "eoms_session=" + peer.raw },
          })
        ).status,
      ).toBe(401);
      const fresh = await freshSyntheticSession(f, peer.id);
      expect(
        (
          await fetch(f.apiURL + "/api/auth/session", {
            headers: { Cookie: "eoms_session=" + fresh },
          })
        ).status,
      ).toBe(200);
    });
  } catch (e) {
    primaryFailure = e;
    throw e;
  } finally {
    await closeAccountBrowser(page, f, primaryFailure);
  }
});

test("E2E-JRN-03-009 @regression lifecycle administration protects setup continuity and clears stale decisions", async ({
  page,
  context,
}) => {
  const f = await upgradedWorkFixture();
  let primaryFailure: unknown = null;
  try {
    const peer = await independentSourceReviewer(f);
    await authorize(f);
    await accountBrowser(page, context, f);
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account security", exact: true })
      .click();
    const p = page.getByRole("region", {
      name: "User lifecycle administration",
      exact: true,
    });
    await test.step("Explain last administrator protection and require a separate operator for self changes", async () => {
      await p
        .getByLabel("Lifecycle account UUID", { exact: true })
        .fill(peer.id);
      await p
        .getByRole("button", { name: "Preview lifecycle account", exact: true })
        .click();
      await expect(
        p
          .getByRole("status")
          .filter({ hasText: "last active setup administrator" }),
      ).toBeVisible();
      await expect(
        p.getByRole("button", { name: "Record lifecycle change", exact: true }),
      ).toBeDisabled();
      await p
        .getByLabel("Lifecycle account UUID", { exact: true })
        .fill(f.user);
      await expect(
        p.getByLabel("New account state", { exact: true }),
      ).toHaveCount(0);
      await p
        .getByRole("button", { name: "Preview lifecycle account", exact: true })
        .click();
      await expect(
        p.getByText(
          "Ask a separate lifecycle operator to change your own account.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        p.getByRole("button", { name: "Record lifecycle change", exact: true }),
      ).toHaveCount(0);
    });
    await test.step("A concurrent state change rejects the stale form without another decision", async () => {
      await f.root.query(
        "DELETE FROM eoms.organization_admins WHERE user_id=$1",
        [peer.id],
      );
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
        .fill("Synthetic stale decision");
      await p
        .getByLabel("Lifecycle reason", { exact: true })
        .fill("This stale decision must be rejected after independent changes");
      await p.getByRole("checkbox").check();
      await f.root.query("UPDATE eoms.users SET active=false WHERE id=$1", [
        peer.id,
      ]);
      await p
        .getByRole("button", { name: "Record lifecycle change", exact: true })
        .click();
      await expect(p.getByRole("alert")).toContainText(
        "Preview the account again",
      );
      await expect(
        p.getByLabel("New account state", { exact: true }),
      ).toHaveCount(0);
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
    primaryFailure = e;
    throw e;
  } finally {
    await closeAccountBrowser(page, f, primaryFailure);
  }
});
