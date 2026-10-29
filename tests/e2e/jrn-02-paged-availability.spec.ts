import { test, expect, chooseEstate, estateId } from "./fixtures";
import { hash, token } from "../../apps/api/src/security";
test("E2E-JRN-02-012 @regression paged availability and estate context retain reviewed changes", async ({
  page,
  work,
}) => {
  const code = "PA-" + Date.now().toString(36).toUpperCase();
  const actor = (
    await work.db.query(
      "SELECT id FROM eoms.users WHERE email='manager@eoms.local'",
    )
  ).rows[0];
  const customer = (
    await work.db.query(
      "INSERT INTO eoms.customers(code,name) VALUES($1,$2) RETURNING id",
      [code, "ZZZZ Paged availability " + code],
    )
  ).rows[0].id;
  const company = (
    await work.db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Availability company') RETURNING id",
      [customer],
    )
  ).rows[0].id;
  const estates = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) SELECT $1,$2,$3||'-'||lpad(i::text,3,'0'),'ZZZZ Availability '||$3||' '||lpad(i::text,3,'0') FROM generate_series(1,201) i RETURNING id,code,name",
      [customer, company, code],
    )
  ).rows;
  const own = estates.find((e) => e.code.endsWith("-201"));
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) SELECT $1,id,'manager' FROM eoms.estates WHERE customer_id=$2",
    [actor.id, customer],
  );
  await work.db.query(
    "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
    [customer, actor.id],
  );
  const units = (
    await work.db.query(
      "INSERT INTO eoms.operating_units(customer_id,estate_id,kind,code,name) SELECT $1,$2,'division','AU-'||lpad(i::text,3,'0'),'Availability unit '||i FROM generate_series(1,501) i RETURNING id,code,name",
      [customer, own.id],
    )
  ).rows;
  const deep = units.find((u) => u.code === "AU-501");
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
  const panel = page.getByRole("region", {
    name: "Estate and unit availability",
    exact: true,
  });
  const headers = { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf };
  const base = `/api/estates/${own.id}`;
  async function find(label: string, q: string) {
    await panel.getByLabel("Search " + label, { exact: true }).fill(q);
    await panel
      .getByRole("button", { name: "Find " + label, exact: true })
      .click();
  }
  const current = () => panel.getByText(/^Current:/);
  const saved = () =>
    panel.getByRole("status").filter({ hasText: "Availability saved." });
  async function chooseUnit() {
    await find("Availability unit", deep.code);
    await panel
      .getByLabel("Availability unit", { exact: true })
      .selectOption(deep.id);
    await expect(
      panel.getByRole("button", {
        name: "Load selected Availability unit",
        exact: true,
      }),
    ).toBeEnabled();
  }
  await chooseEstate(page, estateId);
  await test.step("Search and page assigned estates then retain a deep header selection after reload", async () => {
    await page.getByLabel("Search Estate", { exact: true }).fill(code);
    await page
      .getByRole("button", { name: "Find Estate", exact: true })
      .click();
    const select = page.getByLabel("Estate", { exact: true });
    await expect(select.locator("option")).toHaveCount(27); // 25 rows + existing pin + placeholder
    await page
      .getByRole("button", { name: "More Estate", exact: true })
      .click();
    await expect(select.locator("option")).toHaveCount(52);
    await chooseEstate(page, own.id);
    await expect(page.locator("header .role")).toHaveText("manager");
    await page.reload();
    await expect(select).toHaveValue(own.id);
    await expect(
      page.getByRole("button", { name: "+ New muster", exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get(base + "/lifecycle")).json()).units.some(
        (u: any) => u.id === deep.id,
      ),
    ).toBe(false);
  });
  await test.step("Reach deep availability records and retain reason through correlated search recovery", async () => {
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    const guide = page.getByRole("region", {
      name: "Organization guide",
      exact: true,
    });
    await guide.getByLabel("Search Customer", { exact: true }).fill(code);
    await guide
      .getByRole("button", { name: "Find Customer", exact: true })
      .click();
    await guide.getByLabel("Customer", { exact: true }).selectOption(customer);
    await find("Availability estate", own.code);
    await panel
      .getByLabel("Availability estate", { exact: true })
      .selectOption(own.id);
    await expect(panel.locator("[data-estate-availability]")).toContainText(
      "Version 1",
    );
    await chooseUnit();
    await expect(current()).toContainText("Version 1");
    await panel
      .getByLabel("Unit availability reason", { exact: true })
      .fill("Keep this reason during search recovery");
    await page.route(`**/api/navigation/estates/${own.id}/units?**`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "X-Request-ID": "f27109c0-4eac-4442-8a75-101010101010" },
        body: JSON.stringify({
          error: "private storage failure",
          requestId: "f27109c0-4eac-4442-8a75-101010101010",
        }),
      }),
    );
    await find("Availability unit", "no match here");
    await expect(panel.getByRole("alert")).toContainText("Support reference");
    await expect(panel.getByRole("alert")).not.toContainText("private storage");
    await expect(
      panel.getByLabel("Unit availability reason", { exact: true }),
    ).toHaveValue("Keep this reason during search recovery");
    await expect(
      panel.getByRole("button", { name: "Deactivate unit", exact: true }),
    ).toBeDisabled();
    await page.unroute(`**/api/navigation/estates/${own.id}/units?**`);
    await panel
      .getByRole("button", { name: "Retry Availability unit", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Deactivate unit", exact: true }),
    ).toBeEnabled();
    await expect(
      panel.getByLabel("Availability unit", { exact: true }),
    ).toHaveValue(deep.id);
    await expect(
      panel.getByLabel("Unit availability reason", { exact: true }),
    ).toHaveValue("Keep this reason during search recovery");
  });
  await test.step("Reject stale availability without replacing reviewed state until explicit reload", async () => {
    const external = await page.request.post(
      `${base}/units/${deep.id}/lifecycle`,
      {
        headers,
        data: {
          active: false,
          version: 1,
          reason: "Independent availability revision",
        },
      },
    );
    expect(external.status()).toBe(200);
    await panel
      .getByRole("button", { name: "Deactivate unit", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "Availability changed",
    );
    await find("Availability unit", deep.code);
    await expect(
      panel.getByRole("button", {
        name: "Load selected Availability unit",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(current()).toContainText("Current: Active · Version 1");
    await expect(
      panel.getByLabel("Unit availability reason", { exact: true }),
    ).toHaveValue("Keep this reason during search recovery");
    await panel
      .getByRole("button", {
        name: "Load selected Availability unit",
        exact: true,
      })
      .click();
    await expect(current()).toContainText("Current: Inactive · Version 2");
    await expect(
      panel.getByLabel("Unit availability reason", { exact: true }),
    ).toHaveValue("");
    await panel
      .getByLabel("Unit availability reason", { exact: true })
      .fill("Resume after explicit version review");
    await panel
      .getByRole("button", { name: "Reactivate unit", exact: true })
      .click();
    await expect(saved()).toContainText("History and work safeguards updated");
    await expect(current()).toContainText("Version 3");
    const event = panel
      .locator(`[data-lifecycle-record-id="${deep.id}"]`)
      .first();
    await event
      .getByText("View availability audit details", { exact: true })
      .click();
    await expect(event).toContainText("Inactive → Active");
    const state = await (await page.request.get(base + "/lifecycle")).json();
    await expect(event).toContainText(state.history[0].request_id);
  });
  await test.step("Block duplicate changes after acknowledged save refresh failure and recover explicitly", async () => {
    await page.route(`**${base}/lifecycle`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              requestId: "f27109c0-4eac-4442-8a75-202020202020",
            }),
          })
        : route.continue(),
    );
    await panel
      .getByLabel("Unit availability reason", { exact: true })
      .fill("Pause once despite refresh loss");
    await panel
      .getByRole("button", { name: "Deactivate unit", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "Change saved, but refresh failed",
    );
    await expect(
      panel.getByRole("button", { name: "Reactivate unit", exact: true }),
    ).toBeDisabled();
    await page.unroute(`**${base}/lifecycle`);
    const row = (
      await work.db.query(
        "SELECT active,version FROM eoms.operating_units WHERE id=$1",
        [deep.id],
      )
    ).rows[0];
    expect(row).toEqual({ active: false, version: 4 });
    await panel
      .getByRole("button", { name: "Refresh availability", exact: true })
      .click();
    await expect(panel.locator("[data-estate-availability]")).toBeVisible();
    await chooseUnit();
    await expect(current()).toContainText("Version 4");
    await panel
      .getByLabel("Unit availability reason", { exact: true })
      .fill("Resume after authoritative refresh");
    await panel
      .getByRole("button", { name: "Reactivate unit", exact: true })
      .click();
    await expect(saved()).toBeVisible();
    await expect(current()).toContainText("Version 5");
    expect(
      (
        await work.db.query(
          "SELECT count(*)::int AS n FROM eoms.hierarchy_history WHERE record_id=$1 AND record_type='unit-lifecycle'",
          [deep.id],
        )
      ).rows[0].n,
    ).toBe(4);
  });
  await test.step("Keep an inactive estate selected across navigation and restore its work guidance", async () => {
    await panel
      .getByLabel("Estate availability reason", { exact: true })
      .fill("Pause estate after paged unit review");
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
    await page
      .getByLabel("Search Estate", { exact: true })
      .fill("no matching estate");
    await page
      .getByRole("button", { name: "Find Estate", exact: true })
      .click();
    await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
      own.id,
    );
    await page.reload();
    await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
      own.id,
    );
    await expect(
      page.getByRole("note", { name: "Work availability", exact: true }),
    ).toContainText("Estate inactive");
    const resumed = await page.request.post(base + "/lifecycle", {
      headers,
      data: {
        active: true,
        version: 2,
        reason: "Resume verified availability journey",
      },
    });
    expect(resumed.status()).toBe(200);
    await page
      .getByRole("button", { name: "Refresh work availability", exact: true })
      .click();
    await expect(
      page.getByRole("note", { name: "Work availability", exact: true }),
    ).toContainText("Estate active");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
  await test.step("Deny a revoked preferred estate without silently choosing another context", async () => {
    await work.db.query(
      "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
      [actor.id, own.id],
    );
    await page.reload();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Selected estate is not available" }),
    ).toBeVisible();
    await expect(page.getByLabel("Estate", { exact: true })).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "+ New muster", exact: true }),
    ).toHaveCount(0);
    await chooseEstate(page, estateId);
    await expect(page.getByLabel("Estate", { exact: true })).toHaveValue(
      estateId,
    );
    await expect(page.locator("header .role")).toHaveText("manager");
  });
});
