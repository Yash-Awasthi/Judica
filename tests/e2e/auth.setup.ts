/**
 * Playwright global auth setup
 *
 * Runs once before the test suite. Registers a shared test user,
 * saves storage state to disk so all specs can reuse the session
 * without repeating the login flow.
 *
 * Referenced in playwright.config.ts via `project.dependencies`.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

export const STORAGE_STATE = path.resolve("tests/e2e/.auth/user.json");

const E2E_USER = `setup_user_${Date.now()}`;
const E2E_PASS = "SecureSetupP@ss1!";

setup("authenticate", async ({ page }) => {
  await page.goto("/");

  // ── Wait for auth screen ──────────────────────────────────────────────────
  await expect(page.getByText(/COUNCIL|login|access|judica/i).first()).toBeVisible({
    timeout: 15_000,
  });

  // ── Click Enlist / Register ───────────────────────────────────────────────
  const enlistBtn = page.getByRole("button", { name: /enlist|register|sign up/i });
  if (await enlistBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await enlistBtn.click();
  }

  // ── Fill registration form ────────────────────────────────────────────────
  const usernameInput = page.getByLabel(/username/i);
  const passwordInput = page.getByLabel(/password/i);

  if (await usernameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await usernameInput.fill(E2E_USER);
    await passwordInput.fill(E2E_PASS);

    const submitBtn = page.getByRole("button", {
      name: /create|initialize|register|sign up|enlist/i,
    });
    await submitBtn.click();
    await page.waitForURL(/\/(chat|dashboard|$)/, { timeout: 15_000 });
  } else {
    // App uses localStorage-only auth (setup wizard) — create via wizard
    const nameInput = page.getByPlaceholder(/your name|e\.g\./i);
    if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await nameInput.fill("E2E User");
      const goBtn = page.getByRole("button", { name: /get started|continue|enter/i });
      await goBtn.click();
      await page.waitForURL(/\/(chat|$)/, { timeout: 10_000 });
    }
  }

  // ── Verify authenticated ──────────────────────────────────────────────────
  await expect(
    page.locator("nav, aside, [data-testid='sidebar'], main").first()
  ).toBeVisible({ timeout: 10_000 });

  // ── Save storage state ────────────────────────────────────────────────────
  await page.context().storageState({ path: STORAGE_STATE });
});
