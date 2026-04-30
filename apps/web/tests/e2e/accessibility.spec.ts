import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/',
  '/login',
  '/leaderboard',
  '/status',
  '/imprint',
  '/cookies',
  '/privacy',
  '/terms',
];

for (const route of ROUTES) {
  test(`serious accessibility issues are absent on ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .options({
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa'],
        },
      })
      .analyze();
    const seriousOrWorse = results.violations.filter((violation) =>
      violation.impact === 'serious' || violation.impact === 'critical');
    expect(seriousOrWorse).toEqual([]);
  });
}
