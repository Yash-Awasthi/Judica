import { test, expect } from "@playwright/test";

test.describe("Reasoning", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reasoning");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Reasoning")).toBeVisible();
  });

  test("has Reasoning Depth and Symbolic Logic tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /reasoning depth/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /symbolic logic/i })).toBeVisible();
  });

  test("run button disabled when no prompt", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^run$/i })).toBeDisabled();
  });

  test("run button enabled with prompt", async ({ page }) => {
    await page.getByPlaceholder(/problem or question/i).fill("What is 2 + 2?");
    await expect(page.getByRole("button", { name: /^run$/i })).toBeEnabled();
  });

  test("symbolic tab shows forward chain and consistency buttons", async ({ page }) => {
    await page.getByRole("tab", { name: /symbolic logic/i }).click();
    await expect(page.getByRole("button", { name: /forward chain/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /consistency check/i })).toBeVisible();
  });
});
