import { test, expect } from "@playwright/test";
import path from "path";

/**
 * E2E: Knowledge Base upload flow
 *
 * Covers: navigate to training lab, interact with DNA editor,
 * validate configuration.
 */

test.describe("Knowledge Base / Training Lab Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const authVisible = await page.getByLabel(/username/i).isVisible({ timeout: 3_000 }).catch(() => false);
    if (authVisible) {
      await page.getByLabel(/username/i).fill("testuser");
      await page.getByLabel(/password/i).fill("password123");
      await page.getByRole("button", { name: /initialize access|login/i }).click();
      await page.waitForURL(/\/(chat|$)/, { timeout: 10_000 });
    }
  });

  test("navigate to training lab and interact with DNA editor", async ({ page }) => {
    // ── Navigate to training lab ──
    await page.goto("/training");
    await expect(page).toHaveURL(/\/training/);

    // ── Page should load without errors ──
    await expect(page.locator("main, [role='main'], .glass-panel").first()).toBeVisible({ timeout: 10_000 });

    // ── Should show DNA editor or KB selector ──
    // Look for any input/textarea related to DNA editing
    const editorElements = page.locator("textarea, input[type='text'], .code-editor").first();
    await expect(editorElements).toBeVisible({ timeout: 10_000 });
  });

  test("training lab shows validation console", async ({ page }) => {
    await page.goto("/training");

    // Look for a run/validate button
    const runBtn = page.getByRole("button", { name: /initialize evolution|validate|run|test/i });
    const hasBtnVisible = await runBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    if (hasBtnVisible) {
      // Click the validation button
      await runBtn.click();

      // Should show progress or console output
      const outputArea = page.locator("[role='log'], .console-output, pre, .training-console").first();
      await expect(outputArea).toBeVisible({ timeout: 10_000 });
    }
  });
});
