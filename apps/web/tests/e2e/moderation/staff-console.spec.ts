import { signIn } from '../support/auth';
import { expect, test } from '../support/fixtures';

test('moderators can review moderation, runtime, and redacted user information without admin controls', async ({
  page,
}) => {
  await signIn(page, 'moderator');
  await page.goto('/mod');
  await expect(page.getByRole('heading', { name: 'Moderation', exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const sections = page.getByRole('navigation', { name: 'Moderation sections' });
  await expect(sections.getByRole('button', { name: 'Moderation' })).toBeVisible();
  await expect(sections.getByRole('button', { name: 'Runtime' })).toBeVisible();
  await expect(sections.getByRole('button', { name: 'Users' })).toBeVisible();
  await expect(sections.getByRole('button', { name: 'Robots' })).toHaveCount(0);

  await sections.getByRole('button', { name: 'Runtime' }).click();
  await expect(page.getByRole('heading', { name: 'Runtime Overview' })).toBeVisible();
  await expect(page.getByText('Recording Control (Admin)')).toHaveCount(0);

  await sections.getByRole('button', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await page.getByPlaceholder('Search users...').fill('e2e_viewer');
  const viewerRow = page.getByRole('button', { name: /Contact details hidden.*USER/i });
  await expect(viewerRow).toBeVisible();
  await expect(viewerRow).toBeDisabled();
});

test('administrators can use every staff section and edit a test account through the UI', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await page.goto('/mod');
  const sections = page.getByRole('navigation', { name: 'Moderation sections' });

  await sections.getByRole('button', { name: 'Runtime' }).click();
  await expect(page.getByText('Recording Control (Admin)')).toBeVisible();
  await expect(page.getByText('Recordings Library (Admin)')).toBeVisible();

  await sections.getByRole('button', { name: 'Robots' }).click();
  await expect(page.getByRole('heading', { name: 'Manage Robots' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Preview' }).first()).toBeVisible();

  await sections.getByRole('button', { name: 'Users' }).click();
  await page.getByPlaceholder('Search users...').fill('e2e_disabled');
  await page.getByRole('button', { name: /Dana Disabled.*disabled@botparty\.test.*USER/i }).click();
  await expect(page.getByText('Edit user')).toBeVisible();
  await page.getByPlaceholder('Credits').fill('7');
  await page.getByRole('button', { name: 'Save user' }).click();
  await expect(page.getByRole('button', { name: /Dana Disabled.*7 cr/i })).toBeVisible();

  await page.getByRole('button', { name: /Dana Disabled.*disabled@botparty\.test.*USER/i }).click();
  await page.getByPlaceholder('Credits').fill('0');
  await page.getByRole('button', { name: 'Save user' }).click();
  await expect(page.getByRole('button', { name: /Dana Disabled.*0 cr/i })).toBeVisible();

  await page.goto('/mod/analytics');
  await expect(page.getByRole('heading', { name: 'Product analytics' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.goto('/mod/billing');
  await expect(page.getByRole('heading', { name: /Billing/i })).toBeVisible();
  await expect(page.getByText('Loading...')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.goto('/mod/payouts');
  await expect(page.getByRole('heading', { name: /Payout/i })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
});
