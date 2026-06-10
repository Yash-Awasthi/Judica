import { test, expect } from "@playwright/test";

test.describe("Task Routing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/task-routing");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Task Routing")).toBeVisible();
  });

  test("has Classify, Stats, Config tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /classify/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /stats/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /config/i })).toBeVisible();
  });

  test("classify button disabled without prompt", async ({ page }) => {
    await expect(page.getByRole("button", { name: /classify & route/i })).toBeDisabled();
  });

  test("classify button enabled with prompt", async ({ page }) => {
    await page.getByPlaceholder(/enter a prompt/i).fill("Write a haiku about the ocean");
    await expect(page.getByRole("button", { name: /classify & route/i })).toBeEnabled();
  });

  test("stats tab shows loading or data", async ({ page }) => {
    await page.getByRole("tab", { name: /stats/i }).click();
    const loading = page.getByText(/loading stats/i);
    const noData = page.getByText(/no routing data/i);
    const total = page.getByText(/total routed/i);
    await expect(loading.or(noData).or(total)).toBeVisible({ timeout: 5000 });
  });
});
