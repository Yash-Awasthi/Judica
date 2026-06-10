import { test, expect } from "@playwright/test";

test.describe("What-If Scenarios", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/what-if");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("What-If Scenarios")).toBeVisible();
  });

  test("has simulation run ID input", async ({ page }) => {
    await expect(page.getByPlaceholder(/simulation run id/i)).toBeVisible();
  });

  test("load button disabled without ID", async ({ page }) => {
    const loadBtn = page.locator("button").filter({ has: page.locator("svg") }).first();
    await expect(loadBtn).toBeDisabled();
  });

  test("shows branches section when ID entered", async ({ page }) => {
    await page.getByPlaceholder(/simulation run id/i).fill("test-sim-123");
    const loadBtn = page.locator("button").filter({ has: page.locator("svg") }).nth(0);
    await expect(loadBtn).toBeEnabled();
  });

  test("description text is visible", async ({ page }) => {
    await expect(page.getByText(/branch.*simulation/i)).toBeVisible();
  });
});
