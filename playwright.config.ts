import { defineConfig, devices } from '@playwright/test'

/**
 * Each project gets its own server and fresh database, so usage limits in
 * one project cannot leak into another.
 *
 * - default:    generous limits for the main upload flow
 * - ip-limits:  daily limit of 2, and X-Forwarded-For is only trusted from
 *               a TEST-NET address, so the local client (127.0.0.1) is an
 *               untrusted source that must not be able to spoof its IP
 * - global-cap: monthly cap that fits 3 reserved images
 */
const servers = {
  'default': { port: 3334, env: {} },
  'ip-limits': {
    port: 3336,
    env: { RATE_LIMIT_PER_IP_DAILY: '2', TRUSTED_PROXIES: '192.0.2.1' },
  },
  'global-cap': {
    // Mock estimate is 17,500 micro-euros per image: 3 reservations fit, a 4th does not.
    port: 3337,
    env: { GLOBAL_MONTHLY_CAP_EUR: '0.06' },
  },
} as const

const LIMITED_SPECS = ['**/ip_limits.spec.ts', '**/global_cap.spec.ts']

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'default',
      testIgnore: LIMITED_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3334' },
    },
    {
      name: 'ip-limits',
      testMatch: '**/ip_limits.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3336' },
    },
    {
      name: 'global-cap',
      testMatch: '**/global_cap.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3337' },
    },
  ],
  webServer: Object.entries(servers).map(([name, server]) => {
    const dbPath = `data/e2e/${name}.sqlite3`
    return {
      command: `rm -f ${dbPath} && node ace migration:run --force && node ace serve`,
      url: `http://localhost:${server.port}/health`,
      env: {
        NODE_ENV: 'test',
        HOST: 'localhost',
        PORT: String(server.port),
        DB_PATH: dbPath,
        RATE_LIMIT_PER_IP_PER_MINUTE: '1000',
        RATE_LIMIT_PER_IP_DAILY: '1000',
        GLOBAL_MONTHLY_CAP_EUR: '1000',
        TRUSTED_PROXIES: '',
        // Tests never call the real model API. NODE_ENV=test is what forces
        // the mock classifier: an empty value here does not override a key
        // in .env, because the env loader treats empty as unset.
        MODEL_API_KEY: '',
        ...server.env,
      },
      // Each server needs a fresh database, so never reuse a running one.
      reuseExistingServer: false,
      timeout: 120_000,
    }
  }),
})
