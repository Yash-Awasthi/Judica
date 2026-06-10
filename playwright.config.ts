import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const STORAGE_STATE = path.resolve('tests/e2e/.auth/user.json');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // ── Auth setup — runs once, saves session ────────────────────────────────
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // ── Main browser tests — depend on auth setup ────────────────────────────
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },

    // Firefox and WebKit only locally — too slow for CI
    ...(!process.env.CI ? [
      {
        name: 'firefox',
        use: {
          ...devices['Desktop Firefox'],
          storageState: STORAGE_STATE,
        },
        dependencies: ['setup'],
        testIgnore: /auth\.setup\.ts/,
      },
      {
        name: 'webkit',
        use: {
          ...devices['Desktop Safari'],
          storageState: STORAGE_STATE,
        },
        dependencies: ['setup'],
        testIgnore: /auth\.setup\.ts/,
      },
    ] : []),
  ],

  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev --prefix frontend',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
