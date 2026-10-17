import { test, expect, estateId } from "./fixtures";
import { hash, token } from "../../apps/api/src/security";
test("E2E-JRN-02-005 @regression independent cancellation and linked correction", async ({
  page,
  browser,
  setupAdmin,
  muster,
  work,
}) => {
  await muster.signIn(setupAdmin);
  const session = await (await page.request.get("/api/auth/session")).json(),
    suffix = Date.now().toString(36).toUpperCase();
  const source = (
    await work.db.query(
      "SELECT customer_id,company_id FROM eoms.estates WHERE id=$1",
      [estateId],
    )
  ).rows[0];
  const reviewer = (
    await work.db.query(
      "SELECT id,display_name FROM eoms.users WHERE email='reviewer@eoms.local'",
    )
  ).rows[0];
  expect(reviewer).toBeTruthy();
  expect(reviewer.id).not.toBe(session.user.id);
  const target = (
    await work.db.query(
      "INSERT INTO eoms.companies(customer_id,name) VALUES($1,$2) RETURNING id,name",
      [source.customer_id, "ZZ Cancellation target " + suffix],
    )
  ).rows[0];
  const own = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,$4) RETURNING id",
      [
        source.customer_id,
        source.company_id,
        "CC-" + suffix,
        "Cancellation journey " + suffix,
      ],
    )
  ).rows[0];
  const anchor = (
    await work.db.query(
      "INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES($1,$2,$3,'Cancellation target anchor') RETURNING id",
      [source.customer_id, target.id, "CA-" + suffix],
    )
  ).rows[0];
  for (const actor of [session.user.id, reviewer.id])
    await work.db.query(
      "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
      [actor, own.id],
    );
  await work.db.query(
    "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,'manager')",
    [session.user.id, anchor.id],
  );
  await work.db.query(
    "INSERT INTO eoms.gangs(estate_id,code,name) VALUES($1,'G-01','Cancellation fixture gang')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.workers(estate_id,code,name) VALUES($1,'CW','Cancellation worker')",
    [own.id],
  );
  await work.db.query(
    "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2102-01-01')",
    [own.id],
  );
  const task = "CANCEL-" + suffix;
  await work.db.query(
    "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,'CW',$2,'Cancellation journey','C',2)",
    [own.id, task],
  );
  await page.reload();
  await expect(
    page
      .getByLabel("Estate", { exact: true })
      .locator(`option[value="${own.id}"]`),
  ).toBeAttached();
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const legal = page.getByRole("region", {
      name: "Estate responsibility",
      exact: true,
    }),
    governance = legal.getByRole("region", {
      name: "Responsibility cancellation review",
      exact: true,
    });
  let assignmentId = "",
    requestId = "",
    replacementId = "";
  await test.step("Request future cancellation without changing active responsibility", async () => {
    await legal
      .getByLabel("Responsibility estate", { exact: true })
      .selectOption(own.id);
    await legal
      .getByLabel("Next responsible company", { exact: true })
      .selectOption(target.id);
    await legal
      .getByLabel("Responsibility effective date", { exact: true })
      .fill("2102-01-10");
    await legal
      .getByLabel("Responsibility reason", { exact: true })
      .fill("Initial scheduled setup for review");
    await legal
      .getByRole("button", { name: "Save responsibility change", exact: true })
      .click();
    await expect(legal.locator("[data-responsibility-summary]")).toContainText(
      target.name,
    );
    let data = await (
      await page.request.get(
        `/api/estates/${own.id}/responsibility?on=2102-01-10`,
      )
    ).json();
    assignmentId = data.items[0].id;
    await governance
      .getByLabel("Cancellation request reason", { exact: true })
      .fill("Wrong setup requires reviewed correction");
    await governance
      .getByRole("button", { name: "Request cancellation", exact: true })
      .click();
    await expect(governance.getByRole("status")).toHaveText(
      "Cancellation requested. Independent review is required.",
    );
    await expect(
      governance.getByRole("form", {
        name: "Independent cancellation decision",
        exact: true,
      }),
    ).toHaveCount(0);
    data = await (
      await page.request.get(
        `/api/estates/${own.id}/responsibility?on=2102-01-10`,
      )
    ).json();
    requestId = data.requests[0].id;
    expect(data.responsible.id).toBe(target.id);
    expect(data.requests[0].decision).toBeNull();
    const denied = await page.request.post(
      `/api/estates/${own.id}/responsibility/requests/${requestId}/decision`,
      {
        headers: {
          Origin: new URL(page.url()).origin,
          "X-CSRF-Token": session.csrf,
        },
        data: {
          revision: 1,
          decision: "approved",
          reason: "Self-review must be rejected",
        },
      },
    );
    expect(denied.status()).toBe(403);
  });
  await test.step("Independent setup reviewer approves and records actor reasons and references", async () => {
    // Authenticate a separate seeded principal with an isolated, real test-DB session.
    // Login/session behavior is covered by JRN-03; this avoids repeated logins exhausting the unchanged rate limit.
    const raw = token(),
      csrf = token();
    await work.db.query(
      "INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(raw), reviewer.id, csrf],
    );
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize()!,
    });
    try {
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
      const review = await context.newPage();
      await review.goto("/");
      await expect(
        review.getByText(reviewer.display_name, { exact: true }),
      ).toBeVisible();
      await review
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      const panel = review.getByRole("region", {
        name: "Estate responsibility",
        exact: true,
      });
      await panel
        .getByLabel("Responsibility estate", { exact: true })
        .selectOption(own.id);
      const gate = panel.getByRole("region", {
        name: "Responsibility cancellation review",
        exact: true,
      });
      await gate
        .getByLabel("Cancellation request", { exact: true })
        .selectOption(requestId);
      await gate
        .getByLabel("Cancellation decision", { exact: true })
        .selectOption("approved");
      await gate
        .getByLabel("Independent review reason", { exact: true })
        .fill("Verified no affected work; approve correction");
      await gate
        .getByRole("button", {
          name: "Record independent decision",
          exact: true,
        })
        .click();
      await expect(gate.getByRole("status")).toHaveText(
        "Independent decision recorded. Review the responsibility timeline.",
      );
      const event = gate.locator(`[data-cancel-request-id="${requestId}"]`);
      await event
        .getByText("View cancellation review details", { exact: true })
        .click();
      await expect(event).toContainText("Cancellation approved");
      await expect(event).toContainText(reviewer.display_name);
      const data = await (
        await review.request.get(
          `/api/estates/${own.id}/responsibility?on=2102-01-10`,
        )
      ).json();
      expect(data.responsible.id).toBe(source.company_id);
      expect(data.items[0].cancelled).toBe(true);
      await expect(event).toContainText(data.requests[0].request_id);
      await expect(event).toContainText(data.requests[0].decision_reference);
      expect(data.requests[0].requester_id).toBe(session.user.id);
    } finally {
      await context.close();
    }
  });
  await test.step("Create linked same-date replacement while retaining cancelled original", async () => {
    await legal
      .getByRole("button", { name: "Refresh responsibility", exact: true })
      .click();
    await expect(
      legal.locator(`[data-responsibility-id="${assignmentId}"]`),
    ).toContainText("Cancelled after independent review");
    await legal
      .getByLabel("Correction source", { exact: true })
      .selectOption(assignmentId);
    await legal
      .getByLabel("Next responsible company", { exact: true })
      .selectOption(target.id);
    await legal
      .getByLabel("Responsibility effective date", { exact: true })
      .fill("2102-01-10");
    await legal
      .getByLabel("Responsibility reason", { exact: true })
      .fill("Replacement linked to approved cancellation");
    await legal
      .getByRole("button", { name: "Save responsibility change", exact: true })
      .click();
    await expect(
      legal.getByRole("status").filter({
        hasText: "Responsibility change saved. Existing work retained.",
      }),
    ).toBeVisible();
    const data = await (
      await page.request.get(
        `/api/estates/${own.id}/responsibility?on=2102-01-10`,
      )
    ).json();
    expect(data.items).toHaveLength(2);
    expect(data.revision).toBe(2);
    replacementId = data.items[0].id;
    expect(data.items[0].replaces_responsibility_id).toBe(assignmentId);
    expect(data.items[1].cancelled).toBe(true);
    expect(data.responsible.assignmentId).toBe(replacementId);
  });
  await test.step("Capture replacement work and deny cancellation with retained recovery guidance", async () => {
    await page.getByLabel("Estate", { exact: true }).selectOption(own.id);
    await page
      .getByRole("button", { name: "Muster register", exact: true })
      .click();
    await muster.startDraft(task, "2102-01-15");
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/musters") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const saved = await response;
    expect(saved.status()).toBe(201);
    const row = await saved.json();
    expect(row.legal_responsibility_id).toBe(replacementId);
    await page
      .getByRole("button", { name: "Organization", exact: true })
      .click();
    await legal
      .getByLabel("Responsibility estate", { exact: true })
      .selectOption(own.id);
    await governance
      .getByLabel("Cancellation request reason", { exact: true })
      .fill("Recorded work must prevent cancellation");
    await governance
      .getByRole("button", { name: "Request cancellation", exact: true })
      .click();
    await expect(governance.getByRole("alert")).toContainText(
      "Work already exists",
    );
    await expect(governance.getByRole("alert")).toContainText(
      "Support reference:",
    );
    await expect(
      governance.getByLabel("Cancellation request reason", { exact: true }),
    ).toHaveValue("Recorded work must prevent cancellation");
    expect(
      (
        await work.db.query(
          "SELECT * FROM eoms.responsibility_cancel_requests WHERE estate_id=$1",
          [own.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await work.db.query(
          "SELECT legal_responsibility_id FROM eoms.musters WHERE id=$1",
          [row.id],
        )
      ).rows[0].legal_responsibility_id,
    ).toBe(replacementId);
  });
});
