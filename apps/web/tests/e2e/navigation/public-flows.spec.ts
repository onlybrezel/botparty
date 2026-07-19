import { expect, test } from '../support/fixtures';
import { waitForLoginForm } from '../support/auth';

test('guest navigation, primary calls to action, and browser history work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Explore rooms' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole('heading', { name: 'Explore robot rooms' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'Host a robot' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goBack();
  await page.getByRole('navigation').getByRole('link', { name: 'Leaderboard' }).click();
  await expect(page).toHaveURL(/\/leaderboard$/);
  await page.getByRole('link', { name: '30 days' }).click();
  await expect(page).toHaveURL(/period=30d/);
  await expect(page.getByRole('link', { name: 'Test Robot', exact: true })).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Pricing' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await page
    .getByRole('link', { name: /sign in/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/login$/);
});

test('explore search, status, sort, clear, and room navigation are usable', async ({ page }) => {
  await page.goto('/explore');
  const search = page.getByPlaceholder(/Search robot names/);
  await search.fill('Test Robot');
  await page.getByLabel('Robot status').selectOption('OFFLINE');
  await page.getByLabel('Sort order').selectOption('name');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(page).toHaveURL(/\/explore\/search\?/);
  await expect(page).toHaveURL(/q=Test(?:\+|%20)Robot/);
  const robotLink = page.getByRole('link', { name: /Test Robot by Administrator/ });
  await expect(robotLink).toBeVisible();
  await robotLink.click();
  await expect(page).toHaveURL(/\/robot\/admin\/test-robot$/);
  await expect(page.getByRole('heading', { name: 'Test Robot' })).toBeVisible();

  await page.goBack();
  await page.getByRole('link', { name: 'Clear' }).click();
  await expect(page).toHaveURL(/\/explore$/);
});

test('documentation and legal footer routes form a complete navigable path', async ({ page }) => {
  await page.goto('/docs');
  const docs = [
    ['Getting Started', /\/docs\/getting-started$/],
    ['Multi-Camera', /\/docs\/multi-camera$/],
    ['OBS via WHIP', /\/docs\/obs-whip$/],
  ] as const;

  for (const [label, route] of docs) {
    await page
      .getByRole('link', { name: new RegExp(label, 'i') })
      .first()
      .click();
    await expect(page).toHaveURL(route);
    await expect(page.getByRole('heading', { name: label })).toBeVisible();
    await page.goto('/docs');
  }

  const footerRoutes = [
    ['Terms', /\/terms$/],
    ['Privacy', /\/privacy$/],
    ['Imprint', /\/imprint$/],
    ['Cookie Notice', /\/cookies$/],
    ['Status', /\/status$/],
    ['Robot setup', /\/docs\/robot-setup$/],
  ] as const;
  for (const [label, route] of footerRoutes) {
    await page.getByRole('contentinfo').getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(route);
    await expect(page.locator('main')).toBeVisible();
  }
});

test('authentication forms expose validation, reset, and registration paths', async ({ page }) => {
  await page.goto('/login');
  await waitForLoginForm(page);
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password').fill('short');
  await page.getByLabel('Password').blur();
  await expect(page.getByText(/valid email/i)).toBeVisible();

  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();
  await page.getByLabel('Email').fill('viewer@botparty.test');
  await page.getByRole('button', { name: /send reset link/i }).click();
  await expect(page.getByRole('status')).toContainText('If the account exists');

  await page.getByRole('link', { name: /back to login/i }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.locator('form').getByRole('button', { name: 'Create account' })).toBeDisabled();
});
