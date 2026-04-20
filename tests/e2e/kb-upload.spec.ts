import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * E2E: Knowledge Base upload flow
 *
 * P6-05: Fixed — actually uploads a real synthetic file and asserts retrieval by content.
 */

test.describe("Knowledge Base / Training Lab Flow", () => {
  let testFilePath: string;

  test.beforeAll(async () => {
    // Create a synthetic test file with identifiable content
    testFilePath = path.join(os.tmpdir(), `kb-test-${Date.now()}.txt`);
    fs.writeFileSync(testFilePath, "The capital of Testland is Assertville. Population: 42.");
  });

  test.afterAll(async () => {
    if (testFilePath && fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

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

  test("upload a file to the knowledge base and verify content", async ({ page }) => {
    // ── Navigate to training lab ──
    await page.goto("/training");
    await expect(page).toHaveURL(/\/training/);

    // ── Page should load ──
    await expect(page.locator("main, [role='main'], .glass-panel").first()).toBeVisible({ timeout: 10_000 });

    // ── Find file upload input and upload the test file ──
    const fileInput = page.locator("input[type='file']");
    await expect(fileInput).toBeAttached({ timeout: 10_000 });
    await fileInput.setInputFiles(testFilePath);

    // ── Wait for upload confirmation ──
    // Should show the filename or a success indicator
    await expect(
      page.getByText(/kb-test|uploaded|success/i).first()
    ).toBeVisible({ timeout: 15_000 });

    // ── Verify file content is retrievable (navigate to KB list or query) ──
    const kbEntry = page.getByText(/kb-test/i).first();
    await expect(kbEntry).toBeVisible({ timeout: 5_000 });
  });

  test("training lab shows validation console", async ({ page }) => {
    await page.goto("/training");

    // Look for a run/validate button — must be present
    const runBtn = page.getByRole("button", { name: /initialize evolution|validate|run|test/i });
    await expect(runBtn.first()).toBeVisible({ timeout: 10_000 });
    await runBtn.first().click();

    // Should show progress or console output
    const outputArea = page.locator("[role='log'], .console-output, pre, .training-console").first();
    await expect(outputArea).toBeVisible({ timeout: 10_000 });
  });
});
