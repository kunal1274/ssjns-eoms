import { test, expect } from "./fixtures";
import { hash, token } from "../../apps/api/src/security";
test("E2E-JRN-02-010 @regression deep customer company and legal group configuration", async ({
  page,
  work,
}) => {
  const code = "CX-" + Date.now().toString(36).toUpperCase();
  const actor = (
    await work.db.query(
      "SELECT id FROM eoms.users WHERE email='manager@eoms.local'",
    )
  ).rows[0];
  const customers = (
    await work.db.query(
      "INSERT INTO eoms.customers(code,name) SELECT $1||'-'||lpad(i::text,3,'0'),'ZZZZ Context '||$1||' '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,code,name",
      [code],
    )
  ).rows;
  await work.db.query(
    "INSERT INTO eoms.companies(customer_id,name) SELECT id,'Anchor '||code FROM eoms.customers WHERE code LIKE $1",
    [code + "-%"],
  );
  await work.db.query(
    "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT c.customer_id,c.id,t.code,'Context anchor '||t.code FROM eoms.companies c JOIN eoms.customers t ON t.id=c.customer_id WHERE t.code LIKE $1",
    [code + "-%"],
  );
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,id,'manager' FROM eoms.estates WHERE code LIKE $2",
    [actor.id, code + "-%"],
  );
  const own = customers.find((r) => r.code.endsWith("-201"));
  await work.db.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [own.id, actor.id],
  );
  const companies = (
    await work.db.query(
      "INSERT INTO eoms.companies(customer_id,name) SELECT $1,'Context company '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,name",
      [own.id],
    )
  ).rows;
  await work.db.query(
    "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,id,$2||'-C-'||right(name,3),'Context company estate '||right(name,3) FROM eoms.companies WHERE customer_id=$1 AND name LIKE 'Context company %'",
    [own.id, code],
  );
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,id,'manager' FROM eoms.estates WHERE code LIKE $2",
    [actor.id, code + "-C-%"],
  );
  const groups = (
    await work.db.query(
      "INSERT INTO eoms.customer_groups(customer_id,code,name) SELECT $1,'CG-'||lpad(i::text,3,'0'),'Context group '||i FROM generate_series(1,201) i RETURNING id,code,name",
      [own.id],
    )
  ).rows;
  const company = companies.find((r) => r.name.endsWith("201")),
    group = groups.find((r) => r.code.endsWith("201"));
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
  const guide = page.getByRole("region", {
    name: "Organization guide",
    exact: true,
  });
  const setup = page.getByRole("region", {
    name: "Hierarchy setup",
    exact: true,
  });
  async function find(label: string, q: string) {
    await guide.getByLabel("Search " + label, { exact: true }).fill(q);
    await guide
      .getByRole("button", { name: "Find " + label, exact: true })
      .click();
  }
  async function saveGroup(status = 200) {
    const p = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/companies/${company.id}/group`) &&
        r.request().method() === "POST",
    );
    await setup
      .getByRole("button", { name: "Save company group", exact: true })
      .click();
    const r = await p;
    expect(r.status()).toBe(status);
    return r;
  }
  await test.step("Find a permitted customer outside the organization overview and enter its setup", async () => {
    const old = await (await page.request.get("/api/organization")).json();
    expect(old.truncated).toBe(true);
    expect(old.items.some((r: any) => r.customer_id === own.id)).toBe(false);
    await find("Customer", own.code);
    await guide.getByLabel("Customer", { exact: true }).selectOption(own.id);
    await expect(
      guide.locator('[data-selector-selection="Customer"]'),
    ).toContainText(own.code);
    await expect(
      setup.getByRole("heading", { name: "Hierarchy setup", exact: true }),
    ).toBeVisible();
    const oldSetup = await (
      await page.request.get(`/api/customers/${own.id}/hierarchy`)
    ).json();
    expect(oldSetup.truncated).toBe(true);
    expect(oldSetup.companies.some((r: any) => r.id === company.id)).toBe(
      false,
    );
    expect(oldSetup.groups.some((r: any) => r.id === group.id)).toBe(false);
  });
  await test.step("Recover group search with deep company choice and assignment reason retained", async () => {
    await find("Hierarchy company", company.name);
    await setup
      .getByLabel("Hierarchy company", { exact: true })
      .selectOption(company.id);
    await find("Group assignment", group.code);
    await setup
      .getByLabel("Group assignment", { exact: true })
      .selectOption(group.id);
    await setup
      .getByLabel("Assignment reason", { exact: true })
      .fill("Reviewed deep group assignment");
    await find("Customer", "no matching root");
    await expect(
      setup.getByLabel("Assignment reason", { exact: true }),
    ).toHaveValue("Reviewed deep group assignment");
    let injected = false;
    await page.route(
      `**/api/navigation/customers/${own.id}/groups?*`,
      async (route) => {
        if (
          !injected &&
          new URL(route.request().url()).searchParams.get("q") ===
            "recover-group"
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
    await find("Group assignment", "recover-group");
    await expect(setup.getByRole("alert")).toContainText("Support reference");
    await expect(
      setup.getByLabel("Group assignment", { exact: true }),
    ).toHaveValue(group.id);
    await expect(
      setup.getByLabel("Hierarchy company", { exact: true }),
    ).toHaveValue(company.id);
    await expect(
      setup.getByLabel("Assignment reason", { exact: true }),
    ).toHaveValue("Reviewed deep group assignment");
    await expect(
      setup.getByRole("button", { name: "Save company group", exact: true }),
    ).toBeDisabled();
    await setup
      .getByRole("button", { name: "Retry Group assignment", exact: true })
      .click();
    await expect(
      setup.getByRole("button", { name: "Save company group", exact: true }),
    ).toBeEnabled();
    expect(injected).toBe(true);
    await page.unroute(`**/api/navigation/customers/${own.id}/groups?*`);
  });
  let reference = "";
  await test.step("Recover a real company version conflict and explicitly reload before saving", async () => {
    const concurrent = await page.request.post(
      `/api/customers/${own.id}/companies/${company.id}/group`,
      {
        headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
        data: {
          groupId: null,
          version: 1,
          reason: "Synthetic concurrent hierarchy review",
        },
      },
    );
    expect(concurrent.status()).toBe(200);
    await saveGroup(409);
    await expect(setup.getByRole("alert")).toContainText("Support reference");
    await expect(
      setup.getByLabel("Assignment reason", { exact: true }),
    ).toHaveValue("Reviewed deep group assignment");
    await setup
      .getByRole("button", { name: "Refresh hierarchy lists", exact: true })
      .click();
    await find("Hierarchy company", company.name);
    await setup
      .getByRole("button", {
        name: "Load selected Hierarchy company",
        exact: true,
      })
      .click();
    await expect(
      setup.getByLabel("Group assignment", { exact: true }),
    ).toHaveValue("");
    await expect(
      setup.getByLabel("Assignment reason", { exact: true }),
    ).toHaveValue("");
    await find("Group assignment", group.code);
    await setup
      .getByLabel("Group assignment", { exact: true })
      .selectOption(group.id);
    await setup
      .getByLabel("Assignment reason", { exact: true })
      .fill("Reviewed latest company hierarchy and group");
    const saved = await saveGroup();
    reference = saved.headers()["x-request-id"];
    const row = await saved.json();
    expect(row.id).toBe(company.id);
    expect(row.group_id).toBe(group.id);
    expect(row.hierarchy_version).toBe(3);
    await expect(
      setup.getByRole("status").filter({ hasText: "Company group saved." }),
    ).toBeVisible();
    await expect(
      setup.getByLabel("Hierarchy company", { exact: true }),
    ).toHaveValue(company.id);
    await expect(guide.getByLabel("Customer", { exact: true })).toHaveValue(
      own.id,
    );
  });
  await test.step("Inspect actual group audit provenance and reject an unassigned customer pin", async () => {
    const event = setup
      .getByRole("article")
      .filter({ hasText: "Reviewed latest company hierarchy and group" });
    await expect(event).toBeVisible();
    await event
      .getByText("View hierarchy change details", { exact: true })
      .click();
    await expect(event).toContainText(group.id);
    await expect(event).toContainText(reference);
    const rows = (
      await work.db.query(
        "SELECT before_state,after_state,actor_id FROM eoms.hierarchy_history WHERE record_id=$1 AND request_id=$2",
        [company.id, reference],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].before_state.groupId).toBeNull();
    expect(rows[0].after_state.groupId).toBe(group.id);
    expect(rows[0].actor_id).toBe(actor.id);
    const supervisor = (
        await work.db.query(
          "SELECT id FROM eoms.users WHERE email='supervisor@eoms.local'",
        )
      ).rows[0],
      other = token();
    await work.db.query(
      "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(other), supervisor.id, token()],
    );
    expect(
      (
        await page.request.get(
          `/api/navigation/customers?selectedId=${own.id}`,
          { headers: { Cookie: "eoms_session=" + other } },
        )
      ).status(),
    ).toBe(404);
  });
});
