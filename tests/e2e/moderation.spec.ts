import { test, expect } from "@playwright/test";

test.describe("Content Moderation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/moderation");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Content Moderation")).toBeVisible();
  });

  test("has Check, Batch, Config tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /^check/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /batch/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /config/i })).toBeVisible();
  });

  test("check content button disabled when empty", async ({ page }) => {
    const btn = page.getByRole("button", { name: /check content/i });
    await expect(btn).toBeDisabled();
  });

  test("check button enabled with text", async ({ page }) => {
    await page.getByPlaceholder(/policy violations/i).fill("Some sample text to check");
    await expect(page.getByRole("button", { name: /check content/i })).toBeEnabled();
  });

  test("batch tab has add button and items", async ({ page }) => {
    await page.getByRole("tab", { name: /batch/i }).click();
    await expect(page.getByRole("button", { name: /add/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /check all/i })).toBeVisible();
  });

  test("config tab loads", async ({ page }) => {
    await page.getByRole("tab", { name: /config/i }).click();
    const loading = page.getByText(/loading/i);
    const config = page.getByText(/no config/i);
    const categories = page.getByText(/moderation categories/i);
    await expect(loading.or(config).or(categories)).toBeVisible();
  });
});
