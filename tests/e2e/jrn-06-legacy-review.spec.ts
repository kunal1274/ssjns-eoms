import type { BrowserContext } from "@playwright/test";
import { test, expect, chooseEstate } from "./fixtures";
import { MusterPage } from "./pages/MusterPage";
import { randomUUID } from "node:crypto";

test("E2E-JRN-06-002 @regression review unresolved task attribution with safe linking audit and scope recovery", async ({
  page,
  context,
  setupAdmin,
  supervisor,
  muster,
  work,
}) => {
  const suffix = randomUUID().slice(0, 8).toUpperCase(),
    code = "LEG-" + suffix;
  let customer = "",
    estate = "",
    manager = "",
    viewer: BrowserContext | undefined;
  try {
    await muster.signIn(setupAdmin);
    const session = await (await page.request.get("/api/auth/session")).json();
    manager = session.user.id;
    const supervisorId = (
      await work.db.query(
        "SELECT id FROM eoms.users WHERE email='supervisor@eoms.local'",
      )
    ).rows[0].id;
    customer = (
      await work.db.query(
        "INSERT INTO eoms.customers(code,name) VALUES($1,'ZZZZ legacy journey fixture') RETURNING id",
        [code],
      )
    ).rows[0].id;
    const company = (
      await work.db.query(
        "INSERT INTO eoms.companies(customer_id,name) VALUES($1,'Legacy journey company') RETURNING id",
        [customer],
      )
    ).rows[0].id;
    estate = (
      await work.db.query(
        "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Legacy journey estate') RETURNING id",
        [customer, company, code],
      )
    ).rows[0].id;
    for (const [actor, role] of [
      [manager, "manager"],
      [supervisorId, "supervisor"],
    ])
      await work.db.query(
        "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,$3)",
        [actor, estate, role],
      );
    await work.db.query(
      "INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES($1,$2)",
      [customer, manager],
    );
    const base = `/api/estates/${estate}`;
    async function post(url: string, data: any) {
      const r = await page.request.post(url, {
        headers: {
          Origin: "http://localhost:5284",
          "X-CSRF-Token": session.csrf,
        },
        data,
      });
      expect([200, 201]).toContain(r.status());
      return r.json();
    }
    const division = await post(base + "/units", {
      kind: "division",
      code: code + "-D",
      name: "Legacy review division",
      parentId: null,
      reason: "Prepare review journey",
    });
    const block = await post(base + "/units", {
      kind: "block",
      code: code + "-B",
      name: "Reviewed journey block",
      parentId: division.id,
      reason: "Prepare exact matching review block",
    });
    const tasks = (
      await work.db.query(
        "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) SELECT $1,$2,$3||'-'||i::text,'Review %_ task','R',2 FROM generate_series(1,30) i RETURNING *",
        [estate, block.code, code],
      )
    ).rows;
    const target = tasks[0];
    await chooseEstate(page, estate);
    await page
      .getByRole("button", { name: "Task capacity", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Open legacy attribution review",
        exact: true,
      })
      .click();
    const panel = page.getByRole("region", {
      name: "Legacy attribution review",
      exact: true,
    });
    const form = panel.getByRole("form", {
      name: "Review legacy block link",
      exact: true,
    });
    async function find(term: string) {
      await panel
        .getByLabel("Search legacy records", { exact: true })
        .fill(term);
      await panel
        .getByRole("button", { name: "Find legacy records", exact: true })
        .click();
    }
    await test.step("Page unresolved tasks and retry a failed page while retaining the reviewed mapping draft", async () => {
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(25);
      await find(target.id);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(1);
      await panel
        .getByRole("button", { name: "Review task", exact: true })
        .click();
      await expect(panel.locator("[data-legacy-review]")).toContainText(
        "Version 1",
      );
      await panel
        .getByRole("button", {
          name: "Review matching block link",
          exact: true,
        })
        .click();
      await form
        .getByLabel("Matching configured block", { exact: true })
        .selectOption(block.id);
      await form
        .getByLabel("Link review reason", { exact: true })
        .fill("Reviewed exact block source mapping");
      await find(code);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(25);
      let fail = true;
      const pattern = `**/api/estates/${estate}/legacy-review/tasks?**`;
      await page.route(pattern, (route) =>
        fail && new URL(route.request().url()).searchParams.has("cursor")
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: "private review page diagnostic",
                requestId: "11111111-4000-4000-8000-000000000004",
              }),
            })
          : route.continue(),
      );
      await panel
        .getByRole("button", { name: "More legacy records", exact: true })
        .click();
      await expect(
        panel.getByRole("button", {
          name: "Retry legacy records",
          exact: true,
        }),
      ).toBeVisible();
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(25);
      await expect(
        form.getByLabel("Link review reason", { exact: true }),
      ).toHaveValue("Reviewed exact block source mapping");
      await expect(panel).not.toContainText("private review page diagnostic");
      fail = false;
      await panel
        .getByRole("button", { name: "Retry legacy records", exact: true })
        .click();
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(30);
      await page.unroute(pattern);
    });
    await test.step("Recover a real stale task version and a committed link whose refresh fails without duplicate writes", async () => {
      await post(base + "/occurrences/" + target.id, {
        capacityHa: 3,
        version: 1,
      });
      await form
        .getByRole("button", { name: "Confirm block link", exact: true })
        .click();
      await expect(form.getByRole("alert")).toContainText("Task changed");
      await expect(
        form.getByLabel("Link review reason", { exact: true }),
      ).toHaveValue("Reviewed exact block source mapping");
      await form
        .getByRole("button", { name: "Close link review", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Refresh reviewed task", exact: true })
        .click();
      await expect(panel.locator("[data-legacy-review]")).toContainText(
        "Version 2",
      );
      await panel
        .getByRole("button", {
          name: "Review matching block link",
          exact: true,
        })
        .click();
      await form
        .getByLabel("Matching configured block", { exact: true })
        .selectOption(block.id);
      await form
        .getByLabel("Link review reason", { exact: true })
        .fill("Approved exact block mapping after fresh review");
      const pattern = `**/api/estates/${estate}/legacy-review/tasks/${target.id}`;
      await page.route(
        pattern,
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "private post-save refresh failure",
            }),
          }),
        { times: 1 },
      );
      await form
        .getByRole("button", { name: "Confirm block link", exact: true })
        .click();
      await expect(form.getByRole("alert")).toContainText(
        "Link saved, but refreshing failed",
      );
      await expect(
        form.getByRole("button", { name: "Confirm block link", exact: true }),
      ).toBeDisabled();
      const count = async () =>
        (
          await work.db.query(
            "SELECT count(*)::int AS n FROM eoms.hierarchy_history WHERE record_type='task-link' AND record_id=$1",
            [target.id],
          )
        ).rows[0].n;
      expect(await count()).toBe(1);
      await form
        .getByRole("button", { name: "Refresh saved task", exact: true })
        .click();
      await expect(form).toHaveCount(0);
      await expect(panel.locator("[data-legacy-review]")).toContainText(
        "Version 3",
      );
      expect(await count()).toBe(1);
    });
    await test.step("Inspect actual short and detailed link audit and persisted removal from the unresolved queue", async () => {
      const audit = panel.getByRole("region", {
        name: "Recorded link audit",
        exact: true,
      });
      await expect(audit).toContainText(
        "Approved exact block mapping after fresh review",
      );
      await audit
        .getByText("View reviewed link details", { exact: true })
        .click();
      await expect(audit).toContainText(manager);
      await expect(audit).toContainText(block.id);
      await expect(audit).toContainText("No previous link");
      await find(target.id);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(0);
      await expect(panel.locator("[data-legacy-review]")).toContainText(
        target.task_code,
      );
      await page.reload();
      await page
        .getByRole("button", { name: "Task capacity", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Open legacy attribution review",
          exact: true,
        })
        .click();
      await find(target.id);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(0);
      await expect(panel).toContainText("No matching unresolved records");
      const persisted = (
        await work.db.query(
          "SELECT block_unit_id,version,capacity_ha FROM eoms.occurrences WHERE id=$1",
          [target.id],
        )
      ).rows[0];
      expect(persisted.block_unit_id).toBe(block.id);
      expect(persisted.version).toBe(3);
      expect(Number(persisted.capacity_ha)).toBe(3);
    });
    await test.step("Review as an assigned non-manager and keep missing-company empty guidance honest", async () => {
      viewer = await context
        .browser()!
        .newContext({
          viewport: page.viewportSize()!,
          baseURL: "http://localhost:5284",
        });
      const vp = await viewer.newPage();
      await vp.goto("http://localhost:5284");
      await new MusterPage(vp).signIn(supervisor);
      await chooseEstate(vp, estate);
      await vp
        .getByRole("button", { name: "Task capacity", exact: true })
        .click();
      await vp
        .getByRole("button", {
          name: "Open legacy attribution review",
          exact: true,
        })
        .click();
      const view = vp.getByRole("region", {
        name: "Legacy attribution review",
        exact: true,
      });
      await view
        .getByLabel("Search legacy records", { exact: true })
        .fill(tasks[1].id);
      await view
        .getByRole("button", { name: "Find legacy records", exact: true })
        .click();
      await expect(view.locator("[data-legacy-id]")).toHaveCount(1);
      await view
        .getByRole("button", { name: "Review task", exact: true })
        .click();
      await expect(view.locator("[data-legacy-review]")).toContainText(
        "Read-only review",
      );
      await expect(
        view.getByRole("button", {
          name: "Review matching block link",
          exact: true,
        }),
      ).toHaveCount(0);
      const response = vp.waitForResponse(
        (r) => r.url().includes(`/legacy-review/work?`) && r.status() === 200,
      );
      await view
        .getByLabel("Legacy review queue", { exact: true })
        .selectOption("work");
      expect((await (await response).json()).items).toEqual([]);
      await expect(view).toContainText("No matching unresolved records");
      await expect(view).toContainText(
        "Historical company attribution is not inferred",
      );
    });
    await test.step("Clear revoked task review and private mapping inputs and reject an older authorized detail response", async () => {
      await find(tasks[1].id);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(1);
      await panel
        .getByRole("button", { name: "Review task", exact: true })
        .click();
      await expect(panel.locator("[data-legacy-review]")).toContainText(
        tasks[1].task_code,
      );
      await panel
        .getByRole("button", {
          name: "Review matching block link",
          exact: true,
        })
        .click();
      await form
        .getByLabel("Matching configured block", { exact: true })
        .selectOption(block.id);
      await form
        .getByLabel("Link review reason", { exact: true })
        .fill("Private revoked mapping draft");
      let release!: () => void, fetched!: () => void;
      const held = new Promise<void>((r) => {
          release = r;
        }),
        ready = new Promise<void>((r) => {
          fetched = r;
        });
      const pattern = `**/api/estates/${estate}/legacy-review/tasks/${tasks[1].id}`;
      await page.route(pattern, async (route) => {
        const snapshot = await route.fetch();
        expect(snapshot.status()).toBe(200);
        fetched();
        await held;
        await route.fulfill({ response: snapshot });
      });
      await panel
        .locator(`[data-legacy-id="${tasks[1].id}"]`)
        .getByRole("button", { name: "Review task", exact: true })
        .click();
      await ready;
      await work.db.query(
        "DELETE FROM eoms.memberships WHERE user_id=$1 AND estate_id=$2",
        [manager, estate],
      );
      await find(tasks[1].id);
      await expect(panel).toContainText(
        "Cached records and private review inputs were cleared",
      );
      await expect(form).toHaveCount(0);
      await expect(panel.locator("[data-legacy-review]")).toHaveCount(0);
      await expect(panel.locator("[data-legacy-id]")).toHaveCount(0);
      await expect(panel).not.toContainText("Private revoked mapping draft");
      const stale = page.waitForResponse((r) =>
        r.url().endsWith(`/legacy-review/tasks/${tasks[1].id}`),
      );
      release();
      await (await stale).finished();
      await page.unroute(pattern);
      await expect(panel.locator("[data-legacy-review]")).toHaveCount(0);
      expect(
        (await page.request.get(base + "/legacy-review/tasks")).status(),
      ).toBe(403);
    });
  } finally {
    await viewer?.close();
    if (estate)
      await work.db.query("DELETE FROM eoms.memberships WHERE estate_id=$1", [
        estate,
      ]);
    if (customer)
      await work.db.query(
        "DELETE FROM eoms.organization_admins WHERE customer_id=$1",
        [customer],
      );
  }
});
