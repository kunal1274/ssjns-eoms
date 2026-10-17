import { test, expect, estateId } from "./fixtures";
test("E2E-JRN-07-001 @smoke @regression capture, confirm and inspect audit", async ({
  page,
  supervisor,
  muster,
  work,
}) => {
  let id = "";
  await test.step("Sign in as assigned supervisor and identify the register", async () => {
    await muster.signIn(supervisor);
    await expect(page.getByLabel("Estate", { exact: true })).toBeVisible();
  });
  await test.step("Complete work date, task, area, gang and worker fields", async () => {
    await muster.startDraft(work.taskCode, work.date);
  });
  await test.step("Save once and verify a persisted draft plus success feedback", async () => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const saved = await response;
    expect(saved.status()).toBe(201);
    id = (await saved.json()).id;
    await expect(
      page.getByRole("status").filter({ hasText: "Draft saved to server." }),
    ).toBeVisible();
    const row = await muster.record(id);
    await row.getByRole("button", { name: "View", exact: true }).click();
  });
  await test.step("Confirm and verify the saved state after reload", async () => {
    await page
      .getByRole("button", { name: "Confirm muster", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Muster detail · confirmed",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    await expect(await muster.record(id)).toContainText("confirmed");
    const persisted = await work.db.query(
      "SELECT status,quantity_ha FROM eoms.musters WHERE id=$1 AND estate_id=$2",
      [id, estateId],
    );
    expect(persisted.rows[0].status).toBe("confirmed");
    expect(Number(persisted.rows[0].quantity_ha)).toBe(0.1);
  });
  await test.step("Check scope denial, short audit and expandable details", async () => {
    const denied = await page.request.get(
      "/api/estates/20000000-0000-4000-8000-000000000002/musters",
    );
    expect(denied.status()).toBe(403);
    await page
      .getByRole("button", { name: "Audit trail", exact: true })
      .click();
    const event = page
      .getByRole("article")
      .filter({ hasText: id })
      .filter({ hasText: "Muster confirmed" })
      .first();
    await expect(
      event.getByText("Muster confirmed", { exact: true }),
    ).toBeVisible();
    await event.getByText("View event details", { exact: true }).click();
    await expect(
      event.getByText("Support reference", { exact: true }),
    ).toBeVisible();
    const audit = await work.db.query(
      "SELECT action,detail FROM eoms.audit WHERE estate_id=$1 AND record_id=$2 ORDER BY id",
      [estateId, id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "muster.created",
      "muster.confirmed",
    ]);
    expect(
      audit.rows.every((r) => typeof r.detail.requestId === "string"),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
  await test.step("Sign out and return to the sign-in form", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  });
});
