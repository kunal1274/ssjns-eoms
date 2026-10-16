import { test, expect } from "./fixtures";
test("E2E-JRN-03-001 @regression @negative sign-in validation and service recovery", async ({
  page,
  supervisor,
}) => {
  let submissions = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/auth/login") &&
      request.method() === "POST"
    )
      submissions++;
  });
  await test.step("Required email and password prevent submission and receive focus", async () => {
    await page.goto("/");
    const email = page.getByLabel("Email", { exact: true });
    const password = page.getByLabel("Password", { exact: true });
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(email).toBeFocused();
    expect(
      await email.evaluate((el: HTMLInputElement) => el.validity.valueMissing),
    ).toBe(true);
    await email.fill("invalid-address");
    await password.fill(supervisor.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    expect(
      await email.evaluate((el: HTMLInputElement) => el.validity.typeMismatch),
    ).toBe(true);
    await email.fill(supervisor.email);
    await password.fill("");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(password).toBeFocused();
    expect(submissions).toBe(0);
    await password.fill(supervisor.password);
  });
  await test.step("Show safe service guidance and support reference, preserving the form", async () => {
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "PRIVATE-SIGNIN-DETAIL",
          requestId: "12345678-1234-1234-1234-123456789abc",
        }),
      }),
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const error = page.getByRole("alert");
    await expect(error).toContainText(
      "Support reference: 12345678-1234-1234-1234-123456789abc",
    );
    await expect(error).not.toContainText("PRIVATE-SIGNIN-DETAIL");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
      supervisor.email,
    );
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeEnabled();
    expect(submissions).toBe(1);
    await page.unroute("**/api/auth/login");
  });
  await test.step("Retry against real authentication and navigate to the register", async () => {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    expect(submissions).toBe(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
