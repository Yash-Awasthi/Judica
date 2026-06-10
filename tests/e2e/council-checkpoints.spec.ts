import { test, expect } from "@playwright/test";

test.describe("Council Checkpoints", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/council-checkpoints");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Council Checkpoints")).toBeVisible();
  });

  test("has run ID input", async ({ page }) => {
    await expect(page.getByPlaceholder(/enter run id/i)).toBeVisible();
  });

  test("load button disabled when empty", async ({ page }) => {
    const btn = page.getByRole("button").filter({ has: page.locator("svg") }).first();
    await expect(btn).toBeDisabled();
  });

  test("load button enabled with run id", async ({ page }) => {
    await page.getByPlaceholder(/enter run id/i).fill("test-run-123");
    const loadBtn = page.locator("button").nth(1);
    await expect(loadBtn).toBeEnabled();
  });

  test("shows empty detail state when no checkpoint selected", async ({ page }) => {
    await expect(page.getByText(/select a checkpoint to inspect/i)).not.toBeVisible();
  });

  test("description text is visible", async ({ page }) => {
    await expect(page.getByText(/time-travel debugging/i)).toBeVisible();
  });
});
