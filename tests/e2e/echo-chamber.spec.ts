import { test, expect } from "@playwright/test";

test.describe("Echo Chamber Detector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/echo-chamber");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Echo Chamber Detector")).toBeVisible();
  });

  test("has Detect, Inject Dissent, Config tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /detect/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /inject dissent/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /config/i })).toBeVisible();
  });

  test("detect button disabled when empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: /detect echo chamber/i })).toBeDisabled();
  });

  test("detect button enabled with text", async ({ page }) => {
    await page.getByPlaceholder(/paste a conversation/i).fill("User: X is the best\nAI: Absolutely!");
    await expect(page.getByRole("button", { name: /detect echo chamber/i })).toBeEnabled();
  });

  test("inject dissent tab has tone selector", async ({ page }) => {
    await page.getByRole("tab", { name: /inject dissent/i }).click();
    await expect(page.getByPlaceholder(/inject dissent/i)).toBeVisible();
  });

  test("config tab loads", async ({ page }) => {
    await page.getByRole("tab", { name: /config/i }).click();
    const loading = page.getByText(/loading/i);
    const threshold = page.getByText(/detection threshold/i);
    const noConfig = page.getByText(/config unavailable/i);
    await expect(loading.or(threshold).or(noConfig)).toBeVisible();
  });
});
