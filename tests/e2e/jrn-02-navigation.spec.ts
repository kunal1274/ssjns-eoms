import { test, expect } from "./fixtures";
import { hash, token } from "../../apps/api/src/security";
test("E2E-JRN-02-008 @regression searchable hierarchy and historical navigation", async ({
  page,
  work,
}) => {
  const suffix = Date.now().toString(36).toUpperCase(),
    code = "NAVF-" + suffix,
    actor = (
      await work.db.query(
        "SELECT id,display_name FROM eoms.users WHERE email='manager@eoms.local'",
      )
    ).rows[0];
  const customer = (
    await work.db.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,$2) RETURNING id",
      [code, "ZZZ Navigation journey " + suffix],
    )
  ).rows[0].id;
  const company = (
    await work.db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Navigation journey company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const estates = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,$2,$3||'-'||lpad(i::text,3,'0'),'Navigation estate '||$3||' '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,code,name",
      [customer, company, code],
    )
  ).rows;
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,id,'manager' FROM eoms.estates WHERE customer_id=$2",
    [actor.id, customer],
  );
  await work.db.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [customer, actor.id],
  );
  const own = estates.find((e) => e.code.endsWith("-201"));
  const units = (
    await work.db.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) SELECT $1,$2,'division','NU-'||lpad(i::text,3,'0'),'Navigation unit '||lpad(i::text,3,'0') FROM generate_series(1,501) i RETURNING id,code,name",
      [customer, own.id],
    )
  ).rows;
  const selected = units.find((u) => u.code === "NU-501");
  for (let i = 0; i < 52; i++)
    await work.db.query("UPDATE eoms.customers SET name=$2 WHERE id=$1", [
      customer,
      "ZZZ Navigation journey " + suffix + " revision " + i,
    ]);
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
  const explorer = page.getByRole("region", {
      name: "Organization explorer",
      exact: true,
    }),
    details = explorer.getByRole("region", {
      name: "Selected estate explorer",
      exact: true,
    }),
    history = details.getByRole("region", {
      name: "Explorer change history",
      exact: true,
    });
  await test.step("Search and paginate assigned estates beyond the overview limit", async () => {
    const old = await (await page.request.get("/api/organization")).json();
    expect(old.truncated).toBe(true);
    expect(old.items.some((e: any) => e.estate_id === own.id)).toBe(false);
    await explorer
      .getByLabel("Explorer page size", { exact: true })
      .selectOption("5");
    await explorer
      .getByLabel("Find assigned estate", { exact: true })
      .fill(code);
    await explorer
      .getByRole("button", { name: "Search estates", exact: true })
      .click();
    await expect(explorer.locator("[data-explorer-estate-id]")).toHaveCount(5);
    await explorer
      .getByRole("button", { name: "Load more estates", exact: true })
      .click();
    await expect(explorer.locator("[data-explorer-estate-id]")).toHaveCount(10);
    await explorer
      .getByLabel("Find assigned estate", { exact: true })
      .fill(own.code);
    await explorer
      .getByRole("button", { name: "Search estates", exact: true })
      .click();
    await expect(explorer.locator("[data-explorer-estate-id]")).toHaveCount(1);
    await explorer
      .getByRole("button", { name: "Inspect " + own.name, exact: true })
      .click();
    await expect(
      details.getByRole("heading", {
        name: "Selected estate: " + own.name,
        exact: true,
      }),
    ).toBeVisible();
  });
  await test.step("Recover a failed unit next page without losing rows or duplicating results", async () => {
    await expect(details.locator("[data-explorer-unit-id]")).toHaveCount(5);
    const first = await details
      .locator("[data-explorer-unit-id]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-explorer-unit-id")),
      );
    let injected = false;
    await page.route("**/api/navigation/estates/*/units?*", async (route) => {
      if (
        !injected &&
        new URL(route.request().url()).searchParams.has("cursor")
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
    });
    await details
      .getByRole("button", { name: "Load more units", exact: true })
      .click();
    await expect(details.getByRole("alert")).toContainText("Support reference");
    await expect(details.locator("[data-explorer-unit-id]")).toHaveCount(5);
    await details
      .getByRole("button", { name: "Retry units", exact: true })
      .click();
    await expect(details.locator("[data-explorer-unit-id]")).toHaveCount(10);
    expect(injected).toBe(true);
    const loaded = await details
      .locator("[data-explorer-unit-id]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-explorer-unit-id")),
      );
    expect(new Set(loaded).size).toBe(10);
    expect(loaded.slice(0, 5)).toEqual(first);
    await page.unroute("**/api/navigation/estates/*/units?*");
  });
  await test.step("Find a unit beyond 500 and filter its actual actor and support history", async () => {
    const old = await (
      await page.request.get(`/api/estates/${own.id}/units`)
    ).json();
    expect(old.truncated).toBe(true);
    expect(old.items.some((u: any) => u.id === selected.id)).toBe(false);
    await details
      .getByLabel("Find operating unit", { exact: true })
      .fill(selected.code);
    await details
      .getByLabel("Explorer unit type", { exact: true })
      .selectOption("division");
    await details
      .getByLabel("Explorer unit availability", { exact: true })
      .selectOption("active");
    await details
      .getByRole("button", { name: "Search units", exact: true })
      .click();
    await expect(details.locator("[data-explorer-unit-id]")).toHaveCount(1);
    const renamed = await page.request.post(
      `/api/estates/${own.id}/units/${selected.id}`,
      {
        headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
        data: {
          kind: "division",
          code: selected.code,
          name: "Navigation 50% _ literal",
          parentId: null,
          version: 1,
          reason: "Review explorer unit display",
        },
      },
    );
    expect(renamed.status()).toBe(200);
    const reference = renamed.headers()["x-request-id"];
    await details.getByLabel("Find operating unit", { exact: true }).fill("%");
    await details
      .getByRole("button", { name: "Search units", exact: true })
      .click();
    await expect(details.locator("[data-explorer-unit-id]")).toHaveCount(1);
    await details
      .getByRole("button", { name: "Review unit history", exact: true })
      .click();
    await history
      .getByLabel("History support reference", { exact: true })
      .fill(reference);
    await history
      .getByRole("button", { name: "Search history", exact: true })
      .click();
    await expect(history.locator("[data-explorer-event-id]")).toHaveCount(1);
    const event = history.locator("[data-explorer-event-id]");
    await event
      .getByText("View explorer audit details", { exact: true })
      .click();
    await expect(event).toContainText(actor.id);
    await expect(event).toContainText(reference);
    await expect(event).toContainText("Navigation 50% _ literal");
    await expect(event).toContainText(selected.name);
  });
  await test.step("Search older customer history outside the recent 50 event window", async () => {
    const old = await (
      await page.request.get(`/api/customers/${customer}/history`)
    ).json();
    expect(old.truncated).toBe(true);
    expect(old.items.some((h: any) => h.action === "customer.created")).toBe(
      false,
    );
    await history
      .getByLabel("History source", { exact: true })
      .selectOption("customer");
    await history
      .getByLabel("History support reference", { exact: true })
      .fill("");
    await history
      .getByLabel("Find recorded change", { exact: true })
      .fill("customer.created");
    await history
      .getByRole("button", { name: "Search history", exact: true })
      .click();
    await expect(history.locator("[data-explorer-event-id]")).toHaveCount(1);
    const event = history.locator("[data-explorer-event-id]");
    await expect(event).toContainText("customer.created");
    await event
      .getByText("View explorer audit details", { exact: true })
      .click();
    await expect(event).toContainText("No previous name");
    await expect(event).toContainText("ZZZ Navigation journey " + suffix);
  });
  await test.step("Deny unassigned scope and continue from explorer into estate work", async () => {
    const supervisor = (
        await work.db.query(
          "SELECT id FROM eoms.users WHERE email='supervisor@eoms.local'",
        )
      ).rows[0],
      otherRaw = token(),
      otherCsrf = token();
    await work.db.query(
      "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(otherRaw), supervisor.id, otherCsrf],
    );
    const denied = await page.request.get(
      `/api/navigation/estates/${own.id}/units`,
      { headers: { Cookie: "eoms_session=" + otherRaw } },
    );
    expect(denied.status()).toBe(404);
    await details
      .getByRole("button", { name: "Continue to selected estate", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
      own.id,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
