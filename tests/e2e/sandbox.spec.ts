import { test, expect } from "@playwright/test";

test.describe("Code Sandbox", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sandbox");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/code sandbox/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows execute tab by default", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });
  });

  test("shows language selector", async ({ page }) => {
    await expect(page.getByText(/javascript|python|typescript/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("run button present", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /^run$/i }).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });

  test("code agent tab shows", async ({ page }) => {
    await expect(page.getByRole("button", { name: /code agent/i }).first()).toBeVisible({ timeout: 8_000 });
  });

  test("switch to code agent tab", async ({ page }) => {
    await page.getByRole("button", { name: /code agent/i }).first().click();
    await expect(page.getByText(/describe what you want/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
