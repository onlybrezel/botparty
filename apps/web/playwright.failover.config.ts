import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e/multi-instance',
  testIgnore: [],
  projects: [
    {
      name: 'failover-chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
