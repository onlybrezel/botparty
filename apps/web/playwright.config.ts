import { defineConfig } from '@playwright/test';

const usesExternalServers = process.env.PLAYWRIGHT_EXTERNAL_SERVERS === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? './test-results',
  timeout: 60_000,
  // The browser suite intentionally shares one deterministic seeded account and
  // robot lifecycle. Parallelism belongs in isolated projects, not within this stateful flow.
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
  },
  webServer: usesExternalServers ? undefined : [
    {
      command: 'pnpm --filter @botparty/api dev',
      url: `${process.env.API_URL ?? 'http://127.0.0.1:4000'}/api/v1/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev',
      url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_LEGAL_OPERATOR_NAME:
          process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME ?? 'BotParty Test Operator',
        NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL:
          process.env.NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL ?? 'legal@botparty.test',
        NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS:
          process.env.NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS ?? 'Teststrasse 1, 10115 Berlin',
      },
    },
  ],
});
