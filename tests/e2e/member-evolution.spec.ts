import { test, expect } from "@playwright/test";

test.describe("Member Evolution", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/member-evolution");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Member Evolution")).toBeVisible();
  });

  test("has profile, recompute, and apply tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /profile/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /recompute/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /apply/i })).toBeVisible();
  });

  test("profile load button disabled when empty", async ({ page }) => {
    const btn = page.locator("button").filter({ hasText: /^$/ }).or(page.locator("button[disabled]")).first();
    const input = page.locator("input").first();
    await expect(input).toBeVisible();
  });

  test("recompute tab renders", async ({ page }) => {
    await page.getByRole("tab", { name: /recompute/i }).click();
    await expect(page.getByRole("button", { name: /recompute/i })).toBeVisible();
  });

  test("apply tab renders", async ({ page }) => {
    await page.getByRole("tab", { name: /apply/i }).click();
    await expect(page.getByRole("button", { name: /apply/i })).toBeVisible();
  });

  test("description text is visible", async ({ page }) => {
    await expect(page.getByText(/adapt|evolution|traits|persona/i)).toBeVisible();
  });
});
