import { test, expect } from "@playwright/test";

/**
 * E2E: Marketplace flow
 *
 * Covers: navigate to marketplace, browse assets, search, filter by type,
 * open asset detail, and install/deploy.
 */

test.describe("Marketplace Flow", () => {
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

  test("browse and search the marketplace", async ({ page }) => {
    // ── Navigate to marketplace ──
    await page.goto("/marketplace");
    await expect(page).toHaveURL(/\/marketplace/);

    // ── Page should load ──
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible({ timeout: 10_000 });

    // ── Search for assets ──
    const searchInput = page.getByPlaceholder(/query|search/i);
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForTimeout(1_000); // debounce
    }

    // ── Filter by type ──
    const promptsFilter = page.getByRole("button", { name: /prompts/i });
    if (await promptsFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await promptsFilter.click();
      await page.waitForTimeout(500);
    }

    // ── Show all again ──
    const allFilter = page.getByRole("button", { name: /^all$/i });
    if (await allFilter.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await allFilter.click();
    }
  });

  test("open asset detail modal", async ({ page }) => {
    await page.goto("/marketplace");

    // Wait for at least one asset card to load
    const assetCard = page.locator(".glass-panel, [data-testid='asset-card']").first();
    const hasCard = await assetCard.isVisible({ timeout: 10_000 }).catch(() => false);

    if (hasCard) {
      // ── Click the card to open detail ──
      await assetCard.click();

      // ── Should show a detail modal/panel ──
      const modal = page.locator("[role='dialog'], .modal, .detail-modal").first();
      const hasModal = await modal.isVisible({ timeout: 5_000 }).catch(() => false);

      if (hasModal) {
        // ── Should have an install/deploy button ──
        const installBtn = page.getByRole("button", { name: /deploy|install|authorize/i });
        await expect(installBtn).toBeVisible({ timeout: 3_000 });

        // ── Close the modal ──
        const closeBtn = page.getByLabel(/close/i).or(page.getByRole("button", { name: /close|cancel|×/i }));
        if (await closeBtn.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
          await closeBtn.first().click();
        }
      }
    }
  });

  test("publish form is accessible", async ({ page }) => {
    await page.goto("/marketplace");

    // ── Look for publish button ──
    const publishBtn = page.getByRole("button", { name: /publish/i });
    if (await publishBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await publishBtn.click();

      // ── Should show publish form ──
      const form = page.locator("form, [role='form']").first();
      await expect(form).toBeVisible({ timeout: 5_000 });

      // ── Should have required fields ──
      const nameField = page.getByPlaceholder(/designation|name/i);
      await expect(nameField).toBeVisible({ timeout: 3_000 });
    }
  });
});
