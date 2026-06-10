import { test, expect } from "@playwright/test";

test.describe("Quality Center", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/quality");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Quality Center")).toBeVisible();
  });

  test("has Hallucination and Speculative tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /hallucination/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /speculative/i })).toBeVisible();
  });

  test("hallucination tab shows mode buttons", async ({ page }) => {
    await expect(page.getByRole("button", { name: /single score/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /batch score/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /groundedness/i })).toBeVisible();
  });

  test("score button disabled when no input", async ({ page }) => {
    const btn = page.getByRole("button", { name: /score response/i });
    await expect(btn).toBeDisabled();
  });

  test("score button enabled with input", async ({ page }) => {
    await page.getByPlaceholder(/ai response to score/i).fill("Paris is the capital of France.");
    const btn = page.getByRole("button", { name: /score response/i });
    await expect(btn).toBeEnabled();
  });

  test("speculative tab shows stats section", async ({ page }) => {
    await page.getByRole("tab", { name: /speculative/i }).click();
    await expect(page.getByText(/speculative decoding/i)).toBeVisible();
  });

  test("speculative run button disabled when no prompt", async ({ page }) => {
    await page.getByRole("tab", { name: /speculative/i }).click();
    const btn = page.getByRole("button", { name: /^run$/i });
    await expect(btn).toBeDisabled();
  });
});
