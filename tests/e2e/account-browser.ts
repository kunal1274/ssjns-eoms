import { expect, type Page, type BrowserContext } from "@playwright/test";
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

// The shell heading precedes its asynchronous estate bootstrap. Wait for the
// actual successful responses and rendered loading state before reload/teardown.
export async function waitForAccountBootstrap(page: Page, estate: string) {
  const paths = [
    "/api/navigation/estates",
    ...[
      "musters",
      "catalog/workers",
      "catalog/occurrences",
      "audit",
      "gangs",
    ].map((path) => "/api/estates/" + estate + "/" + path),
  ];
  const responses = await Promise.all(
    paths.map((path) =>
      page.waitForResponse((response) => {
        const u = new URL(response.url());
        return (
          u.pathname === path &&
          (path !== "/api/navigation/estates" ||
            (u.searchParams.get("selectedId") === estate &&
              u.searchParams.has("q")))
        );
      }),
    ),
  );
  for (const response of responses) {
    expect(response.status()).toBe(200);
    expect(await response.finished()).toBeNull();
  }
  await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(estate);
  await expect(
    page.getByRole("status").filter({ hasText: "Loading Estate choices…" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Saving or loading records…" }),
  ).toHaveCount(0);
}
