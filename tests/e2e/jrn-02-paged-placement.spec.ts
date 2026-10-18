import { test, expect } from "./fixtures";
import { hash, token } from "../../apps/api/src/security";
test("E2E-JRN-02-011 @regression paged placement and responsibility preserve work alignment", async ({
  page,
  work,
  muster,
}) => {
  const code = "PP-" + Date.now().toString(36).toUpperCase();
  const actors = (
      await work.db.query(
        "SELECT id,email FROM eoms.users WHERE email IN ('manager@eoms.local','reviewer@eoms.local')",
      )
    ).rows,
    manager = actors.find((r) => r.email === "manager@eoms.local"),
    reviewer = actors.find((r) => r.email === "reviewer@eoms.local");
  const customer = (
    await work.db.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,$2) RETURNING id",
      [code, "ZZZZ Paged placement " + code],
    )
  ).rows[0].id;
  const company = (
    await work.db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Paged baseline company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const source = { customer_id: customer, company_id: company };
  for (const actor of [manager, reviewer])
    await work.db.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [customer, actor.id],
    );
  const estates = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,$2,$3||'-'||lpad(i::text,3,'0'),'ZZZ Paged placement '||$3||' '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,code",
      [source.customer_id, source.company_id, code],
    )
  ).rows;
  for (const actor of [manager, reviewer])
    await work.db.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,id,'manager' FROM eoms.estates WHERE code LIKE $2",
      [actor.id, code + "-%"],
    );
  const own = estates.find((r) => r.code.endsWith("-201"));
  const regions = (
      await work.db.query(
        "INSERT INTO eoms.operating_areas(customer_id,kind,code,name) SELECT $1,'region',$2||'-R-'||lpad(i::text,3,'0'),'Paged region '||i FROM generate_series(1,201) i RETURNING id,code",
        [source.customer_id, code],
      )
    ).rows,
    region = regions.find((r) => r.code.endsWith("-201"));
  const companies = (
      await work.db.query(
        "INSERT INTO eoms.companies(customer_id,name) SELECT $1,'ZZZ Paged responsibility '||$2||' '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,name",
        [source.customer_id, code],
      )
    ).rows,
    target = companies.find((r) => r.name.endsWith("201"));
  await work.db.query(
    "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,id,$2||'-C-'||right(name,3),'ZZZ Company anchor '||$2||' '||right(name,3) FROM eoms.companies WHERE customer_id=$1 AND name LIKE $3",
    [source.customer_id, code, "ZZZ Paged responsibility " + code + " %"],
  );
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,id,'manager' FROM eoms.estates WHERE code LIKE $2 ON CONFLICT DO NOTHING",
    [manager.id, code + "-C-%"],
  );
  await work.db.query(
    "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'G-01','Paged placement gang')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.workers(estate_id,code,name) VALUES($1,'PPW','Paged placement worker')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2107-01-01')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'PP',$2,'Paged placement work','PP',2)",
    [own.id, code],
  );
  async function session(actor: any) {
    const raw = token();
    await work.db.query(
      "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(raw), actor.id, token()],
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
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    await page.getByLabel("Search Customer", { exact: true }).fill(code);
    await page
      .getByRole("button", { name: "Find Customer", exact: true })
      .click();
    await page.getByLabel("Customer", { exact: true }).selectOption(customer);
  }
  await session(manager);
  const placement = page.getByRole("region", {
      name: "Operating placement",
      exact: true,
    }),
    gate = placement.getByRole("region", {
      name: "Movement and area lifecycle",
      exact: true,
    }),
    legal = page.getByRole("region", {
      name: "Estate responsibility",
      exact: true,
    });
  async function find(panel: any, label: string, q: string) {
    await panel.getByLabel("Search " + label, { exact: true }).fill(q);
    await panel
      .getByRole("button", { name: "Find " + label, exact: true })
      .click();
  }
  let business: any,
    requestId = "";
  await test.step("Find an estate and region beyond the overview then create its business unit", async () => {
    const old = await (
      await page.request.get(`/api/customers/${source.customer_id}/placements`)
    ).json();
    expect(old.truncated).toBe(true);
    expect(old.estates.some((r: any) => r.id === own.id)).toBe(false);
    expect(old.areas.some((r: any) => r.id === region.id)).toBe(false);
    await find(placement, "Placement estate", own.code);
    await placement
      .getByLabel("Placement estate", { exact: true })
      .selectOption(own.id);
    await placement
      .getByLabel("Area type", { exact: true })
      .selectOption("business-unit");
    await find(placement, "Area parent", region.code);
    await placement
      .getByLabel("Area parent", { exact: true })
      .selectOption(region.id);
    await placement.getByLabel("Area code", { exact: true }).fill(code + "-BU");
    await placement
      .getByLabel("Area name", { exact: true })
      .fill("Paged business unit");
    await placement
      .getByLabel("Area reason", { exact: true })
      .fill("Reviewed paged region parent");
    const pending = page.waitForResponse(
      (r) => r.url().endsWith("/areas") && r.request().method() === "POST",
    );
    await placement
      .getByRole("button", { name: "Save operating area", exact: true })
      .click();
    const response = await pending;
    expect(response.status()).toBe(201);
    business = await response.json();
    expect(business.parent_id).toBe(region.id);
    await expect(
      placement.locator(`[data-area-code="${business.code}"]`),
    ).toContainText("Parent outside displayed window");
    await expect(
      placement.getByLabel("Placement estate", { exact: true }),
    ).toHaveValue(own.id);
  });
  await test.step("Retain placement inputs through search failure then save the intended estate area", async () => {
    await find(placement, "Estate operating area", region.code);
    await placement
      .getByLabel("Estate operating area", { exact: true })
      .selectOption(region.id);
    await placement
      .getByLabel("Placement reason", { exact: true })
      .fill("Reviewed deep initial placement");
    let injected = false;
    await page.route(
      `**/api/navigation/customers/${source.customer_id}/areas?*`,
      async (route) => {
        if (
          !injected &&
          new URL(route.request().url()).searchParams.get("q") ===
            "retry-placement"
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
    await find(placement, "Estate operating area", "retry-placement");
    await expect(placement.getByRole("alert")).toContainText(
      "Support reference",
    );
    await expect(
      placement.getByLabel("Placement reason", { exact: true }),
    ).toHaveValue("Reviewed deep initial placement");
    await expect(
      placement.getByLabel("Estate operating area", { exact: true }),
    ).toHaveValue(region.id);
    await expect(
      placement.getByRole("button", {
        name: "Save estate placement",
        exact: true,
      }),
    ).toBeDisabled();
    await placement
      .getByRole("button", { name: "Retry Estate operating area", exact: true })
      .click();
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/estates/${own.id}/placement`) &&
        r.request().method() === "POST",
    );
    await placement
      .getByRole("button", { name: "Save estate placement", exact: true })
      .click();
    const response = await pending;
    expect(response.status()).toBe(200);
    expect((await response.json()).area_id).toBe(region.id);
    expect(injected).toBe(true);
    await page.unroute(
      `**/api/navigation/customers/${source.customer_id}/areas?*`,
    );
    await expect(
      placement.getByLabel("Placement estate", { exact: true }),
    ).toHaveValue(own.id);
  });
  await test.step("Request and independently approve a move for the deeply selected estate", async () => {
    await find(gate, "Move estate", own.code);
    await gate.getByLabel("Move estate", { exact: true }).selectOption(own.id);
    await find(gate, "Move destination", business.code);
    await gate
      .getByLabel("Move destination", { exact: true })
      .selectOption(business.id);
    await gate
      .getByLabel("Move reason", { exact: true })
      .fill("Reviewed connected business unit move");
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/estates/${own.id}/placement-moves`) &&
        r.request().method() === "POST",
    );
    await gate
      .getByRole("button", { name: "Request estate move", exact: true })
      .click();
    const response = await pending;
    expect(response.status()).toBe(201);
    requestId = (await response.json()).id;
    expect(
      (
        await work.db.query("SELECT area_id FROM eoms.estates WHERE id=$1", [
          own.id,
        ])
      ).rows[0].area_id,
    ).toBe(region.id);
    await session(reviewer);
    await gate
      .getByLabel("Move request", { exact: true })
      .selectOption(requestId);
    await gate
      .getByLabel("Move decision", { exact: true })
      .selectOption("approved");
    await gate
      .getByLabel("Move review reason", { exact: true })
      .fill("Independent deep estate placement review");
    await gate
      .getByRole("button", { name: "Record move decision", exact: true })
      .click();
    await expect(
      gate
        .getByRole("status")
        .filter({ hasText: "Independent move decision saved." }),
    ).toBeVisible();
    const row = (
      await work.db.query(
        "SELECT area_id,company_id,placement_version FROM eoms.estates WHERE id=$1",
        [own.id],
      )
    ).rows[0];
    expect(row.area_id).toBe(business.id);
    expect(row.company_id).toBe(source.company_id);
    expect(row.placement_version).toBe(3);
    await gate
      .locator(`[data-move-request-id="${requestId}"]`)
      .getByText("View move audit details", { exact: true })
      .click();
    await expect(
      gate.locator(`[data-move-request-id="${requestId}"]`),
    ).toContainText("Independent deep estate placement review");
  });
  await test.step("Select a deep responsible company and save a dated attributable change", async () => {
    await session(manager);
    await find(legal, "Responsibility estate", own.code);
    await legal
      .getByLabel("Responsibility estate", { exact: true })
      .selectOption(own.id);
    const old = await (
      await page.request.get(`/api/estates/${own.id}/responsibility`)
    ).json();
    expect(old.companies.some((r: any) => r.id === target.id)).toBe(false);
    await find(legal, "Next responsible company", target.name);
    await legal
      .getByLabel("Next responsible company", { exact: true })
      .selectOption(target.id);
    await legal
      .getByLabel("Responsibility effective date", { exact: true })
      .fill("2107-01-01");
    await legal
      .getByLabel("Responsibility reason", { exact: true })
      .fill("Reviewed paged company responsibility");
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/estates/${own.id}/responsibility`) &&
        r.request().method() === "POST",
    );
    await legal
      .getByRole("button", { name: "Save responsibility change", exact: true })
      .click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const saved = await response.json();
    const event = legal.locator(`[data-responsibility-id="${saved.id}"]`);
    await expect(event).toBeVisible();
    await event
      .getByText("View responsibility change details", { exact: true })
      .click();
    await expect(event).toContainText(target.id);
    await expect(event).toContainText(response.headers()["x-request-id"]);
  });
  await test.step("Capture work with estate identity operating placement and dated company aligned", async () => {
    await page.getByLabel("Estate", { exact: true }).selectOption(own.id);
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await muster.startDraft(code, "2107-01-15");
    const pending = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const saved = await response.json();
    const row = (
      await work.db.query(
        "SELECT m.estate_id,m.legal_company_id,e.area_id FROM eoms.musters m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.id=$1",
        [saved.id],
      )
    ).rows[0];
    expect(row.estate_id).toBe(own.id);
    expect(row.legal_company_id).toBe(target.id);
    expect(row.area_id).toBe(business.id);
  });
});
