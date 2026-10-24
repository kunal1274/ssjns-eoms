import { test, expect } from "./fixtures";
import { request as apiRequest } from "@playwright/test";
import { hash, token } from "../../apps/api/src/security";
import { seedDecisionLedger } from "../ledger-fixture";
test("E2E-JRN-02-013 @regression older decision ledgers connect correction and independent review", async ({
  page,
  work,
}) => {
  test.setTimeout(120000); // Real reasoned fixture writes plus three complete review journeys.
  const actors = (
    await work.db.query(
      "SELECT id,email FROM eoms.users WHERE email IN ('manager@eoms.local','reviewer@eoms.local')",
    )
  ).rows;
  const manager = actors.find((a) => a.email === "manager@eoms.local"),
    reviewer = actors.find((a) => a.email === "reviewer@eoms.local");
  const sessions: any = {};
  for (const [name, actor] of [
    ["manager", manager],
    ["reviewer", reviewer],
  ] as const) {
    const raw = token(),
      csrf = token();
    await work.db.query(
      "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(raw), actor.id, csrf],
    );
    sessions[name] = {
      raw,
      csrf,
      actor,
      api: await apiRequest.newContext({
        baseURL: "http://127.0.0.1:4210",
        extraHTTPHeaders: {
          Origin: "http://localhost:5284",
          "X-CSRF-Token": csrf,
          Cookie: `eoms_session=${raw}`,
        },
      }),
    };
  }
  let f: any;
  try {
    f = await seedDecisionLedger(
      work.db,
      manager.id,
      reviewer.id,
      async (actor, path, data) => {
        const r = await sessions[actor].api.post("/api" + path, { data });
        expect([200, 201], path + " " + (await r.text())).toContain(r.status());
        return r.json();
      },
    );
    async function sign(name: string) {
      await page.context().clearCookies();
      await page.context().addCookies([
        {
          name: "eoms_session",
          value: sessions[name].raw,
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
      ).toBe(sessions[name].actor.id);
    }
    const legal = page.getByRole("region", {
      name: "Estate responsibility",
      exact: true,
    });
    const governance = page.getByRole("region", {
      name: "Responsibility cancellation review",
      exact: true,
    });
    const movement = page.getByRole("region", {
      name: "Movement and area lifecycle",
      exact: true,
    });
    const ledger = (name: string) =>
      page.getByRole("region", { name, exact: true });
    async function find(region: any, label: string, q: string) {
      await region.getByLabel("Search " + label, { exact: true }).fill(q);
      await region
        .getByRole("button", { name: "Find " + label, exact: true })
        .click();
    }
    async function open() {
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      const guide = page.getByRole("region", {
        name: "Organization guide",
        exact: true,
      });
      await find(guide, "Customer", f.code);
      await guide
        .getByLabel("Customer", { exact: true })
        .selectOption(f.customer);
      await legal
        .getByLabel("Responsibility estate", { exact: true })
        .selectOption(f.own.id);
      await expect(legal.getByText(/History revision: 5[67]/)).toBeVisible();
    }
    await sign("manager");
    await open();
    await test.step("Page older responsibility cancellation and move history with actual audit provenance", async () => {
      for (const [name, row] of [
        ["Responsibility ledger", f.responsibilities[1]],
        ["Cancellation ledger", f.cancellations[1]],
        ["Move ledger", f.moves[1]],
      ] as const) {
        const panel = ledger(name);
        await expect(panel.locator("[data-ledger-record]")).toHaveCount(25);
        await panel
          .getByRole("button", { name: "More " + name, exact: true })
          .click();
        await expect(panel.locator("[data-ledger-record]")).toHaveCount(50);
        await expect(
          panel.locator(`[data-ledger-record="${row.id}"]`),
        ).toHaveCount(0);
        await find(panel, name, row.id);
        const event = panel.locator(`[data-ledger-record="${row.id}"]`);
        await expect(event).toBeVisible();
        await event
          .getByText("View ledger audit details", { exact: true })
          .click();
        await expect(event).toContainText(row.request_id);
        await expect(event).toContainText(manager.id);
        if (name !== "Responsibility ledger")
          await expect(event).toContainText(reviewer.id);
      }
      const summary = await (
        await page.request.get(`/api/estates/${f.own.id}/responsibility`)
      ).json();
      expect(
        summary.items.some((r: any) => r.id === summary.lastActive.id),
      ).toBe(false);
      expect(summary.lastActive.id).toBe(f.responsibilities[0].id);
    });
    const draftReason =
      "Retain older correction fields during a failed ledger page";
    await test.step("Retry a failed older ledger page while retaining the linked correction draft", async () => {
      await ledger("Responsibility ledger")
        .locator(`[data-ledger-record="${f.responsibilities[1].id}"]`)
        .getByRole("button", { name: "Use for correction", exact: true })
        .click();
      await expect(
        legal.getByLabel("Correction source", { exact: true }),
      ).toBeFocused();
      await find(legal, "Correction source", f.responsibilities[1].id);
      await legal
        .getByLabel("Correction source", { exact: true })
        .selectOption(f.responsibilities[1].id);
      await find(legal, "Next responsible company", "Ledger baseline company");
      await legal
        .getByLabel("Next responsible company", { exact: true })
        .selectOption(f.company);
      await legal
        .getByLabel("Responsibility effective date", { exact: true })
        .fill(f.responsibilities[1].effective_from);
      await legal
        .getByLabel("Responsibility reason", { exact: true })
        .fill(draftReason);
      const panel = ledger("Responsibility ledger");
      await find(panel, "Responsibility ledger", "");
      await expect(panel.locator("[data-ledger-record]")).toHaveCount(25);
      const pattern = `**/api/navigation/estates/${f.own.id}/responsibilities?**`;
      await page.route(pattern, (route) =>
        new URL(route.request().url()).searchParams.has("cursor")
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: "private storage failure",
                requestId: "ca114c55-473b-442a-bec8-101010101010",
              }),
            })
          : route.continue(),
      );
      await panel
        .getByRole("button", {
          name: "More Responsibility ledger",
          exact: true,
        })
        .click();
      await expect(panel.getByRole("alert")).toContainText("Support reference");
      await expect(panel.getByRole("alert")).not.toContainText(
        "private storage",
      );
      await expect(panel.locator("[data-ledger-record]")).toHaveCount(25);
      await expect(
        legal.getByLabel("Responsibility reason", { exact: true }),
      ).toHaveValue(draftReason);
      await expect(
        legal.getByLabel("Correction source", { exact: true }),
      ).toHaveValue(f.responsibilities[1].id);
      await page.unroute(pattern);
      await panel
        .getByRole("button", {
          name: "Retry Responsibility ledger",
          exact: true,
        })
        .click();
      await expect(panel.locator("[data-ledger-record]")).toHaveCount(50);
      await expect(
        legal.getByLabel("Responsibility reason", { exact: true }),
      ).toHaveValue(draftReason);
    });
    await test.step("Save an older approved-cancelled correction with immutable lineage and current eligibility", async () => {
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/estates/${f.own.id}/responsibility`) &&
          r.request().method() === "POST",
      );
      await legal
        .getByRole("button", {
          name: "Save responsibility change",
          exact: true,
        })
        .click();
      const r = await response;
      expect(r.status()).toBe(201);
      const saved = await r.json();
      expect(saved.revision).toBe(57);
      await expect(
        legal
          .getByRole("status")
          .filter({ hasText: "Responsibility change saved." }),
      ).toBeVisible();
      const panel = ledger("Responsibility ledger");
      await find(panel, "Responsibility ledger", saved.id);
      const event = panel.locator(`[data-ledger-record="${saved.id}"]`);
      await event
        .getByText("View ledger audit details", { exact: true })
        .click();
      await expect(event).toContainText(f.responsibilities[1].id);
      await expect(event).toContainText(saved.request_id);
      const used = await (
        await page.request.get(
          `/api/navigation/estates/${f.own.id}/responsibilities?purpose=choice&status=cancelled&selectedId=${f.responsibilities[1].id}`,
        )
      ).json();
      expect(used.selected.eligible).toBe(false);
      const stored = (
        await work.db.query(
          "SELECT replaces_responsibility_id FROM eoms.estate_responsibilities WHERE id=$1",
          [saved.id],
        )
      ).rows[0];
      expect(stored.replaces_responsibility_id).toBe(f.responsibilities[1].id);
    });
    await test.step("Review an older pending cancellation independently and retain reason after stale approval", async () => {
      const own = await sessions.manager.api.get(
        `/api/navigation/estates/${f.own.id}/cancellations?purpose=choice&selectedId=${f.cancellations[0].id}`,
      );
      expect((await own.json()).selected.eligible).toBe(false);
      await sign("reviewer");
      await open();
      const panel = ledger("Cancellation ledger");
      await find(panel, "Cancellation ledger", f.cancellations[0].id);
      await panel
        .locator(`[data-ledger-record="${f.cancellations[0].id}"]`)
        .getByRole("button", { name: "Review cancellation", exact: true })
        .click();
      await expect(
        governance.getByLabel("Cancellation request", { exact: true }),
      ).toBeFocused();
      await expect(
        governance.getByLabel("Cancellation request", { exact: true }),
      ).toHaveValue(f.cancellations[0].id);
      await governance
        .getByLabel("Cancellation decision", { exact: true })
        .selectOption("approved");
      await governance
        .getByLabel("Independent review reason", { exact: true })
        .fill("Retain reason after stale timeline approval");
      await governance
        .getByRole("button", {
          name: "Record independent decision",
          exact: true,
        })
        .click();
      await expect(governance.getByRole("alert")).toContainText(
        "Responsibility history changed",
      );
      await expect(
        governance.getByLabel("Independent review reason", { exact: true }),
      ).toHaveValue("Retain reason after stale timeline approval");
      await governance
        .getByLabel("Cancellation decision", { exact: true })
        .selectOption("rejected");
      await governance
        .getByLabel("Independent review reason", { exact: true })
        .fill("Reject stale older request independently");
      await governance
        .getByRole("button", {
          name: "Record independent decision",
          exact: true,
        })
        .click();
      await expect(
        governance
          .getByRole("status")
          .filter({ hasText: "Independent decision recorded." }),
      ).toBeVisible();
      await expect(
        panel.locator(`[data-ledger-record="${f.cancellations[0].id}"]`),
      ).toContainText("rejected");
      await panel
        .locator(`[data-ledger-record="${f.cancellations[0].id}"]`)
        .getByText("View ledger audit details", { exact: true })
        .click();
      await expect(panel).toContainText(reviewer.id);
    });
    await test.step("Approve an older move through ledger handoff with estate version and independent audit", async () => {
      const panel = ledger("Move ledger");
      await find(panel, "Move ledger", f.moves[0].id);
      await panel
        .locator(`[data-ledger-record="${f.moves[0].id}"]`)
        .getByRole("button", { name: "Review move", exact: true })
        .click();
      await expect(
        movement.getByLabel("Move request", { exact: true }),
      ).toBeFocused();
      await expect(
        movement.getByLabel("Move request", { exact: true }),
      ).toHaveValue(f.moves[0].id);
      await movement
        .getByLabel("Move decision", { exact: true })
        .selectOption("approved");
      await movement
        .getByLabel("Move review reason", { exact: true })
        .fill("Independent older move reviewed against current estate");
      await movement
        .getByRole("button", { name: "Record move decision", exact: true })
        .click();
      await expect(
        movement
          .getByRole("status")
          .filter({ hasText: "Independent move decision saved." }),
      ).toBeVisible();
      const event = panel.locator(`[data-ledger-record="${f.moves[0].id}"]`);
      await expect(event).toContainText("approved");
      await event
        .getByText("View ledger audit details", { exact: true })
        .click();
      await expect(event).toContainText(reviewer.id);
      await expect(event).toContainText(f.area.id);
      expect(
        (
          await work.db.query(
            "SELECT area_id,placement_version FROM eoms.estates WHERE id=$1",
            [f.own.id],
          )
        ).rows[0],
      ).toEqual({ area_id: f.area.id, placement_version: 2 });
    });
    await test.step("Recheck access on ledger refresh after membership revocation", async () => {
      await work.db.query(
        "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
        [reviewer.id, f.own.id],
      );
      const panel = ledger("Cancellation ledger");
      await panel
        .getByRole("button", {
          name: "Refresh Cancellation ledger",
          exact: true,
        })
        .click();
      await expect(panel.getByRole("alert")).toContainText("Support reference");
      await expect(panel.locator("[data-ledger-record]")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  } finally {
    for (const s of Object.values(sessions) as any[]) await s.api.dispose();
  }
});
