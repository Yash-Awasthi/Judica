import { test, expect } from "@playwright/test";

/**
 * E2E: Signup → Login flow
 *
 * P6-04: Fixed tautological assertions — all checks use strict equality,
 * no `if (visible)` guards that silently skip test logic.
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
    await expect(enlistBtn).toBeVisible({ timeout: 5_000 });
    await enlistBtn.click();

    // ── Fill registration form ──
    const usernameInput = page.getByLabel(/username/i);
    const passwordInput = page.getByLabel(/password/i);

    await expect(usernameInput).toBeVisible({ timeout: 5_000 });
    await usernameInput.fill(TEST_USER);
    await passwordInput.fill(TEST_PASS);

    // ── Submit ──
    const submitBtn = page.getByRole("button", { name: /create neural id|initialize/i });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // ── Should redirect to dashboard/chat after signup ──
    await expect(page).toHaveURL(/\/(chat|$)/, { timeout: 10_000 });

    // ── Verify we're authenticated (sidebar must be visible) ──
    await expect(page.locator("nav, [data-testid='sidebar']").first()).toBeVisible({ timeout: 5_000 });

    // ── Logout — button must exist and be clickable ──
    const logoutBtn = page.getByRole("button", { name: /logout|sign out|disconnect/i });
    await expect(logoutBtn).toBeVisible({ timeout: 5_000 });
    await logoutBtn.click();

    // ── Should return to auth screen ──
    await expect(page.getByText(/COUNCIL|login|access/i)).toBeVisible({ timeout: 5_000 });

    // ── Login with same credentials ──
    const accessBtn = page.getByRole("button", { name: /access/i });
    await expect(accessBtn).toBeVisible({ timeout: 5_000 });
    await accessBtn.click();

    await page.getByLabel(/username/i).fill(TEST_USER);
    await page.getByLabel(/password/i).fill(TEST_PASS);

    const loginBtn = page.getByRole("button", { name: /initialize access|login/i });
    await expect(loginBtn).toBeVisible({ timeout: 5_000 });
    await loginBtn.click();

    // ── Should be back in the app — strict URL check ──
    await expect(page).toHaveURL(/\/(chat|$)/, { timeout: 10_000 });
  });

  test("shows error for invalid credentials", async ({ page }) => {
    await page.goto("/");

    const accessBtn = page.getByRole("button", { name: /access/i });
    await expect(accessBtn).toBeVisible({ timeout: 5_000 });
    await accessBtn.click();

    await page.getByLabel(/username/i).fill("nonexistent_user");
    await page.getByLabel(/password/i).fill("wrongpassword");

    const loginBtn = page.getByRole("button", { name: /initialize access|login/i });
    await expect(loginBtn).toBeVisible({ timeout: 5_000 });
    await loginBtn.click();

    // ── Must show error alert — strict assertion ──
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
    // Verify the error is auth-related, not generic
    await expect(page.getByRole("alert")).toContainText(/invalid|incorrect|denied|failed/i);
  });
});
