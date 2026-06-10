import { test, expect } from "@playwright/test";

test.describe("Structured Extraction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/extraction");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Structured Extraction")).toBeVisible();
  });

  test("has Extract, Schemas, Job History tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /extract/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /schemas/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /job history/i })).toBeVisible();
  });

  test("extract tab has source text area", async ({ page }) => {
    await expect(page.getByPlaceholder(/paste unstructured text/i)).toBeVisible();
  });

  test("extract button disabled without text", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^extract$/i })).toBeDisabled();
  });

  test("infer schema button disabled without text", async ({ page }) => {
    await expect(page.getByRole("button", { name: /infer schema/i })).toBeDisabled();
  });

  test("schemas tab shows empty state or list", async ({ page }) => {
    await page.getByRole("tab", { name: /schemas/i }).click();
    const empty = page.getByText(/no schemas/i);
    const addBtn = page.getByRole("button", { name: /add schema/i });
    const items = page.locator(".border").first();
    await expect(empty.or(addBtn).or(items)).toBeVisible();
  });
});
