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

test("E2E-JRN-02-002 @regression configure hierarchy and review persisted changes", async ({
  page,
  setupAdmin,
  muster,
}) => {
  await muster.signIn(setupAdmin);
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const setup = page.getByRole("region", {
    name: "Hierarchy setup",
    exact: true,
  });
  const suffix = Date.now().toString(36).toUpperCase();
  const groupCode = "JG-" + suffix,
    divisionCode = "JD-" + suffix,
    fieldCode = "JF-" + suffix,
    blockCode = "JB-" + suffix;
  const estate = "20000000-0000-4000-8000-000000000001";
  const org = await (await page.request.get("/api/organization")).json();
  const customer = org.items.find(
    (row: any) => row.estate_id === estate,
  ).customer_id;
  let divisionId = "",
    fieldId = "",
    blockId = "";
  async function units() {
    const response = await page.request.get(`/api/estates/${estate}/units`);
    expect(response.status()).toBe(200);
    return (await response.json()).items as any[];
  }
  async function saveUnit(
    kind: string,
    code: string,
    name: string,
    parentId?: string,
  ) {
    await setup.getByLabel("Unit type", { exact: true }).selectOption(kind);
    if (parentId)
      await setup
        .getByLabel("Unit parent", { exact: true })
        .selectOption(parentId);
    await setup.getByLabel("Unit code", { exact: true }).fill(code);
    await setup.getByLabel("Unit name", { exact: true }).fill(name);
    await setup
      .getByLabel("Unit reason", { exact: true })
      .fill("Synthetic guided setup journey");
    await setup.getByRole("button", { name: "Save unit", exact: true }).click();
    await expect(setup.locator(`[data-unit-code="${code}"]`)).toContainText(
      name,
    );
    await expect(
      setup.getByRole("button", { name: "Save unit", exact: true }),
    ).toBeEnabled();
    await expect(setup.getByRole("alert")).toHaveCount(0);
    return (await units()).find((row) => row.code === code).id as string;
  }
  await test.step("Create legal group and assign company", async () => {
    await setup.getByLabel("Group code", { exact: true }).fill(groupCode);
    await setup
      .getByLabel("Group name", { exact: true })
      .fill("Journey legal group");
    await setup
      .getByLabel("Group reason", { exact: true })
      .fill("Synthetic legal setup");
    await setup
      .getByRole("button", { name: "Save group", exact: true })
      .click();
    const option = setup
      .getByLabel("Group assignment", { exact: true })
      .locator("option")
      .filter({ hasText: groupCode });
    await expect(option).toBeAttached();
    await expect(
      setup.getByRole("button", { name: "Save company group", exact: true }),
    ).toBeEnabled();
    const id = (await option.getAttribute("value"))!;
    await setup
      .getByLabel("Group assignment", { exact: true })
      .selectOption(id);
    await setup
      .getByLabel("Assignment reason", { exact: true })
      .fill("Synthetic company assignment");
    await setup
      .getByRole("button", { name: "Save company group", exact: true })
      .click();
    await expect(setup.getByRole("status")).toHaveText("Company group saved.");
    const data = await (
      await page.request.get(`/api/customers/${customer}/hierarchy`)
    ).json();
    expect(
      data.companies.find((row: any) => row.id === org.items[0].company_id)
        .group_id,
    ).toBe(id);
    await expect(setup.getByRole("alert")).toHaveCount(0);
  });
  await test.step("Create division and optional field", async () => {
    await setup
      .getByLabel("Hierarchy estate", { exact: true })
      .selectOption(estate);
    await expect(
      setup.getByRole("button", { name: "Save unit", exact: true }),
    ).toBeEnabled();
    divisionId = await saveUnit("division", divisionCode, "Journey division");
    fieldId = await saveUnit("field", fieldCode, "Journey field", divisionId);
    expect((await units()).find((row) => row.id === fieldId).parent_id).toBe(
      divisionId,
    );
  });
  await test.step("Create block and edit its display name", async () => {
    blockId = await saveUnit("block", blockCode, "Journey block", fieldId);
    await setup
      .locator(`[data-unit-code="${blockCode}"]`)
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await expect(setup.getByLabel("Unit type", { exact: true })).toBeDisabled();
    await setup
      .getByLabel("Unit name", { exact: true })
      .fill("Reviewed journey block");
    await setup
      .getByLabel("Unit reason", { exact: true })
      .fill("Correct display name after review");
    await setup.getByRole("button", { name: "Save unit", exact: true }).click();
    await expect(
      setup.locator(`[data-unit-code="${blockCode}"]`),
    ).toContainText("Reviewed journey block");
    await expect(
      setup.getByRole("button", { name: "Save unit", exact: true }),
    ).toBeEnabled();
    const saved = (await units()).find((row) => row.id === blockId);
    expect(saved.version).toBe(2);
    expect(saved.parent_id).toBe(fieldId);
  });
  await test.step("Review persisted hierarchy and recorded changes", async () => {
    await page.reload();
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    await setup
      .getByLabel("Hierarchy estate", { exact: true })
      .selectOption(estate);
    await expect(
      setup.locator(`[data-unit-code="${blockCode}"]`),
    ).toContainText("Reviewed journey block");
    await expect(
      setup.locator(`[data-unit-code="${blockCode}"]`),
    ).toContainText(fieldCode);
    const response = await page.request.get(
      `/api/customers/${customer}/hierarchy/history`,
    );
    expect(response.status()).toBe(200);
    const history = (await response.json()).items;
    const change = history.find(
      (row: any) => row.record_id === blockId && row.action === "updated",
    );
    expect(change.before.name).toBe("Journey block");
    expect(change.after.name).toBe("Reviewed journey block");
    expect(change.after.version).toBe(2);
    expect(change.request_id).toMatch(/^[0-9a-f-]{36}$/);
    const event = setup
      .locator(`[data-hierarchy-record-id="${blockId}"]`)
      .filter({ hasText: "Unit updated" });
    await expect(event).toContainText("Correct display name after review");
    await event
      .getByText("View hierarchy change details", { exact: true })
      .click();
    await expect(event).toContainText("Journey block");
    await expect(event).toContainText("Reviewed journey block");
    await expect(event).toContainText(change.request_id);
    await expect(setup.getByRole("alert")).toHaveCount(0);
  });
});
