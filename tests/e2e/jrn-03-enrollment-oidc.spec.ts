import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { controlledIssuer } from "../oidc-issuer-fixture";
import { createServer, type ViteDevServer } from "vite";
import { token } from "../../apps/api/src/security";
import { randomUUID } from "node:crypto";
import { waitForAccountBootstrap } from "./account-browser";
test("E2E-JRN-03-013 @regression the invited exact organization identity must prove MFA before activation", async ({
  page,
}) => {
  const origin = "http://localhost:5395",
    idp = await controlledIssuer(origin),
    f = await upgradedWorkFixture({
      setupAdmin: true,
      appOptions: { oidc: idp.config, webOrigin: origin },
    });
  let gateway: ViteDevServer | undefined;
  try {
    const call = (body: any) =>
      fetch(f.apiURL + "/api/auth/onboarding/write", {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: "eoms_session=" + f.raw,
          "X-CSRF-Token": "synthetic-history-ui",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const ref = {
      customerId: f.customer,
      reference: "Controlled organization enrollment",
      reason:
        "Explicitly bind this new identity to the verified controlled issuer subject",
    };
    const created = await call({
      operation: "stage",
      key: randomUUID(),
      input: {
        ...ref,
        email: randomUUID() + "@fixture.local",
        name: "Controlled organization employee",
        userCode: "OIDC-EMP",
        employeeReference: "Synthetic HR OIDC employee",
        estates: [{ estateId: f.estate, role: "clerk" }],
      },
    });
    expect(created.status).toBe(200);
    const u = await created.json(),
      secret = token();
    const issued = await call({
      operation: "invite",
      key: randomUUID(),
      input: {
        ...ref,
        targetId: u.targetId,
        revision: u.revision,
        method: "oidc",
        subject: "fixture-subject",
        token: secret,
      },
    });
    expect(issued.status).toBe(200);
    gateway = await createServer({
      configFile: "apps/web/vite.config.ts",
      cacheDir: process.cwd() + "/.local/enrollment-oidc-cache",
      logLevel: "error",
      server: {
        host: "127.0.0.1",
        port: 5395,
        strictPort: true,
        proxy: { "/api": { target: f.apiURL } },
      },
    });
    await gateway.listen();
    await page.goto(origin + "/#invite=" + secret);
    await test.step("Reject missing MFA without activating the staged invitation", async () => {
      const p = page.getByRole("region", {
        name: "Accept user invitation",
        exact: true,
      });
      idp.setMode("no-mfa");
      await p
        .getByRole("button", {
          name: "Accept with organization identity",
          exact: true,
        })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "Organization sign-in could not be completed",
      );
      expect(idp.issuedTokens()).toBe(1);
      expect(
        (
          await f.root.query("SELECT active FROM eoms.users WHERE id=$1", [
            u.targetId,
          ])
        ).rows[0].active,
      ).toBe(false);
    });
    await test.step("Accept the bound organization subject with verified MFA and open only the approved estate", async () => {
      idp.setMode("valid");
      const p = page.getByRole("region", {
        name: "Accept user invitation",
        exact: true,
      });
      await p
        .getByRole("button", { name: "Accept an invitation", exact: true })
        .click();
      await p.getByLabel("Invitation token", { exact: true }).fill(secret);
      const ready = waitForAccountBootstrap(page, f.estate);
      await p
        .getByRole("button", {
          name: "Accept with organization identity",
          exact: true,
        })
        .click();
      await ready;
      await expect(
        page.getByRole("heading", { name: "Muster register", exact: true }),
      ).toBeVisible();
      expect(idp.issuedTokens()).toBe(2);
      await page
        .getByRole("button", { name: "Account security", exact: true })
        .click();
      const account = page.getByRole("region", {
        name: "Account security controls",
        exact: true,
      });
      await expect(
        account.getByText("MFA verified", { exact: false }),
      ).toBeVisible();
      const manifest = page.getByRole("region", {
        name: "Account and device access sync",
        exact: true,
      });
      await expect(manifest).toContainText("OIDC-EMP");
      await expect(manifest.getByRole("listitem")).toHaveCount(1);
      expect(
        (
          await f.root.query(
            "SELECT user_id FROM eoms.identity_links WHERE issuer=$1 AND subject=$2",
            [idp.config.issuer, "fixture-subject"],
          )
        ).rows[0].user_id,
      ).toBe(u.targetId);
    });
  } finally {
    if (!page.isClosed()) await page.goto("about:blank");
    await gateway?.close();
    await f.close();
    await idp.close();
  }
});
