import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e/visual',
  testIgnore: [],
  projects: [
    {
      name: 'visual-chromium',
      use: { browserName: 'chromium' },
    },
  ],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.0002,
    },
  },
});
