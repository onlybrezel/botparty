import { expect, test } from '../support/fixtures';
import { waitForLoginForm } from '../support/auth';

test('a new user can register, update settings, upload an avatar, export data, and delete the account', async ({
  page,
  browserIssues,
}) => {
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const username = `qa_${suffix}`.replaceAll('-', '_').slice(0, 32);
  const email = `${username}@example.test`;
  const password = 'FrontendQaPassword!2026';

  await page.goto('/login');
  await waitForLoginForm(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page
    .getByRole('checkbox', { name: /accept the Terms of Service.*Privacy Policy/i })
    .check();
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard#new-robot$/);
  await page.getByRole('button', { name: /open user menu/i }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.getByLabel('Display Name').fill('QA Annie 🚀');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Profile updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveClass(/light/);
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  const avatarInput = page.getByLabel(/Choose image|Uploading/);
  await avatarInput.setInputFiles({
    name: 'avatar.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(page.getByText('Choose a PNG, JPEG, or WebP image.')).toBeVisible();

  await avatarInput.setInputFiles('public/brand/favicon-32x32.png');
  await expect(page.getByText('Profile photo updated.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Current profile photo' })).toBeVisible();

  await page.getByLabel('Confirm your password').fill(password);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^botparty-export-${username}-\\d{4}-\\d{2}-\\d{2}\\.json$`),
  );
  await expect(page.getByText('Account export downloaded.')).toBeVisible();

  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete account?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete account?' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('button', { name: 'Yes, delete everything' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/login');
  await waitForLoginForm(page);
  browserIssues.allowHttpError(401, /\/api\/v1\/auth\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('form').getByRole('alert')).toBeVisible();
});
