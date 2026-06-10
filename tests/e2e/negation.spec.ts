import { test, expect } from "@playwright/test";

test.describe("Negation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/negation");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Negation")).toBeVisible();
  });

  test("has detect, manage, and inject tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /detect/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /manage/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /inject/i })).toBeVisible();
  });

  test("detect tab shows textarea", async ({ page }) => {
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("detect button disabled when empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: /detect/i })).toBeDisabled();
  });

  test("detect button enabled with text", async ({ page }) => {
    await page.locator("textarea").first().fill("This is not a good idea.");
    await expect(page.getByRole("button", { name: /detect/i })).toBeEnabled();
  });

  test("manage tab shows conversation ID input", async ({ page }) => {
    await page.getByRole("tab", { name: /manage/i }).click();
    await expect(page.locator("input").first()).toBeVisible();
  });

  test("inject tab renders", async ({ page }) => {
    await page.getByRole("tab", { name: /inject/i }).click();
    await expect(page.getByRole("button", { name: /inject/i })).toBeVisible();
  });
});
