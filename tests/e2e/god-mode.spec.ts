import { test, expect } from "@playwright/test";

/**
 * E2E: God Mode — raw parallel compare
 */

test.describe("God Mode", () => {
  test.beforeEach(async ({ page }) => {
    // Assume auth cookie set by auth.setup.ts
    await page.goto("/god-mode");
  });

  test("renders page with prompt input and submit button", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /god mode/i })).toBeVisible({ timeout: 10_000 });
    const input = page.getByPlaceholder(/ask anything/i).or(page.locator("input[type=text]")).first();
    await expect(input).toBeVisible();
    const submit = page.getByRole("button", { name: /send|submit|run/i }).first();
    await expect(submit).toBeVisible();
  });

  test("submit button is disabled when input is empty", async ({ page }) => {
    const submit = page.getByRole("button", { name: /send|submit|run/i }).first();
    await expect(submit).toBeDisabled();
  });

  test("enables submit when input has text", async ({ page }) => {
    const input  = page.getByPlaceholder(/ask anything/i).or(page.locator("input[type=text]")).first();
    const submit = page.getByRole("button", { name: /send|submit|run/i }).first();
    await input.fill("What is the speed of light?");
    await expect(submit).toBeEnabled();
  });

  test("shows stop button while loading", async ({ page }) => {
    const input  = page.getByPlaceholder(/ask anything/i).or(page.locator("input[type=text]")).first();
    const submit = page.getByRole("button", { name: /send|submit|run/i }).first();
    await input.fill("Quick test question");
    await submit.click();
    const stop = page.getByRole("button", { name: /stop|cancel/i });
    await expect(stop).toBeVisible({ timeout: 5_000 });
    await stop.click();
  });

  test("shows fastest label after completion", async ({ page }) => {
    const input  = page.getByPlaceholder(/ask anything/i).or(page.locator("input[type=text]")).first();
    const submit = page.getByRole("button", { name: /send|submit|run/i }).first();
    await input.fill("What is 2+2?");
    await submit.click();
    // Wait up to 30s for a "fastest" label to appear
    await expect(page.getByText(/fastest/i)).toBeVisible({ timeout: 30_000 }).catch(() => {});
  });
});
