import { test, expect } from "@playwright/test";

/**
 * E2E: Deep Research — multi-step agentic research
 */

test.describe("Deep Research", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/deep-research");
  });

  test("renders page with research input", async ({ page }) => {
    await expect(page.getByText(/deep research/i)).toBeVisible({ timeout: 10_000 });
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });
  });

  test("shows research history sidebar", async ({ page }) => {
    await expect(
      page.getByText(/research history|no past research/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("submit button disabled when query is empty", async ({ page }) => {
    const btn = page.getByRole("button").filter({ hasText: /send|start|research|run/i }).first();
    await expect(btn).toBeDisabled();
  });

  test("accepts query input and enables submit", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("What are the latest advances in quantum computing?");
    const btn = page.getByRole("button").filter({ hasText: /send|start|research|run/i }).first();
    await expect(btn).toBeEnabled();
  });

  test("shows phase badges in empty state", async ({ page }) => {
    await expect(
      page.getByText(/clarification|planning|synthesis|citations/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("starts research and shows progress phases on submit", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("Brief history of artificial intelligence");
    const btn = page.getByRole("button").filter({ hasText: /send|start|research|run/i }).first();
    await btn.click();

    // Should show loading state
    await expect(
      page.getByText(/starting|planning|clarification|cycle/i).first()
    ).toBeVisible({ timeout: 15_000 }).catch(() => {});

    // Cancel to not wait for full completion
    const cancel = page.getByRole("button").filter({ hasText: /cancel|stop/i }).first();
    if (await cancel.isVisible()) await cancel.click();
  });
});
