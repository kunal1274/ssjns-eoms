import { test, expect, estateId, chooseEstate } from "./fixtures";
test("E2E-JRN-06-001 @regression connect configured blocks tasks and work", async ({
  page,
  setupAdmin,
  muster,
  work,
}) => {
  await muster.signIn(setupAdmin);
  await chooseEstate(page, estateId);
  const csrf = (await (await page.request.get("/api/auth/session")).json())
    .csrf;
  const suffix = Date.now().toString(36).toUpperCase(),
    code = "TB-" + suffix;
  const base = `/api/estates/${estateId}`;
  async function createUnit(
    kind: string,
    unitCode: string,
    parentId: string | null,
  ) {
    const response = await page.request.post(base + "/units", {
      headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
      data: {
        kind,
        code: unitCode,
        name: "Task journey " + kind,
        parentId,
        reason: "Synthetic connected task setup",
      },
    });
    expect(response.status()).toBe(201);
    return await response.json();
  }
  const division = await createUnit("division", "TD-" + suffix, null),
    block = await createUnit("block", code, division.id);
  let configuredId = "",
    legacyId = "";
  async function fillTask(taskCode: string) {
    await page.getByLabel("Task code", { exact: true }).fill(taskCode);
    await page
      .getByLabel("Activity", { exact: true })
      .fill("Connected work journey");
    await page.getByLabel("Round code", { exact: true }).fill("LINK");
    await page.getByLabel("Capacity (Ha)", { exact: true }).fill("2");
  }
  async function saveTask() {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/occurrences") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    const saved = await response;
    expect(saved.status()).toBe(201);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Saved. Audit history updated." }),
    ).toBeVisible();
    return await saved.json();
  }
  async function searchTask(taskCode: string) {
    await page.getByLabel("Search tasks", { exact: true }).fill(taskCode);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Search", exact: true }),
    ).toBeEnabled();
  }
  await test.step("Create task from configured block and verify stable reference", async () => {
    await page
      .getByRole("button", { name: "Task capacity", exact: true })
      .click();
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await expect(page.getByLabel("Block source", { exact: true })).toHaveValue(
      "configured",
    );
    await page
      .getByLabel("Configured block", { exact: true })
      .selectOption(block.id);
    await page
      .getByLabel("Block link reason", { exact: true })
      .fill("Review new task block assignment");
    await fillTask("CONFIG-" + suffix);
    const saved = await saveTask();
    configuredId = saved.id;
    expect(saved.block_unit_id).toBe(block.id);
    expect(saved.block_code).toBe(code);
    await searchTask("CONFIG-" + suffix);
    await expect(
      page.locator(`[data-maintenance-id="${configuredId}"]`),
    ).toContainText("Linked block:");
  });
  await test.step("Review legacy task linking with recoverable conflict and retained fields", async () => {
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await page
      .getByLabel("Block source", { exact: true })
      .selectOption("legacy");
    await page.getByLabel("Block code", { exact: true }).fill(code);
    await fillTask("LEGACY-" + suffix);
    const saved = await saveTask();
    legacyId = saved.id;
    expect(saved.block_unit_id).toBeNull();
    await searchTask("LEGACY-" + suffix);
    const row = page.locator(`[data-maintenance-id="${legacyId}"]`);
    await expect(row).toContainText("Legacy code · unlinked");
    await row.getByRole("button", { name: "Link block", exact: true }).click();
    const form = page.getByRole("form", {
      name: "Review legacy block link",
      exact: true,
    });
    await form
      .getByLabel("Matching configured block", { exact: true })
      .selectOption(block.id);
    await form
      .getByLabel("Link review reason", { exact: true })
      .fill("Reviewed historical block attribution");
    const supportId = "12345678-1234-4234-8234-123456789abc";
    await page.route(
      `**/occurrences/${legacyId}/block-link`,
      (route) =>
        route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Task changed. Refresh before saving.",
            requestId: supportId,
          }),
        }),
      { times: 1 },
    );
    await form
      .getByRole("button", { name: "Confirm block link", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText(supportId);
    await expect(
      form.getByLabel("Link review reason", { exact: true }),
    ).toHaveValue("Reviewed historical block attribution");
    expect(
      (
        await work.db.query(
          "SELECT block_unit_id FROM eoms.occurrences WHERE id=$1",
          [legacyId],
        )
      ).rows[0].block_unit_id,
    ).toBeNull();
    // The injected conflict made no write. A fresh real submission is safe with the unchanged version.
    await form
      .getByRole("button", { name: "Confirm block link", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    await expect(row).toContainText("Linked block:");
    const linked = (
      await work.db.query(
        "SELECT block_unit_id,version FROM eoms.occurrences WHERE id=$1",
        [legacyId],
      )
    ).rows[0];
    expect(linked.block_unit_id).toBe(block.id);
    expect(linked.version).toBe(2);
  });
  await test.step("Capture and persist work against the configured task identity", async () => {
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await muster.startDraft("CONFIG-" + suffix, work.date);
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const saved = await response;
    expect(saved.status()).toBe(201);
    const id = (await saved.json()).id;
    await page.reload();
    await expect(await muster.record(id)).toBeVisible();
    const persisted = (
      await work.db.query(
        "SELECT m.occurrence_id,o.block_unit_id FROM eoms.musters m JOIN eoms.occurrences o ON o.id=m.occurrence_id WHERE m.id=$1",
        [id],
      )
    ).rows[0];
    expect(persisted.occurrence_id).toBe(configuredId);
    expect(persisted.block_unit_id).toBe(block.id);
  });
  await test.step("Inspect recorded block link summary details and persisted task status", async () => {
    await page
      .getByRole("button", { name: "Audit trail", exact: true })
      .click();
    const event = page
      .getByRole("article")
      .filter({ hasText: legacyId })
      .filter({ hasText: "Task linked to configured block" });
    await expect(event).toBeVisible();
    await event.getByText("View event details", { exact: true }).click();
    await expect(event).toContainText("Reviewed historical block attribution");
    await expect(event).toContainText(block.id);
    await page
      .getByRole("button", { name: "Task capacity", exact: true })
      .click();
    await searchTask("LEGACY-" + suffix);
    const row = page.locator(`[data-maintenance-id="${legacyId}"]`);
    await expect(row).toContainText("Linked block:");
    await expect(
      row.getByRole("button", { name: "Link block", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open hierarchy setup", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Hierarchy setup", exact: true }),
    ).toBeVisible();
    const events = (
      await work.db.query(
        "SELECT * FROM eoms.hierarchy_history WHERE record_id=$1 AND record_type='task-link'",
        [legacyId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0].before_state.parentId).toBeNull();
    expect(events[0].after_state.parentId).toBe(block.id);
  });
});
