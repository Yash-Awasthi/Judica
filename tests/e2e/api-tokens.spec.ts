import { test, expect } from "@playwright/test";

test.describe("API Tokens", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api-tokens");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/api tokens/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows new token button", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /new token/i }).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });

  test("shows usage example", async ({ page }) => {
    await expect(page.getByText(/usage/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("create dialog opens", async ({ page }) => {
    await page.getByRole("button").filter({ hasText: /new token/i }).first().click();
    await expect(page.getByText(/create api token/i).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByPlaceholder(/CI pipeline|label/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
