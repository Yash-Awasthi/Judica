import { test, expect } from "@playwright/test";

test.describe("Fine-Tune Pipeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fine-tune");
  });

  test("renders page header", async ({ page }) => {
    await expect(page.getByText(/fine-tune pipeline/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows training dataset card", async ({ page }) => {
    await expect(page.getByText(/training dataset/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("shows export card", async ({ page }) => {
    await expect(page.getByText(/export training data/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("shows initiate job card", async ({ page }) => {
    await expect(page.getByText(/start fine-tune job/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("shows base model selector", async ({ page }) => {
    await expect(page.getByText(/base model/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("shows Stripe warning", async ({ page }) => {
    await expect(page.getByText(/upload.*training data/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
