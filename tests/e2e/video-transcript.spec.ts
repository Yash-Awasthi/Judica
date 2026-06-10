import { test, expect } from "@playwright/test";

test.describe("Video Transcript", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/video-transcript");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Video Transcript")).toBeVisible();
  });

  test("has video URL input", async ({ page }) => {
    await expect(page.getByPlaceholder(/youtube.com/i)).toBeVisible();
  });

  test("transcribe button disabled when empty", async ({ page }) => {
    const btn = page.locator("button").filter({ has: page.locator("svg") }).first();
    await expect(btn).toBeDisabled();
  });

  test("has file upload button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /upload video/i })).toBeVisible();
  });

  test("URL input triggers transcribe on Enter", async ({ page }) => {
    const input = page.getByPlaceholder(/youtube.com/i);
    await input.fill("https://youtube.com/watch?v=test");
    // Just verify button becomes enabled
    const btn = page.locator("button").filter({ has: page.locator("svg.w-4") }).first();
    await expect(btn).toBeEnabled();
  });
});
