import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  maxFailures: process.env.CI ? 0 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Sandboxed dev environments ship a system Chromium instead of the
    // Playwright-managed download; point PW_CHROMIUM_PATH at it to reuse it.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testMatch: ['modern.spec.ts', 'responsive.spec.ts', 'multiplayer.spec.ts', 'density.spec.ts', 'graphics.spec.ts', 'celebrations.spec.ts', 'operations.spec.ts', 'planning-advice.spec.ts'], grepInvert: /link duel:/, use: { ...devices['Desktop Safari'], launchOptions: {} } },
    { name: 'mobile-webkit', testMatch: ['modern.spec.ts', 'operations.spec.ts', 'planning-advice.spec.ts'], grepInvert: /operations 1440px|planning advice 1440px/, use: { ...devices['iPhone 13'], launchOptions: {} } },
  ],
  webServer: {
    command: process.env.PW_PREBUILT ? 'npm run preview' : 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
