import { test, expect } from "@playwright/test";

test.describe("Verbosity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/verbosity");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Verbosity")).toBeVisible();
  });

  test("has levels and preview tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /levels/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /preview/i })).toBeVisible();
  });

  test("levels tab shows loading or content", async ({ page }) => {
    const hasLoading = await page.getByText(/loading/i).isVisible().catch(() => false);
    const hasContent = await page.locator("[class*='card'], [class*='Card']").first().isVisible().catch(() => false);
    expect(hasLoading || hasContent).toBeTruthy();
  });

  test("preview tab renders textarea", async ({ page }) => {
    await page.getByRole("tab", { name: /preview/i }).click();
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("preview button disabled when empty", async ({ page }) => {
    await page.getByRole("tab", { name: /preview/i }).click();
    await expect(page.getByRole("button", { name: /preview/i })).toBeDisabled();
  });

  test("description text is visible", async ({ page }) => {
    await expect(page.getByText(/verbosity|verbose|concise|minimal/i)).toBeVisible();
  });
});
