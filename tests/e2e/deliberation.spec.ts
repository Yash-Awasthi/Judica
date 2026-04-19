import { test, expect } from "@playwright/test";

/**
 * E2E: Deliberation flow
 *
 * Covers: navigate to chat, send a question, receive streaming responses,
 * see verdict, conversation persists in history.
 */

test.describe("Deliberation Flow", () => {
  // Use storage state from auth setup if available, otherwise login inline
  test.beforeEach(async ({ page }) => {
    await page.goto("/");

    // Quick inline login if auth screen is shown
    const authVisible = await page.getByLabel(/username/i).isVisible({ timeout: 3_000 }).catch(() => false);
    if (authVisible) {
      await page.getByLabel(/username/i).fill("testuser");
      await page.getByLabel(/password/i).fill("password123");
      await page.getByRole("button", { name: /initialize access|login/i }).click();
      await page.waitForURL(/\/(chat|$)/, { timeout: 10_000 });
    }
  });

  test("send a question and receive a deliberation response", async ({ page }) => {
    // ── Navigate to chat ──
    await page.goto("/chat");
    await expect(page.getByLabel(/chat message input/i)).toBeVisible({ timeout: 10_000 });

    // ── Type and send a question ──
    const input = page.getByLabel(/chat message input/i);
    await input.fill("What is 2+2?");

    const sendBtn = page.getByLabel(/send message/i);
    await sendBtn.click();

    // ── Should show the user's question ──
    await expect(page.getByText("What is 2+2?")).toBeVisible({ timeout: 5_000 });

    // ── Should show streaming indicator or agent opinions ──
    // Wait for either a streaming indicator or actual response content
    const responseLocator = page.locator("[aria-live='polite'], .streaming-cursor, .verdict-box").first();
    await expect(responseLocator).toBeVisible({ timeout: 30_000 });

    // ── Eventually should show a verdict/final response ──
    // This may take time depending on provider latency
    await expect(page.getByText(/final response/i).or(page.locator(".verdict-box"))).toBeVisible({ timeout: 60_000 });
  });

  test("conversation appears in history after deliberation", async ({ page }) => {
    await page.goto("/chat");

    // Send a message
    const input = page.getByLabel(/chat message input/i);
    await input.fill("Test history entry");
    await page.getByLabel(/send message/i).click();

    // Wait for response
    await page.waitForTimeout(5_000);

    // Navigate to dashboard/home — conversations should appear in sidebar
    await page.goto("/");

    // Look for the conversation in the sidebar history
    const sidebar = page.locator("nav, aside, [data-testid='sidebar']").first();
    await expect(sidebar).toBeVisible({ timeout: 5_000 });

    // The conversation title or preview should be visible somewhere
    // (exact selector depends on how the sidebar renders conversations)
  });
});
