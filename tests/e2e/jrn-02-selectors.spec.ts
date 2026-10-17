import { test, expect, estateId } from "./fixtures";
import { hash, token } from "../../apps/api/src/security";
test("E2E-JRN-02-009 @regression paged configuration choices connect hierarchy tasks and capture", async ({
  page,
  work,
  muster,
}) => {
  const suffix = Date.now().toString(36).toUpperCase(),
    code = "SEL-" + suffix;
  const actor = (
    await work.db.query(
      "SELECT id FROM eoms.users WHERE email='manager@eoms.local'",
    )
  ).rows[0];
  const source = (
    await work.db.query(
      "SELECT customer_id,company_id FROM eoms.estates WHERE id=$1",
      [estateId],
    )
  ).rows[0];
  const estates = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,$2,$3||'-'||lpad(i::text,3,'0'),'ZZZ Selector '||$3||' '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,code,name",
      [source.customer_id, source.company_id, code],
    )
  ).rows;
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,id,'manager' FROM eoms.estates WHERE code LIKE $2",
    [actor.id, code + "-%"],
  );
  const own = estates.find((e) => e.code.endsWith("-201"));
  const divisions = (
    await work.db.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) SELECT $1,$2,'division','D-'||lpad(i::text,3,'0'),'Selector division '||i FROM generate_series(1,501) i RETURNING id,code,name",
      [source.customer_id, own.id],
    )
  ).rows;
  const root = divisions.find((u) => u.code === "D-001"),
    deep = divisions.find((u) => u.code === "D-501");
  await work.db.query(
    "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name,parent_id) SELECT $1,$2,'block','B-'||lpad(i::text,3,'0'),'Selector block '||i,$3 FROM generate_series(1,501) i",
    [source.customer_id, own.id, root.id],
  );
  await work.db.query(
    "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'G-01','Selector gang')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.workers(estate_id,code,name) VALUES($1,'SW','Selector worker')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2106-01-01')",
    [own.id],
  );
  const raw = token(),
    csrf = token();
  await work.db.query(
    "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(raw), actor.id, csrf],
  );
  await page.context().addCookies([
    {
      name: "eoms_session",
      value: raw,
      domain: "localhost",
      path: "/api",
      httpOnly: true,
      secure: false,
      sameSite: "Strict",
    },
  ]);
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/auth/session")).json()).user.id,
  ).toBe(actor.id);
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const setup = page.getByRole("region", {
    name: "Hierarchy setup",
    exact: true,
  });
  async function find(label: string, text: string) {
    await setup.getByLabel("Search " + label, { exact: true }).fill(text);
    await setup
      .getByRole("button", { name: "Find " + label, exact: true })
      .click();
  }
  async function unit(
    kind: string,
    unitCode: string,
    parentId: string,
    parentCode: string,
  ) {
    await setup.getByLabel("Unit type", { exact: true }).selectOption(kind);
    await find("Unit parent", parentCode);
    await setup
      .getByLabel("Unit parent", { exact: true })
      .selectOption(parentId);
    await setup.getByLabel("Unit code", { exact: true }).fill(unitCode);
    await setup
      .getByLabel("Unit name", { exact: true })
      .fill("Selector " + kind);
    await setup
      .getByLabel("Unit reason", { exact: true })
      .fill("Connected large hierarchy configuration");
  }
  async function saveUnit(status = 201) {
    const pending = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/estates/${own.id}/units`) &&
        r.request().method() === "POST",
    );
    await setup.getByRole("button", { name: "Save unit", exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(status);
    if (status < 300)
      await expect(
        setup.getByRole("status").filter({ hasText: "Unit saved." }),
      ).toBeVisible();
    return response.json();
  }
  let field: any, block: any, configured: any;
  await test.step("Find and retain an assigned estate outside the bounded setup overview", async () => {
    const old = await (
      await page.request.get(`/api/customers/${source.customer_id}/hierarchy`)
    ).json();
    expect(old.truncated).toBe(true);
    expect(old.estates.some((e: any) => e.id === own.id)).toBe(false);
    await find("Hierarchy estate", own.code);
    await setup
      .getByLabel("Hierarchy estate", { exact: true })
      .selectOption(own.id);
    await expect(
      setup.locator('[data-selector-selection="Hierarchy estate"]'),
    ).toContainText(own.code);
    const oldUnits = await (
      await page.request.get(`/api/estates/${own.id}/units`)
    ).json();
    expect(oldUnits.truncated).toBe(true);
    expect(oldUnits.items.some((u: any) => u.id === deep.id)).toBe(false);
  });
  await test.step("Recover parent search without discarding fields then create a field and block beyond 500", async () => {
    await unit("field", "SF-" + suffix, deep.id, deep.code);
    let injected = false;
    await page.route(
      `**/api/navigation/estates/${own.id}/units?*`,
      async (route) => {
        if (
          !injected &&
          new URL(route.request().url()).searchParams.get("q") ===
            "recovery-search"
        ) {
          injected = true;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Service temporarily unavailable",
              requestId: "33333333-3333-4333-8333-333333333333",
            }),
          });
        } else await route.continue();
      },
    );
    await find("Unit parent", "recovery-search");
    await expect(setup.getByRole("alert")).toContainText("Support reference");
    await expect(setup.getByLabel("Unit parent", { exact: true })).toHaveValue(
      deep.id,
    );
    await expect(setup.getByLabel("Unit code", { exact: true })).toHaveValue(
      "SF-" + suffix,
    );
    await expect(setup.getByLabel("Unit reason", { exact: true })).toHaveValue(
      "Connected large hierarchy configuration",
    );
    await expect(
      setup.getByRole("button", { name: "Save unit", exact: true }),
    ).toBeDisabled();
    await setup
      .getByRole("button", { name: "Retry Unit parent", exact: true })
      .click();
    field = await saveUnit();
    expect(injected).toBe(true);
    expect(field.parent_id).toBe(deep.id);
    await page.unroute(`**/api/navigation/estates/${own.id}/units?*`);
    await expect(
      setup.getByLabel("Hierarchy estate", { exact: true }),
    ).toHaveValue(own.id);
    await unit("block", "ZZ-TASK-" + suffix, field.id, field.code);
    block = await saveUnit();
    expect(block.parent_id).toBe(field.id);
    expect(
      (
        await (await page.request.get(`/api/estates/${own.id}/units`)).json()
      ).items.some((u: any) => u.id === block.id),
    ).toBe(false);
  });
  await test.step("Refresh and explicitly reload a deep existing unit after a real version conflict", async () => {
    await find("Existing unit", deep.code);
    await setup
      .getByLabel("Existing unit", { exact: true })
      .selectOption(deep.id);
    await expect(setup.getByLabel("Unit code", { exact: true })).toHaveValue(
      deep.code,
    );
    const concurrent = await page.request.post(
      `/api/estates/${own.id}/units/${deep.id}`,
      {
        headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
        data: {
          kind: "division",
          code: deep.code,
          name: "Concurrent selector rename",
          parentId: null,
          version: 1,
          reason: "Synthetic concurrent display correction",
        },
      },
    );
    expect(concurrent.status()).toBe(200);
    await setup
      .getByLabel("Unit name", { exact: true })
      .fill("Reviewed selector division");
    await setup
      .getByLabel("Unit reason", { exact: true })
      .fill("Retained after real version conflict");
    await saveUnit(409);
    await expect(setup.getByRole("alert")).toContainText("Support reference");
    await expect(setup.getByLabel("Unit reason", { exact: true })).toHaveValue(
      "Retained after real version conflict",
    );
    await setup
      .getByRole("button", { name: "Refresh lists", exact: true })
      .click();
    await find("Existing unit", deep.code);
    await setup
      .getByRole("button", { name: "Load selected Existing unit", exact: true })
      .click();
    await expect(setup.getByLabel("Unit name", { exact: true })).toHaveValue(
      "Concurrent selector rename",
    );
    await setup
      .getByLabel("Unit name", { exact: true })
      .fill("Reviewed selector division");
    await setup
      .getByLabel("Unit reason", { exact: true })
      .fill("Reviewed latest saved revision");
    const updated = await saveUnit(200);
    expect(updated.id).toBe(deep.id);
    expect(updated.version).toBe(3);
  });
  await test.step("Choose a deep configured block and review exact-code legacy linking", async () => {
    await page.getByLabel("Estate", { exact: true }).selectOption(own.id);
    await page
      .getByRole("button", { name: "Task capacity", exact: true })
      .click();
    async function saveTask(taskCode: string, legacy = false) {
      await page.getByRole("button", { name: "Add task", exact: true }).click();
      if (legacy) {
        await page
          .getByLabel("Block source", { exact: true })
          .selectOption("legacy");
        await page.getByLabel("Block code", { exact: true }).fill(block.code);
      } else {
        await page
          .getByLabel("Search Configured block", { exact: true })
          .fill(block.code);
        await page
          .getByRole("button", { name: "Find Configured block", exact: true })
          .click();
        await page
          .getByLabel("Configured block", { exact: true })
          .selectOption(block.id);
        await page
          .getByLabel("Block link reason", { exact: true })
          .fill("Reviewed block beyond bounded list");
      }
      await page.getByLabel("Task code", { exact: true }).fill(taskCode);
      await page
        .getByLabel("Activity", { exact: true })
        .fill("Selector connected work");
      await page.getByLabel("Round code", { exact: true }).fill("S");
      await page.getByLabel("Capacity (Ha)", { exact: true }).fill("2");
      const pending = page.waitForResponse(
        (r) =>
          r.url().endsWith("/occurrences") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      const response = await pending;
      expect(response.status()).toBe(201);
      await expect(
        page.getByRole("button", { name: "Add task", exact: true }),
      ).toBeVisible();
      return response.json();
    }
    configured = await saveTask("SC-" + suffix);
    expect(configured.block_unit_id).toBe(block.id);
    const legacy = await saveTask("SL-" + suffix, true);
    expect(legacy.block_unit_id).toBeNull();
    await page
      .getByLabel("Search tasks", { exact: true })
      .fill(legacy.task_code);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .locator(`[data-maintenance-id="${legacy.id}"]`)
      .getByRole("button", { name: "Link block", exact: true })
      .click();
    const review = page.getByRole("form", {
      name: "Review legacy block link",
      exact: true,
    });
    await review
      .getByLabel("Matching configured block", { exact: true })
      .selectOption(block.id);
    await review
      .getByLabel("Link review reason", { exact: true })
      .fill("Exact recorded code reviewed across full scope");
    await review
      .getByRole("button", { name: "Confirm block link", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    expect(
      (
        await work.db.query(
          "SELECT block_unit_id FROM eoms.occurrences WHERE id=$1",
          [legacy.id],
        )
      ).rows[0].block_unit_id,
    ).toBe(block.id);
  });
  await test.step("Capture work with the selected estate task block and company identities intact", async () => {
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await muster.startDraft(configured.task_code, "2106-01-15");
    const pending = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const saved = await response.json();
    const persisted = (
      await work.db.query(
        "SELECT m.estate_id,m.occurrence_id,m.legal_company_id,o.block_unit_id FROM eoms.musters m JOIN eoms.occurrences o ON o.id=m.occurrence_id WHERE m.id=$1",
        [saved.id],
      )
    ).rows[0];
    expect(persisted.estate_id).toBe(own.id);
    expect(persisted.occurrence_id).toBe(configured.id);
    expect(persisted.block_unit_id).toBe(block.id);
    expect(persisted.legal_company_id).toBe(source.company_id);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
