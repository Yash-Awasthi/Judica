import { test, expect } from "@playwright/test";

test.describe("Verifiable Pipelines", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/verifiable");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Verifiable Pipelines")).toBeVisible();
  });

  test("has text input and pipeline field", async ({ page }) => {
    await expect(page.getByPlaceholder(/ai-generated text/i)).toBeVisible();
    await expect(page.getByPlaceholder(/e.g. factual/i)).toBeVisible();
  });

  test("verify button disabled without text", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^verify$/i })).toBeDisabled();
  });

  test("verify button enabled with text", async ({ page }) => {
    await page.getByPlaceholder(/ai-generated text/i).fill("The Earth orbits the Sun.");
    await expect(page.getByRole("button", { name: /^verify$/i })).toBeEnabled();
  });

  test("has context input field", async ({ page }) => {
    await expect(page.getByPlaceholder(/source context/i)).toBeVisible();
  });
});
