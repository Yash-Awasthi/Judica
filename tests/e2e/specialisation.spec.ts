import { test, expect } from "@playwright/test";

test.describe("Specialisation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/specialisation");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Specialisation")).toBeVisible();
  });

  test("has domains, detect, and apply tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /domains/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /detect/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /apply/i })).toBeVisible();
  });

  test("domains tab shows loading or list", async ({ page }) => {
    const hasLoading = await page.getByText(/loading/i).isVisible().catch(() => false);
    const hasContent = await page.locator("[class*='card'], [class*='Card']").first().isVisible().catch(() => false);
    expect(hasLoading || hasContent).toBeTruthy();
  });

  test("detect tab shows textarea", async ({ page }) => {
    await page.getByRole("tab", { name: /detect/i }).click();
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("detect button disabled when empty", async ({ page }) => {
    await page.getByRole("tab", { name: /detect/i }).click();
    await expect(page.getByRole("button", { name: /detect domain/i })).toBeDisabled();
  });

  test("apply tab renders inputs", async ({ page }) => {
    await page.getByRole("tab", { name: /apply/i }).click();
    const inputs = page.locator("input");
    await expect(inputs.first()).toBeVisible();
  });
});
