import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = 'admin@botparty.test';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password-at-least-16';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/explore/);
}

test('the host entry route creates a private robot and shows enforced go-live checks', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/dashboard/robots/new');

  await expect(page).toHaveURL(/\/dashboard#new-robot$/);
  await expect(page.getByRole('heading', { name: 'Create Robot' })).toBeVisible();

  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  await page.getByPlaceholder('Robot name').fill(`E2E Host Robot ${suffix}`);
  await page.getByPlaceholder('custom-slug (optional)').fill(`e2e-host-${suffix}`);
  await page.getByRole('button', { name: 'Create robot' }).click();

  await expect(
    page.getByText('Robot created. You can now copy the claim token into your client config.'),
  ).toBeVisible();
  await expect(page.getByText('Go-live checks')).toBeVisible();
  await expect(page.getByText('Checks pending')).toBeVisible();
  await expect(page.getByText('Hardware E-Stop verified')).toBeVisible();
});
