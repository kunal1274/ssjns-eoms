import { expect, type Page } from "@playwright/test";
export class MusterPage {
  constructor(readonly page: Page) {}
  async signIn(account: { email: string; password: string }) {
    await this.page.goto("/");
    await this.page.getByLabel("Email", { exact: true }).fill(account.email);
    await this.page
      .getByLabel("Password", { exact: true })
      .fill(account.password);
    await this.page
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(
      this.page.getByRole("heading", { name: "Muster register", exact: true }),
    ).toBeVisible();
  }
  async startDraft(taskCode: string, date: string) {
    const p = this.page;
    await p.getByRole("button", { name: "+ New muster", exact: true }).click();
    await p.getByLabel("Work date", { exact: true }).fill(date);
    await p.getByLabel("Find task", { exact: true }).fill(taskCode);
    await p.getByRole("button", { name: "Search tasks", exact: true }).click();
    await expect(
      p.locator('select[name="task"] option').filter({ hasText: taskCode }),
    ).toBeAttached();
    await p.getByLabel("Area (Ha)", { exact: true }).fill("0.10");
    await p.getByLabel("Gang code", { exact: true }).selectOption("G-01");
    await p.getByRole("checkbox").first().check();
  }
  async record(id: string) {
    const row = this.page.locator(`[data-record-id="${id}"]`);
    // Keep pagination bounded: failure identifies a missing persisted record.
    for (let i = 0; i < 100 && !(await row.count()); i++) {
      const more = this.page.getByRole("button", {
        name: "Load more",
        exact: true,
      });
      if (!(await more.count())) break;
      await more.click();
    }
    await expect(row).toBeVisible();
    return row;
  }
}
