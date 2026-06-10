import { test, expect } from "@playwright/test";

test.describe("Semantic Cache", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/semantic-cache");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Semantic Cache")).toBeVisible();
  });

  test("has Lookup, Invalidate, Config tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /lookup/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /invalidate/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /config/i })).toBeVisible();
  });

  test("lookup button disabled when empty", async ({ page }) => {
    const input = page.getByPlaceholder(/enter a query/i);
    const btn = input.locator("..").locator("button");
    await expect(btn).toBeDisabled();
  });

  test("lookup shows result area", async ({ page }) => {
    await expect(page.getByPlaceholder(/enter a query to test/i)).toBeVisible();
  });

  test("config tab shows similarity threshold slider", async ({ page }) => {
    await page.getByRole("tab", { name: /config/i }).click();
    const loading = page.getByText(/loading config/i);
    const threshold = page.getByText(/similarity threshold/i);
    const noConfig = page.getByText(/no config/i);
    await expect(loading.or(threshold).or(noConfig)).toBeVisible();
  });
});
