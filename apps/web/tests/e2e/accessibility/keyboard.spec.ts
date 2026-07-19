import { signIn } from '../support/auth';
import { expect, test } from '../support/fixtures';

test('skip link, primary navigation, and account menu are keyboard operable', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();

  await signIn(page, 'owner');
  const userMenu = page.getByRole('button', { name: /open user menu/i });
  await userMenu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(userMenu).toBeFocused();
});

test('mobile navigation opens, closes with Escape, and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
  await menuButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
  await expect(menuButton).toBeFocused();
});
