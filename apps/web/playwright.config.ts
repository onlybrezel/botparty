import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  workers: process.env.CI ? 1 : undefined,
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
  },
  webServer: [
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
