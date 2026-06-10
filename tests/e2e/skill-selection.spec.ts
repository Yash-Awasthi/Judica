import { test, expect } from "@playwright/test";

test.describe("Skill Selection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/skill-selection");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Skill Selection")).toBeVisible();
  });

  test("has select and preview tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /select/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /preview/i })).toBeVisible();
  });

  test("select tab shows textarea and top-k slider", async ({ page }) => {
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect(page.locator("input[type='range']")).toBeVisible();
  });

  test("select button disabled when empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: /select skills/i })).toBeDisabled();
  });

  test("select button enabled with text", async ({ page }) => {
    await page.locator("textarea").first().fill("I need to write a Python script to parse CSV files.");
    await expect(page.getByRole("button", { name: /select skills/i })).toBeEnabled();
  });

  test("preview tab renders", async ({ page }) => {
    await page.getByRole("tab", { name: /preview/i }).click();
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /preview/i })).toBeVisible();
  });

  test("description text is visible", async ({ page }) => {
    await expect(page.getByText(/skill|task|augment/i)).toBeVisible();
  });
});
