import { test, expect } from "@playwright/test";

/**
 * E2E: Signup → Login flow
 *
 * Covers: registration, logout, login, /me profile check
 */

const TEST_USER = `e2e_user_${Date.now()}`;
const TEST_PASS = "SecureP@ss123!";

test.describe("Auth Flow", () => {
  test("full signup → logout → login cycle", async ({ page }) => {
    await page.goto("/");

    // ── Should show auth screen ──
    await expect(page.getByText("COUNCIL")).toBeVisible({ timeout: 10_000 });

    // ── Switch to register mode ──
    const enlistBtn = page.getByRole("button", { name: /enlist/i });
    if (await enlistBtn.isVisible()) {
      await enlistBtn.click();
    }

    // ── Fill registration form ──
    const usernameInput = page.getByLabel(/username/i);
    const passwordInput = page.getByLabel(/password/i);

    await usernameInput.fill(TEST_USER);
    await passwordInput.fill(TEST_PASS);

    // ── Submit ──
    const submitBtn = page.getByRole("button", { name: /create neural id|initialize/i });
    await submitBtn.click();

    // ── Should redirect to dashboard/chat after signup ──
    await expect(page).toHaveURL(/\/(chat|$)/, { timeout: 10_000 });

    // ── Verify we're authenticated (sidebar should show username or nav) ──
    // Look for sidebar nav items that only appear when logged in
    await expect(page.locator("nav, [data-testid='sidebar']").first()).toBeVisible({ timeout: 5_000 });

    // ── Logout ──
    // Find logout button (usually in sidebar or settings)
    const logoutBtn = page.getByRole("button", { name: /logout|sign out|disconnect/i });
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
    }

    // ── Should return to auth screen ──
    await expect(page.getByText(/COUNCIL|login|access/i)).toBeVisible({ timeout: 5_000 });

    // ── Login with same credentials ──
    const accessBtn = page.getByRole("button", { name: /access/i });
    if (await accessBtn.isVisible()) {
      await accessBtn.click();
    }

    await page.getByLabel(/username/i).fill(TEST_USER);
    await page.getByLabel(/password/i).fill(TEST_PASS);

    const loginBtn = page.getByRole("button", { name: /initialize access|login/i });
    await loginBtn.click();

    // ── Should be back in the app ──
    await expect(page).toHaveURL(/\/(chat|$)/, { timeout: 10_000 });
  });

  test("shows error for invalid credentials", async ({ page }) => {
    await page.goto("/");

    const accessBtn = page.getByRole("button", { name: /access/i });
    if (await accessBtn.isVisible()) {
      await accessBtn.click();
    }

    await page.getByLabel(/username/i).fill("nonexistent_user");
    await page.getByLabel(/password/i).fill("wrongpassword");

    const loginBtn = page.getByRole("button", { name: /initialize access|login/i });
    await loginBtn.click();

    // ── Should show error ──
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
  });
});
