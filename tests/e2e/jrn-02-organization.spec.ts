import { test, expect } from "./fixtures";
test("E2E-JRN-02-001 @smoke @regression scoped organization and estate handoff", async ({
  page,
  supervisor,
  muster,
}) => {
  let customerName = "";
  await muster.signIn(supervisor);
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const guide = page.getByRole("region", {
    name: "Organization guide",
    exact: true,
  });
  await test.step("Read scoped customer/company/estate context", async () => {
    await expect(
      guide.getByRole("heading", {
        name: "Choose your operating context",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Customer", { exact: true })).toBeVisible();
    await expect(
      guide.getByRole("button", { name: "Open Senama Estate", exact: true }),
    ).toBeVisible();
    await expect(guide).not.toContainText("Ibam Estate");
    const response = await page.request.get("/api/organization");
    expect(response.status()).toBe(200);
    const data = await response.json();
    customerName = data.items[0].customer_name;
    expect(data.items).toHaveLength(1);
    expect(data.items[0].estate_id).toBe(
      "20000000-0000-4000-8000-000000000001",
    );
    await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(
      data.items[0].customer_id,
    );
  });
  await test.step("Inspect recorded customer creation details", async () => {
    const event = guide
      .getByRole("article")
      .filter({ hasText: "Customer registered" })
      .first();
    await expect(event).toBeVisible();
    await event
      .getByText("View customer change details", { exact: true })
      .click();
    await expect(
      event.getByText("No previous value (creation)", { exact: true }),
    ).toBeVisible();
    await expect(
      event.getByText("System / migration", { exact: false }),
    ).toBeVisible();
    await expect(event.getByText("After", { exact: true })).toBeVisible();
    await expect(event).toContainText(customerName);
  });
  await test.step("Open assigned estate and continue in muster register", async () => {
    await guide
      .getByRole("button", { name: "Open Senama Estate", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
      "20000000-0000-4000-8000-000000000001",
    );
    await expect(
      page.getByRole("button", { name: "+ New muster", exact: true }),
    ).toBeVisible();
  });
});
