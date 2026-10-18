import { test, expect, estateId } from "./fixtures";
test("E2E-JRN-02-003 @regression optional operating placement preserves scoped access", async ({
  page,
  setupAdmin,
  supervisor,
  muster,
  work,
}) => {
  await muster.signIn(setupAdmin);
  const session = await (await page.request.get("/api/auth/session")).json();
  const suffix = Date.now().toString(36).toUpperCase(),
    regionCode = "PR-" + suffix,
    businessCode = "PB-" + suffix;
  const source = (
    await work.db.query(
      "SELECT customer_id,company_id FROM eoms.estates WHERE id=$1",
      [estateId],
    )
  ).rows[0];
  const estate = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,$4) RETURNING id,company_id",
      [
        source.customer_id,
        source.company_id,
        "PE-" + suffix,
        "Placement journey " + suffix,
      ],
    )
  ).rows[0];
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [session.user.id, estate.id],
  );
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const placement = page.getByRole("region", {
    name: "Operating placement",
    exact: true,
  });
  let regionId = "",
    businessId = "";
  async function data() {
    const response = await page.request.get(
      `/api/customers/${source.customer_id}/placements`,
    );
    expect(response.status()).toBe(200);
    return await response.json();
  }
  async function saveArea() {
    await placement
      .getByRole("button", { name: "Save operating area", exact: true })
      .click();
    await expect(
      placement
        .getByRole("status")
        .filter({ hasText: "Operating area saved." }),
    ).toHaveText("Operating area saved.");
    await expect(
      placement.getByRole("button", {
        name: "Save operating area",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(placement.getByRole("alert")).toHaveCount(0);
  }
  await test.step("Create optional region and business unit with recorded parent", async () => {
    await placement.getByLabel("Area code", { exact: true }).fill(regionCode);
    await placement
      .getByLabel("Area name", { exact: true })
      .fill("Journey region");
    await placement
      .getByLabel("Area reason", { exact: true })
      .fill("Create guided optional region");
    await saveArea();
    regionId = (await data()).areas.find(
      (row: any) => row.code === regionCode,
    ).id;
    await placement
      .getByLabel("Area type", { exact: true })
      .selectOption("business-unit");
    await placement
      .getByLabel("Area parent", { exact: true })
      .selectOption(regionId);
    await placement.getByLabel("Area code", { exact: true }).fill(businessCode);
    await placement
      .getByLabel("Area name", { exact: true })
      .fill("Journey business unit");
    await placement
      .getByLabel("Area reason", { exact: true })
      .fill("Create guided business unit");
    await saveArea();
    const business = (await data()).areas.find(
      (row: any) => row.code === businessCode,
    );
    businessId = business.id;
    expect(business.parent_id).toBe(regionId);
    await expect(
      placement.locator(`[data-area-code="${businessCode}"]`),
    ).toContainText(regionCode);
  });
  await test.step("Place estate once and persist unchanged legal ownership", async () => {
    await placement
      .getByLabel("Placement estate", { exact: true })
      .selectOption(estate.id);
    await placement
      .getByLabel("Estate operating area", { exact: true })
      .selectOption(businessId);
    await placement
      .getByLabel("Placement reason", { exact: true })
      .fill("Initial reviewed estate placement");
    await placement
      .getByRole("button", { name: "Save estate placement", exact: true })
      .click();
    await expect(
      placement
        .getByRole("status")
        .filter({ hasText: "Estate placement saved." }),
    ).toHaveText("Estate placement saved.");
    await expect(
      placement.locator(`[data-placement-estate-id="${estate.id}"]`),
    ).toContainText(businessCode);
    const saved = (await data()).estates.find(
      (row: any) => row.id === estate.id,
    );
    expect(saved.area_id).toBe(businessId);
    expect(saved.company_id).toBe(estate.company_id);
    expect(saved.placement_version).toBe(2);
    await page.reload();
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    await expect(
      placement.locator(`[data-placement-estate-id="${estate.id}"]`),
    ).toContainText(businessCode);
    const rejected = await page.request.post(
      `/api/estates/${estate.id}/placement`,
      {
        headers: {
          Origin: new URL(page.url()).origin,
          "X-CSRF-Token": session.csrf,
        },
        data: {
          areaId: regionId,
          version: 2,
          reason: "Reject direct reassignment",
        },
      },
    );
    expect(rejected.status()).toBe(409);
    await placement
      .getByLabel("Placement estate", { exact: true })
      .selectOption(estate.id);
    await expect(
      placement.getByRole("button", {
        name: "Save estate placement",
        exact: true,
      }),
    ).toHaveCount(0);
  });
  await test.step("Edit area display and review before after placement audit", async () => {
    await placement
      .locator(`[data-area-code="${businessCode}"]`)
      .getByRole("button", { name: "Edit area", exact: true })
      .click();
    await expect(
      placement.getByLabel("Area parent", { exact: true }),
    ).toBeDisabled();
    await placement
      .getByLabel("Area name", { exact: true })
      .fill("Reviewed journey business unit");
    await placement
      .getByLabel("Area reason", { exact: true })
      .fill("Correct operating label after review");
    await saveArea();
    const event = placement
      .locator(`[data-placement-record-id="${businessId}"]`)
      .filter({ hasText: "Operating area updated" });
    await event
      .getByText("View placement change details", { exact: true })
      .click();
    await expect(event).toContainText("Journey business unit");
    await expect(event).toContainText("Reviewed journey business unit");
    const history = await (
      await page.request.get(
        `/api/customers/${source.customer_id}/hierarchy/history`,
      )
    ).json();
    const updated = history.items.find(
      (row: any) => row.record_id === businessId && row.action === "updated",
    );
    expect(updated.before.version).toBe(1);
    expect(updated.after.version).toBe(2);
    await expect(event).toContainText(updated.request_id);
    const placed = placement.locator(
      `[data-placement-record-id="${estate.id}"]`,
    );
    await placed
      .getByText("View placement change details", { exact: true })
      .click();
    await expect(placed).toContainText("Initial reviewed estate placement");
    await expect(placed).toContainText(businessId);
  });
  await test.step("Verify ordinary estate access gains no sibling area or estate visibility", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await muster.signIn(supervisor);
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    await expect(placement).toContainText("View only.");
    await expect(placement).not.toContainText(regionCode);
    await expect(placement).not.toContainText(businessCode);
    await expect(placement).not.toContainText("Placement journey " + suffix);
    await expect(
      placement.getByRole("button", {
        name: "Save operating area",
        exact: true,
      }),
    ).toHaveCount(0);
    const scoped = await data();
    expect(scoped.canConfigure).toBe(false);
    expect(scoped.estates).toHaveLength(1);
    expect(scoped.estates[0].id).toBe(estateId);
    expect(
      scoped.areas.some(
        (row: any) => row.id === businessId || row.id === regionId,
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Open Senama Estate", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
  });
});
