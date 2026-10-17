import { test, expect, estateId } from "./fixtures";
import { randomUUID } from "node:crypto";
import { hash, token } from "../../apps/api/src/security";
test("E2E-JRN-02-007 @regression estate and unit availability protects work", async ({
  page,
  muster,
  work,
}) => {
  const suffix = Date.now().toString(36).toUpperCase(),
    actor = (
      await work.db.query(
        "SELECT id,display_name FROM eoms.users WHERE email='manager@eoms.local'",
      )
    ).rows[0],
    scope = (
      await work.db.query(
        "SELECT customer_id,company_id FROM eoms.estates WHERE id=$1",
        [estateId],
      )
    ).rows[0];
  const own = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,$4) RETURNING id",
      [
        scope.customer_id,
        scope.company_id,
        "LC-" + suffix,
        "Lifecycle journey " + suffix,
      ],
    )
  ).rows[0];
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [actor.id, own.id],
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
  await expect(page.locator("header")).toContainText(actor.display_name);
  expect(
    (await (await page.request.get("/api/auth/session")).json()).user.id,
  ).toBe(actor.id);
  const headers = { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
    base = `/api/estates/${own.id}`;
  async function post(path: string, data: object) {
    return page.request.post(base + path, { headers, data });
  }
  async function unit(kind: string, parentId: string | null) {
    const r = await post("/units", {
      kind,
      code: kind[0].toUpperCase() + suffix,
      name: "Lifecycle " + kind,
      parentId,
      reason: "Prepare lifecycle regression",
    });
    expect(r.status()).toBe(201);
    return r.json();
  }
  const division = await unit("division", null),
    field = await unit("field", division.id),
    block = await unit("block", field.id),
    taskCode = "LIFE-" + suffix;
  const taskResponse = await post("/occurrences", {
    blockId: block.id,
    taskCode,
    activity: "Lifecycle work",
    roundCode: "L",
    capacityHa: 2,
    reason: "Capture linked lifecycle work",
  });
  expect(taskResponse.status()).toBe(201);
  const task = await taskResponse.json();
  await work.db.query(
    "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'G-01','Lifecycle gang')",
    [own.id],
  );
  const worker = (
    await work.db.query(
      "INSERT INTO eoms.workers(estate_id,code,name) VALUES($1,'LIFE','Lifecycle worker') RETURNING id",
      [own.id],
    )
  ).rows[0];
  await work.db.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2105-01-01')",
    [own.id],
  );
  await page.reload();
  await expect(
    page
      .getByLabel("Estate", { exact: true })
      .locator(`option[value="${own.id}"]`),
  ).toBeAttached();
  await page.getByLabel("Estate", { exact: true }).selectOption(own.id);
  const panel = page.getByRole("region", {
    name: "Estate and unit availability",
    exact: true,
  });
  async function open() {
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    await panel
      .getByLabel("Availability estate", { exact: true })
      .selectOption(own.id);
    await expect(panel.locator("[data-estate-availability]")).toBeVisible();
  }
  async function choose(u: any, reason: string) {
    await panel
      .getByLabel("Availability unit", { exact: true })
      .selectOption(u.id);
    await panel
      .getByLabel("Unit availability reason", { exact: true })
      .fill(reason);
  }
  async function change(u: any, active: boolean) {
    await choose(u, (active ? "Resume " : "Pause ") + u.kind);
    await panel
      .getByRole("button", {
        name: active ? "Reactivate unit" : "Deactivate unit",
        exact: true,
      })
      .click();
    await expect(panel.getByRole("status")).toHaveText(
      "Availability saved. History and work safeguards updated.",
    );
    await expect(
      panel.getByRole("button", {
        name: active ? "Deactivate unit" : "Reactivate unit",
        exact: true,
      }),
    ).toBeEnabled();
  }
  let id = "";
  await test.step("Guide child dependency recovery and retain reason with support reference", async () => {
    await open();
    const reason = "Pause field before its active block";
    await choose(field, reason);
    const r = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/units/${field.id}/lifecycle`) &&
        r.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: "Deactivate unit", exact: true })
      .click();
    expect((await r).status()).toBe(409);
    await expect(panel.getByRole("alert")).toContainText(
      "Deactivate active child units first",
    );
    await expect(panel.getByRole("alert")).toContainText("Support reference");
    await expect(
      panel.getByLabel("Unit availability reason", { exact: true }),
    ).toHaveValue(reason);
  });
  await test.step("Capture a linked draft and block both unit and estate deactivation", async () => {
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await muster.startDraft(taskCode, "2105-01-15");
    const r = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    expect((await r).status()).toBe(201);
    id = (await (await r).json()).id;
    await open();
    await choose(block, "Pause blocked by linked draft");
    await panel
      .getByRole("button", { name: "Deactivate unit", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("Resolve draft work");
    await panel
      .getByLabel("Estate availability reason", { exact: true })
      .fill("Pause estate with draft must fail");
    await panel
      .getByRole("button", { name: "Deactivate estate", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("Resolve draft work");
    await expect(panel.locator("[data-estate-availability]")).toContainText(
      "Open drafts: 1",
    );
  });
  await test.step("Confirm draft then deactivate hierarchy while retaining work and audit", async () => {
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await (await muster.record(id))
      .getByRole("button", { name: "View", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm muster", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Muster detail · confirmed",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open availability setup", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Muster detail · confirmed",
        exact: true,
      }),
    ).toHaveCount(0);
    await panel
      .getByLabel("Availability estate", { exact: true })
      .selectOption(own.id);
    await expect(panel.locator("[data-estate-availability]")).toBeVisible();
    await change(block, false);
    const event = panel.locator(`[data-lifecycle-record-id="${block.id}"]`);
    await event
      .getByText("View availability audit details", { exact: true })
      .click();
    await expect(event).toContainText("Active → Inactive");
    const state = await (await page.request.get(base + "/lifecycle")).json();
    await expect(event).toContainText(
      state.history.find((h: any) => h.record_id === block.id).request_id,
    );
    await change(field, false);
    await change(division, false);
    const catalog = await (
      await page.request.get(base + "/catalog/occurrences")
    ).json();
    expect(catalog.items.some((t: any) => t.id === task.id)).toBe(false);
    const blocked = await page.request.post(base + "/musters", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {
        occurrenceId: task.id,
        businessDate: "2105-01-15",
        gangCode: "G-01",
        quantityHa: 0.1,
        workerIds: [worker.id],
      },
    });
    expect(blocked.status()).toBe(409);
    const saved = (
      await work.db.query(
        "SELECT status,legal_company_id FROM eoms.musters WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(saved.status).toBe("confirmed");
    expect(saved.legal_company_id).toBe(scope.company_id);
  });
  await test.step("Pause estate and keep confirmed history readable with clear work guidance", async () => {
    await panel
      .getByLabel("Estate availability reason", { exact: true })
      .fill("Pause estate after resolving all drafts");
    await panel
      .getByRole("button", { name: "Deactivate estate", exact: true })
      .click();
    await expect(panel.locator("[data-estate-availability]")).toContainText(
      "Inactive — work paused",
    );
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await expect(
      page.getByRole("note", { name: "Work availability", exact: true }),
    ).toContainText("Estate inactive");
    await expect(await muster.record(id)).toContainText("confirmed");
    const saved = await page.request.get(base + "/musters/" + id);
    expect(saved.status()).toBe(200);
    await page
      .getByRole("button", { name: "Open availability setup", exact: true })
      .click();
    await panel
      .getByLabel("Availability estate", { exact: true })
      .selectOption(own.id);
    await expect(panel.locator("[data-estate-availability]")).toContainText(
      "Inactive",
    );
  });
  await test.step("Reactivate estate and parents before block then resume linked capture", async () => {
    await panel
      .getByLabel("Estate availability reason", { exact: true })
      .fill("Resume estate under same memberships");
    await panel
      .getByRole("button", { name: "Reactivate estate", exact: true })
      .click();
    await expect(panel.locator("[data-estate-availability]")).toContainText(
      "Estate: Active",
    );
    await choose(block, "Parent-first reactivation required");
    await panel
      .getByRole("button", { name: "Reactivate unit", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("Work is paused");
    await expect(
      panel.getByLabel("Unit availability reason", { exact: true }),
    ).toHaveValue("Parent-first reactivation required");
    await change(division, true);
    await change(field, true);
    await change(block, true);
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await muster.startDraft(taskCode, "2105-01-16");
    const r = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    expect((await r).status()).toBe(201);
    expect((await (await r).json()).id).not.toBe(id);
    expect(
      (
        await work.db.query(
          "SELECT count(*)::int AS n FROM eoms.musters WHERE estate_id=$1",
          [own.id],
        )
      ).rows[0].n,
    ).toBe(2);
  });
});
