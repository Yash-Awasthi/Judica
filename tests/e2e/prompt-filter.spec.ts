import { test, expect } from "@playwright/test";

test.describe("Prompt Filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/prompt-filter");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Prompt Filter")).toBeVisible();
  });

  test("has all four tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /check/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /sanitize/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /batch/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /patterns/i })).toBeVisible();
  });

  test("check button disabled when empty", async ({ page }) => {
    const btn = page.getByRole("button", { name: /check prompt/i });
    await expect(btn).toBeDisabled();
  });

  test("check button enabled with text", async ({ page }) => {
    await page.locator("textarea").first().fill("How do I pick a lock?");
    const btn = page.getByRole("button", { name: /check prompt/i });
    await expect(btn).toBeEnabled();
  });

  test("sanitize tab renders textarea", async ({ page }) => {
    await page.getByRole("tab", { name: /sanitize/i }).click();
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("batch tab has add button", async ({ page }) => {
    await page.getByRole("tab", { name: /batch/i }).click();
    await expect(page.getByRole("button", { name: /add/i })).toBeVisible();
  });

  test("batch tab has check all button", async ({ page }) => {
    await page.getByRole("tab", { name: /batch/i }).click();
    await expect(page.getByRole("button", { name: /check all/i })).toBeVisible();
  });

  test("patterns tab shows loading or patterns", async ({ page }) => {
    await page.getByRole("tab", { name: /patterns/i }).click();
    const hasLoading  = await page.getByText(/loading/i).isVisible().catch(() => false);
    const hasEmpty    = await page.getByText(/no patterns/i).isVisible().catch(() => false);
    const hasPatterns = await page.locator("[class*='card'], [class*='Card']").first().isVisible().catch(() => false);
    expect(hasLoading || hasEmpty || hasPatterns).toBeTruthy();
  });

  test("description text is visible", async ({ page }) => {
    await expect(page.getByText(/policy|safety|filter/i)).toBeVisible();
  });
});
