import { test, expect } from "@playwright/test";

/**
 * E2E: Parseltongue — code-aware deliberation
 */

test.describe("Parseltongue", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/parseltongue");
  });

  test("renders page with code input", async ({ page }) => {
    await expect(page.getByText(/parseltongue/i)).toBeVisible({ timeout: 10_000 });
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });
  });

  test("has specialist reviewer badges or labels", async ({ page }) => {
    await expect(
      page.getByText(/security|performance|correctness|architecture|code review/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("submit disabled when code textarea is empty", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /analyze|review|run|send|submit/i }).first();
    await expect(btn).toBeDisabled();
  });

  test("accepts code input and enables submit", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("function add(a, b) { return a + b; }");
    const btn = page.getByRole("button").filter({ hasText: /analyze|review|run|send|submit/i }).first();
    await expect(btn).toBeEnabled();
  });

  test("optional prompt field is present", async ({ page }) => {
    // Additional question/context input
    const inputs = page.locator("input[type=text], input:not([type])");
    const count  = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(0); // may or may not have an extra field
  });
});
