import type { Page } from '@playwright/test';
import { signIn } from '../support/auth';
import { expect, monitorBrowserIssues, test } from '../support/fixtures';

async function updateViewerRole(adminPage: Page, role: 'USER' | 'MOD') {
  await adminPage.goto('/mod');
  const sections = adminPage.getByRole('navigation', { name: 'Moderation sections' });
  await sections.getByRole('button', { name: 'Users' }).click();
  await adminPage.getByLabel('Search users').fill('e2e_viewer');
  await adminPage.getByRole('button').filter({ hasText: 'viewer@botparty.test' }).click();

  const roleSelect = adminPage.getByLabel('Role');
  if ((await roleSelect.inputValue()) === role) {
    return;
  }

  await roleSelect.selectOption(role);
  const updateFinished = adminPage.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/v1\/users\/admin\/[^/]+$/.test(response.url()),
  );
  await adminPage.getByRole('button', { name: 'Save user' }).click();
  const updateResponse = await updateFinished;
  expect(updateResponse.status()).toBe(200);
  await expect(adminPage.getByText('User updated.')).toBeVisible();
}

test('an active user session reflects granted and revoked moderator access after reload', async ({
  browser,
  page,
}) => {
  const baseURL = String(test.info().project.use.baseURL);
  const adminContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  const adminIssues = monitorBrowserIssues(adminPage);
  try {
    await signIn(adminPage, 'admin');
    // Every browser project shares the same Docker database. Normalize the
    // mutable fixture before opening the viewer session and restore it below.
    await updateViewerRole(adminPage, 'USER');
    await signIn(page, 'viewer');

    await updateViewerRole(adminPage, 'MOD');

    await page.reload();
    await page.getByRole('button', { name: /open user menu/i }).click();
    await expect(page.getByRole('link', { name: 'Moderation', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Moderation', exact: true }).click();
    await expect(page).toHaveURL(/\/mod$/);

    await updateViewerRole(adminPage, 'USER');
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole('button', { name: /open user menu/i }).click();
    await expect(page.getByRole('link', { name: 'Moderation', exact: true })).toHaveCount(0);
  } finally {
    try {
      await updateViewerRole(adminPage, 'USER');
    } finally {
      adminIssues.assertNoUnexpectedIssues();
      await adminContext.close();
    }
  }
});
