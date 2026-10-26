import type { Page, BrowserContext } from "@playwright/test";
export async function accountBrowser(
  page: Page,
  context: BrowserContext,
  f: any,
  authenticated = true,
) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url()),
      response = await route.fetch({
        url: f.apiURL + u.pathname + u.search,
        headers: await route.request().allHeaders(),
        maxRedirects: 0,
      });
    await route.fulfill({ response });
  });
  if (authenticated)
    await context.addCookies([
      {
        name: "eoms_session",
        value: f.raw,
        domain: "localhost",
        path: "/api",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  await page.goto("/");
}
