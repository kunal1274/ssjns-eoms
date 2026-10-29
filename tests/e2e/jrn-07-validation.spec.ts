import { test, expect, estateId } from "./fixtures";
test("E2E-JRN-07-002 @regression @negative work form validation and safe retry", async ({
  page,
  supervisor,
  muster,
  work,
}) => {
  let posts = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/musters") && request.method() === "POST")
      posts++;
  });
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  await test.step("Open a complete synthetic work form", async () => {
    await muster.signIn(supervisor);
    await muster.startDraft(work.taskCode, work.date);
  });
  await test.step("Missing date, gang and area focus the invalid field without posting", async () => {
    for (const [label, restore, select] of [
      ["Work date", work.date, false],
      ["Gang code", "G-01", true],
      ["Area (Ha)", "0.10", false],
    ] as const) {
      const field = page.getByLabel(label, { exact: true });
      if (select) await field.selectOption("");
      else await field.fill("");
      await save.click();
      await expect(field).toBeFocused();
      expect(
        await field.evaluate(
          (el: HTMLInputElement | HTMLSelectElement) =>
            el.validity.valueMissing,
        ),
      ).toBe(true);
      if (select) await field.selectOption(restore);
      else await field.fill(restore);
    }
    const area = page.getByLabel("Area (Ha)", { exact: true });
    await area.fill("0");
    await save.click();
    expect(
      await area.evaluate((el: HTMLInputElement) => el.validity.rangeUnderflow),
    ).toBe(true);
    await area.fill("0.001");
    await save.click();
    expect(
      await area.evaluate((el: HTMLInputElement) => !el.validity.valid),
    ).toBe(true);
    await area.fill("0.10");
    expect(posts).toBe(0);
  });
  await test.step("Missing worker selection disables saving and keeps entered values", async () => {
    await page.getByRole("checkbox").first().uncheck();
    await expect(save).toBeDisabled();
    await expect(page.getByLabel("Area (Ha)", { exact: true })).toHaveValue(
      "0.10",
    );
    expect(posts).toBe(0);
    await page.getByRole("checkbox").first().check();
    await expect(save).toBeEnabled();
  });
  await test.step("Server validation rejection supplies guidance without saving a record", async () => {
    await page.route("**/api/estates/*/musters", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 422,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Review the submitted work.",
              requestId: "12345678-1234-1234-1234-123456789abc",
            }),
          })
        : route.continue(),
    );
    await save.click();
    await expect(page.getByRole("alert")).toContainText(
      "required fields and permitted values",
    );
    await expect(page.getByRole("alert")).toContainText("Support reference:");
    await expect(page.getByLabel("Work date", { exact: true })).toHaveValue(
      work.date,
    );
    await expect(page.getByLabel("Area (Ha)", { exact: true })).toHaveValue(
      "0.10",
    );
    const count = await work.db.query(
      "SELECT count(*)::int AS n FROM eoms.musters m JOIN eoms.occurrences o ON o.id=m.occurrence_id WHERE o.task_code=$1 AND m.estate_id=$2",
      [work.taskCode, estateId],
    );
    expect(count.rows[0].n).toBe(0);
    await page.unroute("**/api/estates/*/musters");
  });
  await test.step("Corrected retry saves exactly one draft and one audit event", async () => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await save.click();
    const saved = await response;
    expect(saved.status()).toBe(201);
    const id = (await saved.json()).id;
    await expect(
      page.getByRole("status").filter({ hasText: "Draft saved to server." }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const count = await work.db.query(
      "SELECT count(*)::int AS n FROM eoms.musters m JOIN eoms.occurrences o ON o.id=m.occurrence_id WHERE o.task_code=$1 AND m.estate_id=$2",
      [work.taskCode, estateId],
    );
    expect(count.rows[0].n).toBe(1);
    const audit = await work.db.query(
      "SELECT action FROM eoms.audit WHERE estate_id=$1 AND record_id=$2",
      [estateId, id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["muster.created"]);
  });
});
