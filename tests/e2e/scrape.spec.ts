import { test, expect } from "@playwright/test";

test.describe("Web Scraping", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/scrape");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/web scraping/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows scrape tab by default", async ({ page }) => {
    await expect(page.getByPlaceholder(/https:\/\/example\.com/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("shows format selector", async ({ page }) => {
    await expect(page.getByText(/markdown|plain text/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("crawl tab renders", async ({ page }) => {
    await page.getByRole("button", { name: /crawl/i }).first().click();
    await expect(page.getByPlaceholder(/https:\/\/docs/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("exa tab renders", async ({ page }) => {
    await page.getByRole("button", { name: /exa/i }).first().click();
    await expect(page.getByText(/semantic search/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
