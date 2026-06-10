import { test, expect } from "@playwright/test";

test.describe("RSS Feeds", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/rss");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("RSS Feeds")).toBeVisible();
  });

  test("has feed URL input", async ({ page }) => {
    await expect(page.getByPlaceholder(/https:\/\/example.com\/feed/i)).toBeVisible();
  });

  test("subscribe button disabled when empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: /subscribe/i })).toBeDisabled();
  });

  test("subscribe button enabled with URL", async ({ page }) => {
    await page.getByPlaceholder(/https:\/\/example.com\/feed/i).fill("https://example.com/feed.xml");
    await expect(page.getByRole("button", { name: /subscribe/i })).toBeEnabled();
  });

  test("shows empty state or feed list", async ({ page }) => {
    const empty = page.getByText(/no feeds yet/i);
    const loading = page.getByText(/loading/i);
    const feeds = page.locator(".border.rounded-lg").first();
    await expect(empty.or(loading).or(feeds)).toBeVisible({ timeout: 5000 });
  });

  test("select prompt shows in items area", async ({ page }) => {
    await expect(page.getByText(/select a feed to read/i)).toBeVisible();
  });
});
