import { test, expect } from "@playwright/test";

test.describe("Multi-Agent Simulation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/simulation");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/simulation/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows tab navigation", async ({ page }) => {
    await expect(page.getByRole("button", { name: /personas/i }).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /environments/i }).first()).toBeVisible({ timeout: 8_000 });
  });

  test("runs tab shows new button", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /new/i }).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });

  test("personas tab renders", async ({ page }) => {
    await page.getByRole("button", { name: /personas/i }).first().click();
    await expect(page.getByRole("button").filter({ hasText: /new persona/i }).first()).toBeVisible({ timeout: 8_000 });
  });

  test("environments tab renders", async ({ page }) => {
    await page.getByRole("button", { name: /environments/i }).first().click();
    await expect(page.getByRole("button").filter({ hasText: /new environment/i }).first()).toBeVisible({ timeout: 8_000 });
  });
});
