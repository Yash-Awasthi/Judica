import { test, expect } from "@playwright/test";

test.describe("Blind Council", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/blind-council");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Blind Council")).toBeVisible();
  });

  test("has query textarea", async ({ page }) => {
    await expect(page.getByPlaceholder(/enter your question/i)).toBeVisible();
  });

  test("has model count selector", async ({ page }) => {
    await expect(page.getByLabel(/models/i)).toBeVisible();
  });

  test("run blind council button disabled without query", async ({ page }) => {
    await expect(page.getByRole("button", { name: /run blind council/i })).toBeDisabled();
  });

  test("run blind council button enabled with query", async ({ page }) => {
    await page.getByPlaceholder(/enter your question/i).fill("What is the meaning of life?");
    await expect(page.getByRole("button", { name: /run blind council/i })).toBeEnabled();
  });

  test("describe anonymization in page text", async ({ page }) => {
    await expect(page.getByText(/model a/i)).not.toBeVisible();
    await expect(page.getByText(/anonymous/i)).toBeVisible();
  });
});
