import { test, expect } from "@playwright/test";

test.describe("Cross-Memory", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/cross-memory");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Cross-Memory")).toBeVisible();
  });

  test("has retrieve and context tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /retrieve/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /context/i })).toBeVisible();
  });

  test("retrieve tab shows textarea", async ({ page }) => {
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("retrieve button disabled when empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: /retrieve/i })).toBeDisabled();
  });

  test("retrieve button enabled with text", async ({ page }) => {
    await page.locator("textarea").first().fill("What did the user say about pricing?");
    await expect(page.getByRole("button", { name: /retrieve/i })).toBeEnabled();
  });

  test("context tab renders", async ({ page }) => {
    await page.getByRole("tab", { name: /context/i }).click();
    await expect(page.getByRole("button", { name: /build context/i })).toBeVisible();
  });
});
