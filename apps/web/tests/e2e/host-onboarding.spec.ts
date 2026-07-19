import { signIn } from './support/auth';
import { expect, test } from './support/fixtures';

test('the host entry route creates a private robot and shows enforced go-live checks', async ({
  page,
}) => {
  await signIn(page, 'owner');
  await page.goto('/dashboard/robots/new');

  await expect(page).toHaveURL(/\/dashboard#new-robot$/);
  await expect(page.getByRole('heading', { name: 'Add a robot' })).toBeVisible();

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

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain(`Delete robot E2E Host Robot ${suffix}?`);
    await dialog.accept();
  });
  await page.locator('aside').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Robot deleted.')).toBeVisible();
});
