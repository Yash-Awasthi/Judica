import { test, expect } from "@playwright/test";

/**
 * E2E: Admin Traces page
 */

test.describe("Admin Traces", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/traces");
  });

  test("renders traces page", async ({ page }) => {
    await expect(
      page.getByText(/traces|ai traces/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows type filter", async ({ page }) => {
    await expect(
      page.getByText(/all types|deliberate|type/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("shows search input", async ({ page }) => {
    const search = page.getByPlaceholder(/search traces/i).first();
    await expect(search).toBeVisible({ timeout: 8_000 });
  });

  test("has refresh button", async ({ page }) => {
    const refreshBtn = page.getByTitle("Refresh").first();
    await expect(refreshBtn).toBeVisible({ timeout: 8_000 });
  });
});
