import { monitorBrowserIssues } from '../support/fixtures';
import { expect, test } from '../support/fixtures';

test('password reset and email verification expose complete visible recovery states', async ({
  page,
  browserIssues,
}) => {
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page.getByText('This password reset link is incomplete.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update password' })).toBeDisabled();

  browserIssues.allowHttpError(400, /\/api\/v1\/auth\/reset-password$/);
  await page.goto('/reset-password?token=invalid-e2e-token');
  await page.getByLabel('New password').fill('ReplacementPassword!2026');
  await page.getByLabel('Confirm password').fill('ReplacementPassword!2026');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(/invalid|expired/i);

  await page.goto('/verify-email');
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await page.getByLabel('Email').fill('viewer@botparty.test');
  await page.getByRole('button', { name: 'Resend verification email' }).click();
  await expect(page.getByRole('status')).toContainText(/verification/i);
  await page.getByRole('link', { name: 'Back to sign-in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('embedded rooms and unknown routes provide usable browser paths', async ({
  page,
  browserIssues,
}) => {
  await page.goto('/embed/admin/test-robot');
  await expect(page.getByText('Test Robot', { exact: true })).toBeVisible();
  await expect(page.getByText('This robot is currently offline.')).toBeVisible();

  const fullRoomPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open full room' }).click();
  const fullRoom = await fullRoomPromise;
  const fullRoomIssues = monitorBrowserIssues(fullRoom);
  await expect(fullRoom).toHaveURL(/\/robot\/admin\/test-robot$/);
  await expect(fullRoom.getByRole('heading', { name: 'Test Robot' })).toBeVisible();
  fullRoomIssues.assertNoUnexpectedIssues();
  await fullRoom.close();

  browserIssues.allowHttpError(404, /\/route-that-does-not-exist$/);
  await page.goto('/route-that-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go home' }).click();
  await expect(page).toHaveURL(/\/$/);
});
