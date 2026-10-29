import { test, expect, chooseEstate, estateId } from "./fixtures";
test("E2E-JRN-02-004 @regression dated responsibility preserves captured work", async ({
  page,
  setupAdmin,
  muster,
  work,
}) => {
  await muster.signIn(setupAdmin);
  const session = await (await page.request.get("/api/auth/session")).json();
  const suffix = Date.now().toString(36).toUpperCase();
  const source = (
    await work.db.query(
      "SELECT e.customer_id,e.company_id,c.name FROM eoms.estates e JOIN eoms.companies c ON c.id=e.company_id WHERE e.id=$1",
      [estateId],
    )
  ).rows[0];
  const target = (
    await work.db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,$2) RETURNING id,name",
      [source.customer_id, "ZZ Journey company " + suffix],
    )
  ).rows[0];
  const own = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,$4) RETURNING id",
      [
        source.customer_id,
        source.company_id,
        "LC-" + suffix,
        "Responsibility journey " + suffix,
      ],
    )
  ).rows[0];
  const anchor = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Responsibility target anchor') RETURNING id",
      [source.customer_id, target.id, "LT-" + suffix],
    )
  ).rows[0];
  for (const id of [own.id, anchor.id])
    await work.db.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [session.user.id, id],
    );
  await work.db.query(
    "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'G-01','Responsibility fixture gang')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.workers(estate_id,code,name) VALUES($1,'LW','Responsibility worker')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2101-01-01')",
    [own.id],
  );
  const taskCode = "LEGAL-" + suffix;
  await work.db.query(
    "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'LW',$2,'Responsibility journey','L',2)",
    [own.id, taskCode],
  );
  // Fixtures were created after login; reload to fetch the updated estate directory.
  await page.reload();
  await chooseEstate(page, own.id);
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const legal = page.getByRole("region", {
    name: "Estate responsibility",
    exact: true,
  });
  let assignmentId = "",
    workId = "";
  await test.step("Review baseline responsibility before the effective boundary", async () => {
    await legal
      .getByLabel("Responsibility estate", { exact: true })
      .selectOption(own.id);
    await expect(
      legal.getByLabel("Next responsible company", { exact: true }),
    ).toBeVisible();
    await legal
      .getByLabel("Responsibility review date", { exact: true })
      .fill("2101-01-09");
    await legal
      .getByRole("button", { name: "View responsibility date", exact: true })
      .click();
    await expect(legal.locator("[data-responsibility-summary]")).toContainText(
      "2101-01-09: " + source.name,
    );
    expect(
      (
        await work.db.query(
          "SELECT * FROM eoms.estate_responsibilities WHERE estate_id=$1",
          [own.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  await test.step("Schedule dated responsibility and inspect recorded change details", async () => {
    await legal
      .getByLabel("Next responsible company", { exact: true })
      .selectOption(target.id);
    await legal
      .getByLabel("Responsibility effective date", { exact: true })
      .fill("2101-01-10");
    await legal
      .getByLabel("Responsibility reason", { exact: true })
      .fill("Reviewed prospective company responsibility");
    await legal
      .getByRole("button", { name: "Save responsibility change", exact: true })
      .click();
    await expect(
      legal
        .getByRole("status")
        .filter({ hasText: "Responsibility change saved." }),
    ).toHaveText("Responsibility change saved. Existing work retained.");
    await expect(legal.locator("[data-responsibility-summary]")).toContainText(
      "2101-01-10: " + target.name,
    );
    const response = await page.request.get(
      `/api/estates/${own.id}/responsibility?on=2101-01-10`,
    );
    expect(response.status()).toBe(200);
    const data = await response.json();
    assignmentId = data.items[0].id;
    expect(data.revision).toBe(1);
    expect(data.baseline.id).toBe(source.company_id);
    const event = legal.locator(`[data-responsibility-id="${assignmentId}"]`);
    await event
      .getByText("View responsibility change details", { exact: true })
      .click();
    await expect(event).toContainText(source.name);
    await expect(event).toContainText(target.name);
    await expect(event).toContainText(data.items[0].request_id);
  });
  await test.step("Capture reload and inspect immutable responsible company snapshot", async () => {
    await chooseEstate(page, own.id);
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await muster.startDraft(taskCode, "2101-01-15");
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const saved = await response;
    expect(saved.status()).toBe(201);
    const row = await saved.json();
    workId = row.id;
    expect(row.legal_company_id).toBe(target.id);
    expect(row.legal_responsibility_id).toBe(assignmentId);
    await page.reload();
    const entry = await muster.record(workId);
    await entry.getByRole("button", { name: "View", exact: true }).click();
    await expect(page.locator("[data-work-attribution]")).toContainText(
      target.name,
    );
    await expect(page.locator("[data-work-attribution]")).toContainText(
      "Dated assignment",
    );
    const persisted = (
      await work.db.query(
        "SELECT legal_company_id,legal_company_name,legal_responsibility_id FROM eoms.musters WHERE id=$1",
        [workId],
      )
    ).rows[0];
    expect(persisted.legal_company_name).toBe(target.name);
    expect(persisted.legal_responsibility_id).toBe(assignmentId);
  });
  await test.step("Reject schedule affecting recorded work with retained input and audit reference", async () => {
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    await legal
      .getByLabel("Responsibility estate", { exact: true })
      .selectOption(own.id);
    await expect(
      legal.getByLabel("Next responsible company", { exact: true }),
    ).toBeVisible();
    await legal
      .getByLabel("Next responsible company", { exact: true })
      .selectOption(source.company_id);
    await legal
      .getByLabel("Responsibility effective date", { exact: true })
      .fill("2101-01-12");
    await legal
      .getByLabel("Responsibility reason", { exact: true })
      .fill("Attempt after recorded work");
    await legal
      .getByRole("button", { name: "Save responsibility change", exact: true })
      .click();
    await expect(legal.getByRole("alert")).toContainText("Work already exists");
    await expect(legal.getByRole("alert")).toContainText("Support reference:");
    await expect(
      legal.getByLabel("Responsibility reason", { exact: true }),
    ).toHaveValue("Attempt after recorded work");
    expect(
      (
        await work.db.query(
          "SELECT * FROM eoms.estate_responsibilities WHERE estate_id=$1",
          [own.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await work.db.query(
          "SELECT legal_company_id FROM eoms.musters WHERE id=$1",
          [workId],
        )
      ).rows[0].legal_company_id,
    ).toBe(target.id);
  });
});
