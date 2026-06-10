import { test, expect } from "@playwright/test";

test.describe("Token Conservation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/token-conservation");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Token Conservation")).toBeVisible();
  });

  test("has compress and status tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /compress/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /status/i })).toBeVisible();
  });

  test("compress tab shows textarea and aggressiveness slider", async ({ page }) => {
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect(page.locator("input[type='range']")).toBeVisible();
  });

  test("compress button disabled when empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: /compress/i })).toBeDisabled();
  });

  test("compress button enabled with text", async ({ page }) => {
    await page.locator("textarea").first().fill("Please write a comprehensive summary of all the key points.");
    await expect(page.getByRole("button", { name: /compress/i })).toBeEnabled();
  });

  test("status tab shows loading or stats", async ({ page }) => {
    await page.getByRole("tab", { name: /status/i }).click();
    const hasLoading = await page.getByText(/loading/i).isVisible().catch(() => false);
    const hasData    = await page.getByText(/no conservation|compressions/i).isVisible().catch(() => false);
    expect(hasLoading || hasData).toBeTruthy();
  });
});
