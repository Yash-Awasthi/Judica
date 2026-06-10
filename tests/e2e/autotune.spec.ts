import { test, expect } from "@playwright/test";

/**
 * E2E: AutoTune — parameter tuning UI
 */

test.describe("AutoTune", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/autotune");
  });

  test("renders AutoTune page", async ({ page }) => {
    await expect(page.getByText(/autotune/i)).toBeVisible({ timeout: 10_000 });
  });

  test("shows parameter controls (sliders or inputs)", async ({ page }) => {
    // At least one slider or numeric input for temperature, etc.
    const sliders = page.locator('[role=slider], input[type=range]');
    const count   = await sliders.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("shows preset options or labels", async ({ page }) => {
    await expect(
      page.getByText(/temperature|top.p|max.tokens|preset|balanced|creative|precise/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("save or apply button is present", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /save|apply|update|run|benchmark/i }).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });
});
