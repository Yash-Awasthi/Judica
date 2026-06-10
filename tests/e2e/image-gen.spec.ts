import { test, expect } from "@playwright/test";

/**
 * E2E: Image Generation page
 */

test.describe("Image Generation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/image-gen");
  });

  test("renders page with prompt input", async ({ page }) => {
    await expect(page.getByText(/image gen/i).first()).toBeVisible({ timeout: 10_000 });
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });
  });

  test("shows gallery area", async ({ page }) => {
    await expect(
      page.getByText(/gallery|no images/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("generate button disabled when prompt is empty", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /generate/i }).first();
    await expect(btn).toBeDisabled();
  });

  test("accepts prompt and enables generate", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("A futuristic city at sunset, cyberpunk aesthetic");
    const btn = page.getByRole("button").filter({ hasText: /generate/i }).first();
    await expect(btn).toBeEnabled();
  });

  test("shows size selector", async ({ page }) => {
    await expect(
      page.getByText(/1024.*square|square|size/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });
});
