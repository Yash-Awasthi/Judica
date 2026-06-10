import { test, expect } from "@playwright/test";

test.describe("Interrupt & Resume", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/interrupt-resume");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Interrupt & Resume")).toBeVisible();
  });

  test("has run query input", async ({ page }) => {
    await expect(page.getByPlaceholder(/enter a query to start/i)).toBeVisible();
  });

  test("start run button disabled without query", async ({ page }) => {
    await expect(page.getByRole("button", { name: /start run/i })).toBeDisabled();
  });

  test("start run button enabled with query", async ({ page }) => {
    await page.getByPlaceholder(/enter a query/i).fill("Test query for council");
    await expect(page.getByRole("button", { name: /start run/i })).toBeEnabled();
  });

  test("shows empty runs state or list", async ({ page }) => {
    const empty = page.getByText(/no runs yet/i);
    const loading = page.getByText(/loading/i);
    const runs = page.locator(".border.rounded-lg").first();
    await expect(empty.or(loading).or(runs)).toBeVisible({ timeout: 5000 });
  });
});
