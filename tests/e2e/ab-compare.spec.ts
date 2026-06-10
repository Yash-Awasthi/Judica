import { test, expect } from "@playwright/test";

test.describe("A/B Model Arena", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ab-compare");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/A\/B Model Arena/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows model selectors", async ({ page }) => {
    await expect(page.getByText(/Model A/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/Model B/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("run button disabled with empty prompt", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /run comparison/i }).first();
    await expect(btn).toBeDisabled();
  });

  test("accepts prompt text", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("Explain quantum computing in one sentence");
    const btn = page.getByRole("button").filter({ hasText: /run comparison/i }).first();
    await expect(btn).toBeEnabled();
  });

  test("shows tab navigation", async ({ page }) => {
    await expect(page.getByRole("button", { name: /history/i }).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /stats/i }).first()).toBeVisible({ timeout: 8_000 });
  });
});
