import { signIn, signOut } from '../support/auth';
import { expect, test } from '../support/fixtures';

test('public desktop pages remain visually stable in light and dark themes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page).toHaveScreenshot('home-desktop-light.png', { fullPage: true });
  await page.goto('/login');
  await expect(page).toHaveScreenshot('login-desktop-light.png', { fullPage: true });
  await page.goto('/reset-password');
  await expect(page).toHaveScreenshot('reset-password-missing-token-light.png', { fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/explore');
  await expect(page).toHaveScreenshot('explore-desktop-dark.png', { fullPage: true });
});

test('mobile navigation and login remain visually stable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page).toHaveScreenshot('home-mobile-menu-dark.png', { fullPage: true });
  await page.getByRole('button', { name: 'Close navigation menu' }).click();
  await page.goto('/login');
  await expect(page).toHaveScreenshot('login-mobile-dark.png', { fullPage: true });
});

test('owner dashboard and admin console remain visually stable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await signIn(page, 'owner');
  await page.goto('/dashboard');
  await expect(page).toHaveScreenshot('owner-dashboard-desktop-dark.png', { fullPage: true });
  await page.getByRole('button', { name: 'Open dashboard for Owner Test Robot' }).click();
  await expect(page.getByLabel('Robot Name')).toBeVisible();
  await expect(page).toHaveScreenshot('owner-dashboard-selected-desktop-dark.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot('owner-dashboard-selected-mobile-dark.png');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/settings');
  await expect(page).toHaveScreenshot('owner-settings-desktop-dark.png', { fullPage: true });
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page).toHaveScreenshot('notifications-dialog-desktop-dark.png');
  await page.keyboard.press('Escape');

  await page.goto('/sessions');
  await expect(page.locator('article').first()).toBeVisible();
  await expect(page).toHaveScreenshot('owner-sessions-large-desktop-dark.png', { fullPage: true });

  await signOut(page);
  await signIn(page, 'admin');
  await page.goto('/mod');
  // The moderation overview waits for its runtime-health request before it
  // renders. In the Docker test environment that request can legitimately
  // consume the API's five-second upstream timeout.
  await expect(page.getByRole('heading', { name: 'Moderation', level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveScreenshot('admin-moderation-desktop-dark.png', {
    fullPage: true,
    mask: [page.getByText(/^Updated /)],
    maskColor: '#09090b',
  });
});

test('empty signed-in dashboard remains visually intentional', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await signIn(page, 'viewer');
  await page.goto('/dashboard');
  await expect(page).toHaveScreenshot('viewer-dashboard-empty-desktop-dark.png', {
    fullPage: true,
  });
});
