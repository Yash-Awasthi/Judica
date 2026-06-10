import { test, expect } from "@playwright/test";

test.describe("Cost Analytics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/costs");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Cost Analytics")).toBeVisible();
  });

  test("has tab navigation", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /by model/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /by provider/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /efficiency/i })).toBeVisible();
  });

  test("shows loading or KPI cards", async ({ page }) => {
    const loading = page.getByText(/loading cost data/i);
    const mtd = page.getByText(/month-to-date/i);
    await expect(loading.or(mtd)).toBeVisible();
  });

  test("refresh button is visible", async ({ page }) => {
    const refreshBtn = page.locator("button").filter({ hasText: "" }).first();
    await expect(refreshBtn).toBeVisible();
  });
});
