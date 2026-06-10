import { test, expect } from "@playwright/test";

test.describe("Honesty", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/honesty");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Honesty")).toBeVisible();
  });

  test("shows sycophancy tab by default", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /sycophancy/i })).toBeVisible();
  });

  test("has all four tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /sycophancy/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /reframe/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /confidence/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /minority/i })).toBeVisible();
  });

  test("check button disabled when empty", async ({ page }) => {
    const btn = page.getByRole("button", { name: /check/i }).first();
    await expect(btn).toBeDisabled();
  });

  test("check button enabled after entering text", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("The plan looks great, no issues at all.");
    const btn = page.getByRole("button", { name: /check/i }).first();
    await expect(btn).toBeEnabled();
  });

  test("reframe tab renders textarea", async ({ page }) => {
    await page.getByRole("tab", { name: /reframe/i }).click();
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("minority report tab renders textarea", async ({ page }) => {
    await page.getByRole("tab", { name: /minority/i }).click();
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("description text is visible", async ({ page }) => {
    await expect(page.getByText(/sycophancy|honesty|anti-sycophancy/i)).toBeVisible();
  });
});
