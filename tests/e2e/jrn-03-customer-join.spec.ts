import { test, expect } from "./fixtures";
import { customerJoinFixture } from "../customer-join-fixture";
import {
  accountBrowser,
  closeAccountBrowser,
  waitForAccountBootstrap,
} from "./account-browser";

test("E2E-JRN-03-015 @regression an existing person reviews and accepts a new customer without losing other access", async ({
  page,
  context,
}) => {
  const f = await customerJoinFixture();
  let recipient: any = null,
    recipientPage: any = null,
    failure: unknown = null;
  try {
    await accountBrowser(page, context, f);
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account security", exact: true })
      .click();
    const admin = page.getByRole("region", {
      name: "Existing account invitations",
      exact: true,
    });
    await admin
      .getByLabel("Existing-account invitation customer", { exact: true })
      .selectOption(f.customer);
    await test.step("Prepare an explicit multi-estate proposal without a global directory or grants", async () => {
      await admin
        .getByRole("checkbox", { name: /Historical assigned estate/ })
        .check();
      await admin
        .getByRole("checkbox", { name: /Hidden historical sibling/ })
        .check();
      await admin
        .getByRole("button", {
          name: "Prepare existing-account invitation",
          exact: true,
        })
        .click();
      await expect(
        admin.getByLabel("Existing recipient account UUID", { exact: true }),
      ).toBeFocused();
      await admin
        .getByLabel("Existing recipient account UUID", { exact: true })
        .fill(f.peer.id);
      await admin
        .getByLabel("Customer user ID", { exact: true })
        .fill("EXISTING-EMP-UI");
      await admin
        .getByLabel("Customer employee reference", { exact: true })
        .fill("Supplied second customer employee reference");
      await admin
        .getByLabel("Invited estate role", { exact: true })
        .selectOption("supervisor");
      await admin
        .getByLabel("Existing-account invitation reference", { exact: true })
        .fill("Synthetic reviewed existing identity invitation");
      await admin
        .getByLabel("Existing-account invitation reason", { exact: true })
        .fill(
          "Propose two customer estates while retaining the existing global account",
        );
      const form = admin
        .getByLabel("Existing recipient account UUID", { exact: true })
        .locator("..")
        .locator("..");
      await form
        .getByRole("checkbox", { name: /I reviewed the customer/ })
        .check();
      await form
        .getByRole("button", {
          name: "Prepare existing-account invitation",
          exact: true,
        })
        .click();
      await expect(
        admin.getByRole("status").filter({ hasText: "Invitation pending." }),
      ).toBeVisible();
      await expect(
        admin.getByLabel("Administrative customer invitation list", {
          exact: true,
        }),
      ).toContainText(f.peer.id);
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.memberships WHERE user_id=$1 AND estate_id IN($2,$3)",
            [f.peer.id, f.estate, f.hidden],
          )
        ).rowCount,
      ).toBe(0);
    });
    recipient = await context
      .browser()!
      .newContext({ viewport: page.viewportSize()! });
    recipientPage = await recipient.newPage();
    await accountBrowser(recipientPage, recipient, { ...f, raw: f.peer.raw });
    await expect(
      recipientPage.getByRole("heading", {
        name: "Muster register",
        exact: true,
      }),
    ).toBeVisible();
    await recipientPage
      .getByRole("button", { name: "Account security", exact: true })
      .click();
    const own = recipientPage.getByRole("region", {
      name: "Existing account invitations",
      exact: true,
    });
    await test.step("The signed-in recipient reviews roles and recovers the same consent after a lost response", async () => {
      const inbox = own.getByLabel("My customer invitation list", {
        exact: true,
      });
      await expect(inbox).toContainText(
        "Historical assigned estate: supervisor",
      );
      await expect(inbox).toContainText(
        "Hidden historical sibling: supervisor",
      );
      await inbox
        .getByLabel("Customer invitation decision", { exact: true })
        .selectOption("accept");
      await inbox
        .getByLabel("Consent reference", { exact: true })
        .fill("Recipient reviewed customer access request");
      await inbox
        .getByLabel("Consent reason", { exact: true })
        .fill(
          "I consent to these two reviewed estates while keeping my existing customer",
        );
      await inbox
        .getByRole("checkbox", { name: /I reviewed the customer/ })
        .check();
      let lose = true;
      await recipientPage.route(
        "**/api/auth/customer-invitations",
        async (route: any) => {
          if (
            route.request().method() === "POST" &&
            route.request().postDataJSON().operation === "accept" &&
            lose
          ) {
            lose = false;
            let r;
            try {
              r = await route.fetch({
                url: f.apiURL + "/api/auth/customer-invitations",
                headers: await route.request().allHeaders(),
              });
            } catch {
              throw Error("Synthetic customer consent transport failed");
            }
            expect(r.status()).toBe(200);
            await route.abort("failed");
          } else await route.fallback();
        },
      );
      await inbox
        .getByRole("button", {
          name: "Record my customer invitation decision",
          exact: true,
        })
        .click();
      await expect(
        own.getByRole("button", {
          name: "Retry same customer invitation decision",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        recipientPage.getByRole("button", {
          name: "Organization",
          exact: true,
        }),
      ).toBeDisabled();
      await own
        .getByRole("button", {
          name: "Retry same customer invitation decision",
          exact: true,
        })
        .click();
      await expect(
        own
          .getByRole("status")
          .filter({ hasText: "Recovered the original receipt." }),
      ).toBeVisible();
      await expect(
        inbox.getByRole("heading", { name: /accepted/ }),
      ).toBeVisible();
      const events = (
        await f.root.query(
          "SELECT id,actor_id FROM eoms.security_events WHERE subject_id=$1 AND action='registration.join-accept'",
          [f.peer.id],
        )
      ).rows;
      expect(events).toHaveLength(1);
      expect(events[0].actor_id).toBe(f.peer.id);
      await inbox
        .getByRole("button", {
          name: "Details for customer invitation event " + events[0].id,
          exact: true,
        })
        .click();
      await expect(
        inbox.getByText("Recipient reviewed customer access request", {
          exact: true,
        }),
      ).toBeVisible();
    });
    await test.step("Refresh actual access and select a new estate while the original customer stays available", async () => {
      const manifest = recipientPage.getByRole("region", {
        name: "Account and device access sync",
        exact: true,
      });
      await manifest
        .getByRole("button", {
          name: "Refresh device access status",
          exact: true,
        })
        .click();
      await expect(manifest).toContainText("EXISTING-EMP-UI");
      await expect(manifest.getByRole("listitem")).toHaveCount(3);
      expect(
        (
          await f.call(
            undefined,
            f.peer.raw,
            "/api/estates/" + f.otherEstate + "/musters",
          )
        ).status,
      ).toBe(200);
      await recipientPage
        .getByLabel("Search Estate", { exact: true })
        .fill("Historical assigned");
      await recipientPage
        .getByRole("button", { name: "Find Estate", exact: true })
        .click();
      const ready = waitForAccountBootstrap(recipientPage, f.estate);
      await recipientPage
        .getByLabel("Estate", { exact: true })
        .selectOption(f.estate);
      await ready;
      await expect(
        recipientPage.getByLabel("Estate", { exact: true }),
      ).toHaveValue(f.estate);
      expect(
        (
          await f.root.query(
            "SELECT * FROM eoms.organization_admins WHERE user_id=$1 AND customer_id=$2",
            [f.peer.id, f.customer],
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
