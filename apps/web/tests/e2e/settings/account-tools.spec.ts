import { signIn } from '../support/auth';
import { expect, test } from '../support/fixtures';

test('session history supports large lists, filtering, replay details, and browser history', async ({
  page,
}) => {
  await signIn(page, 'owner');
  await page.goto('/sessions');

  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  await expect(page.locator('article')).toHaveCount(50);
  await page.getByLabel('Number of sessions').selectOption('100');
  await expect(page.locator('article')).toHaveCount(55);

  const filter = page.getByLabel('Filter sessions');
  await filter.fill('no-such-robot');
  await expect(page.getByText('No matching sessions')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.locator('article')).toHaveCount(55);

  await page.getByRole('link', { name: 'View replay' }).first().click();
  await expect(page).toHaveURL(/\/sessions\/10000000-/);
  await expect(page.getByRole('heading', { name: 'Session details' })).toBeVisible();
  await expect(page.getByText('No replay file matched this session yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open robot' })).toHaveAttribute('href', '/robot/e2e_owner/owner-test-robot');
  await page.getByRole('link', { name: 'Open robot' }).click();
  await expect(page).toHaveURL(/\/robot\/e2e_owner\/owner-test-robot$/);
  await expect(page.getByRole('heading', { name: 'Owner Test Robot', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Session details' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to sessions' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open robot' }).first().click();
  await expect(page).toHaveURL(/\/robot\/e2e_owner\/owner-test-robot$/);
  await expect(page.getByRole('heading', { name: 'Owner Test Robot', exact: true })).toBeVisible();
});

test('notifications and wallet exports remain usable with empty activity', async ({ page }) => {
  await signIn(page, 'viewer');

  const notifications = page.getByRole('button', { name: 'Notifications' });
  await notifications.click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('No notifications yet.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toHaveCount(0);
  await expect(notifications).toBeFocused();

  await page.goto('/wallet');
  await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible();
  await expect(page.getByText('No matching activity.')).toBeVisible();

  for (const format of ['CSV', 'JSON'] as const) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: format }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^botparty-wallet-\\d{4}-\\d{2}-\\d{2}\\.${format.toLowerCase()}$`),
    );
  }
});

test('appearance, privacy, and notification preferences can be changed and restored', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/settings');

  await page.evaluate(() => {
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => 'default',
    });
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: async () => 'granted' as NotificationPermission,
    });
  });

  await page.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveClass(/light/);
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'System' }).click();

  const maskTokens = page.getByRole('checkbox', { name: 'Hide claim token by default' });
  const initialMaskTokens = await maskTokens.isChecked();
  await page.getByText('Hide claim token by default', { exact: true }).click();
  await expect(maskTokens).toBeChecked({ checked: !initialMaskTokens });
  await page.getByText('Hide claim token by default', { exact: true }).click();
  await expect(maskTokens).toBeChecked({ checked: initialMaskTokens });

  for (const label of [
    'Notify when queue position changes',
    'Notify when your turn starts',
    'Email for queue turns',
    'Email when a robot goes offline',
    'Email for payments and payouts',
  ]) {
    const preference = page.getByRole('checkbox', { name: label });
    const initialValue = await preference.isChecked();
    await page.getByText(label, { exact: true }).click();
    await expect(preference).toBeChecked({ checked: !initialValue });
    await page.getByText(label, { exact: true }).click();
    await expect(preference).toBeChecked({ checked: initialValue });
  }

  await page.getByLabel('Quiet hours start').fill('22:00');
  await expect(page.getByLabel('Quiet hours start')).toHaveValue('22:00');
  await page.getByLabel('Quiet hours end').fill('08:00');
  await expect(page.getByLabel('Quiet hours end')).toHaveValue('08:00');
  await page.getByLabel('Quiet hours start').fill('');
  await expect(page.getByLabel('Quiet hours start')).toHaveValue('');

  await page.getByRole('button', { name: 'Enable desktop notifications' }).click();
  await expect(page.getByRole('button', { name: 'Notifications enabled' })).toBeDisabled();
  await expect(
    page.locator('[role="status"]').filter({ hasText: 'Desktop notifications enabled.' }),
  ).toBeVisible();

  const analytics = page.getByRole('checkbox', { name: 'Share product usage' });
  if (!(await analytics.isChecked())) {
    await page.getByText('Share product usage', { exact: true }).click();
  }
  await expect(
    page.locator('[role="status"]').filter({ hasText: 'Product analytics enabled.' }),
  ).toBeVisible();
  await page.getByText('Share product usage', { exact: true }).click();
  await expect(
    page.locator('[role="status"]').filter({ hasText: 'Product analytics disabled' }),
  ).toBeVisible();
});

test('sign out of all devices revokes the visible browser session', async ({ page }) => {
  await signIn(page, 'viewer');
  await page.goto('/settings');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Sign out of every browser and device');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Sign out of all devices' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
  // Let Firefox finish the login page's legal-link prefetches before the
  // browser context is closed by the test runner.
  await page.waitForLoadState('networkidle');
});
