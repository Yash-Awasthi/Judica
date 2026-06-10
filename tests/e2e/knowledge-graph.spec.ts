import { test, expect } from "@playwright/test";

test.describe("Knowledge Graph", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/knowledge-graph");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/knowledge graph/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows tab navigation", async ({ page }) => {
    await expect(page.getByRole("button", { name: /extract/i }).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /search/i }).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /communities/i }).first()).toBeVisible({ timeout: 8_000 });
  });

  test("extract tab shows textarea", async ({ page }) => {
    await page.getByRole("button", { name: /extract/i }).first().click();
    await expect(page.locator("textarea").first()).toBeVisible({ timeout: 8_000 });
  });

  test("search tab shows input", async ({ page }) => {
    await page.getByRole("button", { name: /search/i }).first().click();
    await expect(page.getByPlaceholder(/natural-language|What do I know/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
