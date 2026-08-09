import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import AxeBuilder from '@axe-core/playwright';
import { signIn, type E2ERole } from './support/auth';

const ROUTES = [
  '/',
  '/login',
  '/leaderboard',
  '/status',
  '/imprint',
  '/cookies',
  '/privacy',
  '/terms',
  '/pricing',
  '/explore',
  '/explore/search?q=Test',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/docs',
  '/docs/getting-started',
  '/docs/multi-camera',
  '/docs/obs-whip',
  '/docs/robot-setup',
  '/robot/admin/test-robot',
  '/embed/admin/test-robot',
  '/missing-page-for-accessibility-check',
];

async function expectNoWcagViolations(page: Page, context: string) {
  await page.waitForLoadState('networkidle');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const root = document.documentElement;
          const theme = root.dataset['theme'];
          const styles = window.getComputedStyle(root);
          const expectedColors =
            theme === 'light'
              ? { foreground: '#0f172a', mutedForeground: '#5b6476' }
              : { foreground: '#f4f4f5', mutedForeground: '#9092a8' };

          return (
            (theme === 'light' || theme === 'dark') &&
            root.classList.contains(theme) &&
            root.dataset['themeChanging'] !== 'true' &&
            styles.getPropertyValue('--foreground').trim() === expectedColors.foreground &&
            styles.getPropertyValue('--muted-foreground').trim() === expectedColors.mutedForeground
          );
        }),
      `${context} theme is fully applied`,
    )
    .toBe(true);

  const results = await new AxeBuilder({ page })
    .options({
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
      },
    })
    .analyze();

  expect(results.violations, context).toEqual([]);
}

for (const route of ROUTES) {
  test(`WCAG accessibility issues are absent on ${route}`, async ({ page, browserIssues }) => {
    if (route === '/missing-page-for-accessibility-check') {
      browserIssues.allowHttpError(404, /\/missing-page-for-accessibility-check$/);
    }
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expectNoWcagViolations(page, route);
  });
}

const authenticatedRoutes: Array<{ role: E2ERole; routes: string[] }> = [
  { role: 'owner', routes: ['/dashboard', '/wallet', '/settings', '/sessions'] },
  { role: 'moderator', routes: ['/mod'] },
  { role: 'admin', routes: ['/mod', '/mod/analytics', '/mod/billing', '/mod/payouts'] },
];

for (const roleCase of authenticatedRoutes) {
  test(`${roleCase.role} pages have no WCAG violations`, async ({ page }) => {
    await signIn(page, roleCase.role);
    for (const route of roleCase.routes) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      await expectNoWcagViolations(page, `${roleCase.role} ${route}`);
    }
  });
}

test('owner dialogs and selected robot controls have no WCAG violations', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open dashboard for Owner Test Robot' }).click();
  await expect(page.getByLabel('Robot Name')).toBeVisible();
  await expectNoWcagViolations(page, 'selected owner robot dashboard');

  await page.getByRole('button', { name: 'Open OBS connection help' }).click();
  await expect(page.getByRole('dialog', { name: 'OBS low-latency setup' })).toBeVisible();
  await expectNoWcagViolations(page, 'OBS help dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  await expectNoWcagViolations(page, 'notifications dialog');
});

test('representative public and owner interfaces have no dark-theme WCAG violations', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  for (const route of ['/', '/docs/robot-setup', '/robot/admin/test-robot']) {
    await page.goto(route);
    await expectNoWcagViolations(page, `dark theme ${route}`);
  }

  await signIn(page, 'owner');
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open dashboard for Owner Test Robot' }).click();
  await expectNoWcagViolations(page, 'dark theme selected owner robot dashboard');
});
