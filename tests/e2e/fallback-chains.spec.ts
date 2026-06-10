import { test, expect } from "@playwright/test";

test.describe("Fallback Chains", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fallback-chains");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Fallback Chains")).toBeVisible();
  });

  test("has new chain button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /new chain/i })).toBeVisible();
  });

  test("shows empty state or list", async ({ page }) => {
    const emptyState = page.getByText(/no fallback chains/i);
    const loading = page.getByText(/loading chains/i);
    const chains = page.locator(".space-y-4 .border");
    await expect(emptyState.or(loading).or(chains.first())).toBeVisible({ timeout: 5000 });
  });

  test("create chain dialog opens", async ({ page }) => {
    await page.getByRole("button", { name: /new chain/i }).click();
    await expect(page.getByText("New Fallback Chain")).toBeVisible();
    await expect(page.getByPlaceholder(/provider/i).first()).toBeVisible();
  });

  test("test prompt input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder(/enter a prompt to use when testing/i)).toBeVisible();
  });
});
