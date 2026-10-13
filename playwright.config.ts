import { defineConfig, devices } from '@playwright/test'

const PORT = 3334

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ace serve',
    url: `http://localhost:${PORT}/health`,
    env: { NODE_ENV: 'test', PORT: String(PORT), HOST: 'localhost' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
