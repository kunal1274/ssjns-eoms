import { test, expect } from "./fixtures";
import { upgradedWorkFixture } from "../upgraded-work-fixture";
import { controlledIssuer } from "../oidc-issuer-fixture";
import { createServer, type ViteDevServer } from "vite";
test("E2E-JRN-03-005 @regression organization sign-in requires MFA and an explicitly linked account", async ({
  page,
  context,
}) => {
  const webOrigin = "http://localhost:5394";
  const idp = await controlledIssuer(webOrigin),
    f = await upgradedWorkFixture({
      appOptions: { oidc: idp.config, webOrigin },
    });
  let gateway: ViteDevServer | undefined;
  let stage = "initialization";
  const authResponses: { path: string; status: number }[] = [];
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/auth/"))
      authResponses.push({ path, status: r.status() });
  });
  try {
    await f.root.query(
      "INSERT INTO eoms.identity_links(issuer,subject,user_id,reference,reason) VALUES($1,'fixture-subject',$2,'Synthetic browser mapping','Explicit controlled identity association')",
      [idp.config.issuer, f.user],
    );
    // Cross-site authorization navigations use a real reverse proxy. Rewriting a
    // navigational route through APIRequestContext changes cookie/redirect handling.
    gateway = await createServer({
      configFile: "apps/web/vite.config.ts",
      cacheDir: process.cwd() + "/.local/oidc-browser-vite-cache",
      logLevel: "error",
      server: {
        host: "127.0.0.1",
        port: 5394,
        strictPort: true,
        proxy: { "/api": { target: f.apiURL } },
      },
    });
    await gateway.listen();
    await page.goto(webOrigin + "/");
    await test.step("Recover safely from an identity response without required MFA", async () => {
      stage = "required-mfa-rejection";
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
      expect(idp.issuedTokens()).toBe(1);
      expect(
        (
          await f.root.query(
            "SELECT id FROM eoms.sessions WHERE auth_method='oidc'",
          )
        ).rowCount,
      ).toBe(0);
    });
    await test.step("Complete controlled MFA sign-in and open provider-managed account security", async () => {
      stage = "explicit-linked-mfa-sign-in";
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
      expect(idp.issuedTokens()).toBe(2);
      stage = "provider-account-security";
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
  } catch (error) {
    console.error(
      "Synthetic OIDC journey stage: " +
        stage +
        "; page path: " +
        new URL(page.url()).pathname +
        "; auth response statuses: " +
        JSON.stringify(authResponses),
    );
    throw error;
  } finally {
    await gateway?.close();
    await f.close();
    await idp.close();
  }
});
