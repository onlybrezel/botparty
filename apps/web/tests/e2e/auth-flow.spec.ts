import { expect, test } from './support/fixtures';

test('dashboard requires authentication', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('settings requires authentication', async ({ page }) => {
  await page.goto('/settings');

  await expect(page).toHaveURL(/\/login/);
});

test('login page can switch to register mode', async ({ page }) => {
  await page.goto('/login');

  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(
    page.locator('form').getByRole('button', { name: /^create account$/i }),
  ).toBeVisible();
});
