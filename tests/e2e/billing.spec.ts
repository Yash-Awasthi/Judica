import { test, expect } from "@playwright/test";

test.describe("Billing & Plans", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/billing");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/billing/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows choose a plan section", async ({ page }) => {
    await expect(page.getByText(/choose a plan/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("shows interval toggle", async ({ page }) => {
    await expect(page.getByRole("button", { name: /monthly/i }).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /annual/i }).first()).toBeVisible({ timeout: 8_000 });
  });
});
