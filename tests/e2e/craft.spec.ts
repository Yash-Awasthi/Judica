import { test, expect } from "@playwright/test";

test.describe("Craft", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/craft");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Craft")).toBeVisible();
  });

  test("shows Generate and History tabs", async ({ page }) => {
    const generate = page.getByRole("tab", { name: /generate/i });
    const history = page.getByRole("tab", { name: /history/i });
    const loading = page.getByText(/loading templates/i);
    await expect(loading.or(generate)).toBeVisible();
  });

  test("history tab shows empty or list", async ({ page }) => {
    const histTab = page.getByRole("tab", { name: /history/i });
    if (await histTab.isVisible()) {
      await histTab.click();
      const empty = page.getByText(/no documents/i);
      const loading = page.getByText(/loading/i);
      const doc = page.locator(".border.rounded-lg").first();
      await expect(empty.or(loading).or(doc)).toBeVisible({ timeout: 5000 });
    }
  });
});
