import { test, expect, estateId } from "./fixtures";
import { hash, token } from "../../apps/api/src/security";
test("E2E-JRN-02-006 @regression independent movement and safe area lifecycle", async ({
  page,
  browser,
  work,
}) => {
  // This journey tests authorized operations, not login. Keep unchanged login rate limits.
  const suffix = Date.now().toString(36).toUpperCase(),
    actors = (
      await work.db.query(
        "SELECT id,email,display_name FROM eoms.users WHERE email IN ('manager@eoms.local','reviewer@eoms.local')",
      )
    ).rows;
  const manager = actors.find((a) => a.email === "manager@eoms.local"),
    reviewer = actors.find((a) => a.email === "reviewer@eoms.local");
  expect(manager.id).not.toBe(reviewer.id);
  const scope = (
    await work.db.query(
      "SELECT customer_id,company_id FROM eoms.estates WHERE id=$1",
      [estateId],
    )
  ).rows[0];
  const own = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,$4) RETURNING id,company_id",
      [
        scope.customer_id,
        scope.company_id,
        "MV-" + suffix,
        "Movement journey " + suffix,
      ],
    )
  ).rows[0];
  for (const actor of [manager, reviewer])
    await work.db.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [actor.id, own.id],
    );
  async function session(context: any, id: string) {
    const raw = token(),
      csrf = token();
    await work.db.query(
      "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(raw), id, csrf],
    );
    await context.addCookies([
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
    return csrf;
  }
  const csrf = await session(page.context(), manager.id);
  await page.goto("/");
  await expect(page.locator("header")).toContainText(manager.display_name);
  expect(
    (await (await page.request.get("/api/auth/session")).json()).user.id,
  ).toBe(manager.id);
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const placement = page.getByRole("region", {
      name: "Operating placement",
      exact: true,
    }),
    gate = placement.getByRole("region", {
      name: "Movement and area lifecycle",
      exact: true,
    });
  const headers = { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf };
  async function post(path: string, data: object) {
    return page.request.post("/api" + path, { headers, data });
  }
  async function list() {
    const r = await page.request.get(
      `/api/customers/${scope.customer_id}/placements`,
    );
    expect(r.status()).toBe(200);
    return r.json();
  }
  let source: any,
    target: any,
    requestId = "";
  async function refresh() {
    await placement
      .getByRole("button", { name: "Refresh placement lists", exact: true })
      .click();
    await expect(
      placement.getByRole("button", {
        name: "Refresh placement lists",
        exact: true,
      }),
    ).toBeEnabled();
  }
  async function availability(area: any, reason: string) {
    await gate
      .getByLabel("Lifecycle area", { exact: true })
      .selectOption(area.id);
    await gate.getByLabel("Lifecycle reason", { exact: true }).fill(reason);
  }
  await test.step("Request a move and retain current placement until independent review", async () => {
    for (const [code, name] of [
      ["MS-", "Movement source"],
      ["MT-", "Movement target"],
    ]) {
      const r = await post(`/customers/${scope.customer_id}/areas`, {
        kind: "business-unit",
        code: code + suffix,
        name: name + " " + suffix,
        parentId: null,
        reason: "Prepare movement journey",
      });
      expect(r.status()).toBe(201);
      const area = await r.json();
      if (code === "MS-") source = area;
      else target = area;
    }
    expect(
      (
        await post(`/estates/${own.id}/placement`, {
          areaId: source.id,
          version: 1,
          reason: "Initial movement placement",
        })
      ).status(),
    ).toBe(200);
    await refresh();
    await gate.getByLabel("Move estate", { exact: true }).selectOption(own.id);
    await gate
      .getByLabel("Move destination", { exact: true })
      .selectOption(target.id);
    await gate
      .getByLabel("Move reason", { exact: true })
      .fill("Reviewed organizational reassignment");
    await gate
      .getByRole("button", { name: "Request estate move", exact: true })
      .click();
    await expect(
      gate.getByRole("status").filter({ hasText: "Move requested." }),
    ).toContainText("Current placement is unchanged");
    await expect(gate).toContainText(
      "You cannot review your own move request.",
    );
    const rows = await (
      await page.request.get(
        `/api/customers/${scope.customer_id}/placement-moves`,
      )
    ).json();
    const item = rows.items.find((q: any) => q.estate_id === own.id);
    requestId = item.id;
    expect(item.decision).toBeNull();
    expect(
      (await list()).estates.find((e: any) => e.id === own.id).area_id,
    ).toBe(source.id);
    expect(
      (
        await post(`/estates/${own.id}/placement-moves/${requestId}/decision`, {
          decision: "approved",
          version: 2,
          reason: "Self review prohibited",
        })
      ).status(),
    ).toBe(403);
  });
  await test.step("Block area deactivation with retained reason and support reference", async () => {
    const reason = "Cannot deactivate assigned source";
    await availability(source, reason);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/areas/${source.id}/lifecycle`) &&
        r.request().method() === "POST",
    );
    await gate
      .getByRole("button", { name: "Deactivate area", exact: true })
      .click();
    expect((await response).status()).toBe(409);
    await expect(gate.getByRole("alert")).toContainText(
      "Move all assigned estates",
    );
    await expect(gate.getByRole("alert")).toContainText("Support reference");
    await expect(
      gate.getByLabel("Lifecycle reason", { exact: true }),
    ).toHaveValue(reason);
    expect(
      (await list()).areas.find((a: any) => a.id === source.id).active,
    ).toBe(true);
  });
  await test.step("Independent approval moves estate and preserves legal identity with audit references", async () => {
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize()!,
    });
    try {
      await session(context, reviewer.id);
      const review = await context.newPage();
      await review.goto("/");
      await expect(review.locator("header")).toContainText(
        reviewer.display_name,
      );
      expect(
        (await (await review.request.get("/api/auth/session")).json()).user.id,
      ).toBe(reviewer.id);
      await review
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      const panel = review.getByRole("region", {
        name: "Movement and area lifecycle",
        exact: true,
      });
      await panel
        .getByLabel("Move request", { exact: true })
        .selectOption(requestId);
      await panel
        .getByLabel("Move decision", { exact: true })
        .selectOption("approved");
      await panel
        .getByLabel("Move review reason", { exact: true })
        .fill("Independent destination and access reviewed");
      await panel
        .getByRole("button", { name: "Record move decision", exact: true })
        .click();
      await expect(
        panel
          .getByRole("status")
          .filter({ hasText: "Independent move decision saved." }),
      ).toHaveText("Independent move decision saved.");
      const event = panel.locator(`[data-move-request-id="${requestId}"]`);
      await event.getByText("View move audit details", { exact: true }).click();
      await expect(event).toContainText(manager.display_name);
      await expect(event).toContainText(reviewer.display_name);
      const rows = await (
          await review.request.get(
            `/api/customers/${scope.customer_id}/placement-moves`,
          )
        ).json(),
        item = rows.items.find((q: any) => q.id === requestId);
      expect(item.decision).toBe("approved");
      await expect(event).toContainText(item.request_id);
      await expect(event).toContainText(item.decision_request_id);
      const saved = (await list()).estates.find((e: any) => e.id === own.id);
      expect(saved.area_id).toBe(target.id);
      expect(saved.company_id).toBe(own.company_id);
      expect(saved.placement_version).toBe(3);
    } finally {
      await context.close();
    }
  });
  await test.step("Deactivate emptied source prevent reuse and reactivate with lifecycle history", async () => {
    await refresh();
    await availability(source, "Deactivate vacated operating area");
    await gate
      .getByRole("button", { name: "Deactivate area", exact: true })
      .click();
    await expect(
      gate.getByRole("status").filter({ hasText: "Area availability saved." }),
    ).toHaveText("Area availability saved.");
    await expect(
      placement.locator(`[data-area-code="${source.code}"]`),
    ).toContainText("Inactive");
    await gate.getByLabel("Move estate", { exact: true }).selectOption(own.id);
    await expect(
      gate
        .getByLabel("Move destination", { exact: true })
        .locator(`option[value="${source.id}"]`),
    ).toHaveCount(0);
    const denied = await post(`/estates/${own.id}/placement-moves`, {
      toAreaId: source.id,
      version: 3,
      reason: "Inactive destination denied",
    });
    expect(denied.status()).toBe(409);
    await availability(source, "Restore vacated area for future planning");
    await gate
      .getByRole("button", { name: "Reactivate area", exact: true })
      .click();
    await expect(
      gate.getByRole("status").filter({ hasText: "Area availability saved." }),
    ).toHaveText("Area availability saved.");
    await expect(
      placement.locator(`[data-area-code="${source.code}"]`),
    ).toContainText("Active");
    const history = await (
      await page.request.get(
        `/api/customers/${scope.customer_id}/hierarchy/history`,
      )
    ).json();
    const events = history.items.filter(
      (h: any) => h.record_id === source.id && h.action === "updated",
    );
    expect(
      events.some(
        (h: any) => h.before.active === true && h.after.active === false,
      ),
    ).toBe(true);
    expect(
      events.some(
        (h: any) => h.before.active === false && h.after.active === true,
      ),
    ).toBe(true);
    const recent = placement
      .locator(`[data-placement-record-id="${source.id}"]`)
      .filter({ hasText: "Restore vacated area for future planning" });
    await recent
      .getByText("View placement change details", { exact: true })
      .click();
    await expect(recent).toContainText("Inactive → Active");
    await expect(recent).toContainText(events[0].request_id);
  });
});
