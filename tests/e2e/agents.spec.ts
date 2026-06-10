import { test, expect } from "@playwright/test";

test.describe("Agents Hub", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/agents");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/agents/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows browser agent tab", async ({ page }) => {
    await expect(page.getByRole("button").filter({ hasText: /browser agent/i }).first()).toBeVisible({ timeout: 8_000 });
  });

  test("shows reactive rules tab", async ({ page }) => {
    await expect(page.getByRole("button").filter({ hasText: /reactive rules/i }).first()).toBeVisible({ timeout: 8_000 });
  });

  test("reactive rules tab renders", async ({ page }) => {
    await page.getByRole("button").filter({ hasText: /reactive rules/i }).first().click();
    await expect(page.getByRole("button").filter({ hasText: /new rule/i }).first()).toBeVisible({ timeout: 8_000 });
  });

  test("new browser task button present", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /new/i }).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });
});
