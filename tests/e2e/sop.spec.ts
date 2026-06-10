import { test, expect } from "@playwright/test";

test.describe("SOPs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sop");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Standard Operating Procedures")).toBeVisible();
  });

  test("shows loading or template list", async ({ page }) => {
    const hasLoading = await page.getByText(/loading/i).isVisible().catch(() => false);
    const hasList    = await page.locator("aside, [class*='sidebar'], [class*='template']").first().isVisible().catch(() => false);
    expect(hasLoading || hasList).toBeTruthy();
  });

  test("description text is visible", async ({ page }) => {
    await expect(page.getByText(/procedure|template|workflow|sop/i)).toBeVisible();
  });

  test("run panel or empty state visible", async ({ page }) => {
    const hasRunPanel = await page.getByText(/select a template|run|no template/i).isVisible().catch(() => false);
    expect(hasRunPanel).toBeTruthy();
  });
});
