import { signOut, waitForLoginForm } from '../support/auth';
import { expect, test } from '../support/fixtures';

async function registerThroughTheForm(
  page: import('@playwright/test').Page,
  username: string,
  email: string,
) {
  await page.goto('/login');
  await waitForLoginForm(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('PrivateRoomQa!2026');
  await page
    .getByRole('checkbox', {
      name: /accept the Terms of Service.*Privacy Policy/i,
    })
    .check();
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard#new-robot$/);
}

test('a private room created in the UI stays hidden from another signed-in owner', async ({
  page,
  browserIssues,
}) => {
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`.replaceAll('-', '_');
  const firstOwner = `private_a_${suffix}`.slice(0, 32);
  const secondOwner = `private_b_${suffix}`.slice(0, 32);
  const robotName = `Private QA Rover ${suffix}`;
  const slug = `private-${suffix.replaceAll('_', '-')}`.slice(0, 50);

  await registerThroughTheForm(page, firstOwner, `${firstOwner}@example.test`);
  await page.getByPlaceholder('Robot name').fill(robotName);
  await page.getByPlaceholder('custom-slug (optional)').fill(slug);
  await expect(page.locator('select').first()).toHaveValue('PRIVATE');
  await page.getByRole('button', { name: 'Create robot' }).click();
  await expect(
    page.getByText('Robot created. You can now copy the claim token into your client config.'),
  ).toBeVisible();
  const privateRoomHref = await page
    .getByRole('link', { name: 'Open', exact: true })
    .getAttribute('href');
  expect(privateRoomHref).toBe(`/robot/${firstOwner}/${slug}`);

  await signOut(page);
  await registerThroughTheForm(page, secondOwner, `${secondOwner}@example.test`);
  browserIssues.allowHttpError(404, /\/api\/v1\/robots\/private\//);
  await page.goto(privateRoomHref!);

  await expect(page.getByRole('heading', { name: 'Private robot' })).toBeVisible();
  await expect(page.getByText('Robot not found', { exact: true })).toBeVisible();
  await expect(page.getByText(robotName)).toHaveCount(0);
});
