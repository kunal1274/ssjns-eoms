import type { Page, BrowserContext } from "@playwright/test";
export async function routeAccountBrowser(page: Page, f: { apiURL: string }) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    try {
      const response = await route.fetch({
        url: f.apiURL + u.pathname + u.search,
        headers: await route.request().allHeaders(),
        maxRedirects: 0,
      });
      await route.fulfill({ response });
    } catch {
      // Fail the test without copying APIRequestContext's Cookie/CSRF headers to logs.
      throw Error(
        "Synthetic account backend routing failed: " +
          route.request().method() +
          " " +
          u.pathname,
      );
    }
  });
}
export async function accountBrowser(
  page: Page,
  context: BrowserContext,
  f: any,
  authenticated = true,
) {
  await routeAccountBrowser(page, f);
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
export async function closeAccountBrowser(
  page: Page,
  f: { close: () => Promise<void> },
  primaryFailure: unknown = null,
) {
  let failure: unknown = null;
  try {
    // Remove new interception and wait for every already-running handler to finish.
    // Keep the owned backend alive until those requests have completed.
    await page.unrouteAll({ behavior: "wait" });
    if (!page.isClosed()) await page.goto("about:blank");
  } catch (error) {
    failure = error;
  }
  try {
    await f.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure && !primaryFailure) throw failure;
}
