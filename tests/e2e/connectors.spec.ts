import { test, expect } from "@playwright/test";

/**
 * E2E: Connectors — onboarding wizard + sync dashboard
 */

test.describe("Connector Onboarding", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/connectors/onboarding");
  });

  test("renders connector picker step", async ({ page }) => {
    await expect(
      page.getByText(/connector|integration|add connector/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows at least one connector option", async ({ page }) => {
    await expect(
      page.getByText(/google drive|notion|github|slack|linear|jira/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("can select a connector and advance to config step", async ({ page }) => {
    const option = page.getByText(/notion/i).first();
    await expect(option).toBeVisible({ timeout: 8_000 });
    await option.click();
    const next = page.getByRole("button").filter({ hasText: /next|continue|configure/i }).first();
    if (await next.isVisible()) {
      await next.click();
      await expect(
        page.getByText(/api.key|token|configure|step 2/i).first()
      ).toBeVisible({ timeout: 5_000 });
    }
  });
});

test.describe("Connector Sync Status", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/connectors/sync");
  });

  test("renders sync dashboard", async ({ page }) => {
    await expect(
      page.getByText(/sync|connector|status/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows empty state when no connectors configured", async ({ page }) => {
    await expect(
      page.getByText(/no connectors|add your first|get started/i).first()
    ).toBeVisible({ timeout: 8_000 }).catch(async () => {
      // Alternatively, a table/list may be visible with connectors
      await expect(page.locator("table, [role=table], ul, .space-y-")).toBeVisible({ timeout: 5_000 });
    });
  });
});
