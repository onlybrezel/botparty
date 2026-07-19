import { signIn } from '../support/auth';
import { expect, test } from '../support/fixtures';

test('robot owners can create, edit, open, and delete a robot through visible controls', async ({
  page,
}) => {
  await signIn(page, 'owner');
  await page.goto('/dashboard');
  await expect(
    page.getByRole('button', { name: 'Open dashboard for Owner Test Robot' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Add robot' }).click();
  await expect(page.getByRole('heading', { name: 'Add a robot' })).toBeVisible();

  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const robotName = `QA Rover ${suffix}`;
  const editedName = `QA Rover Updated ${suffix}`;
  const slug = `qa-rover-${suffix}`.toLowerCase();
  await page.getByPlaceholder('Robot name').fill(robotName);
  await page.getByPlaceholder('custom-slug (optional)').fill(slug);
  await page.getByPlaceholder('Description').fill('Mobile-ready rover – Grüße 🚗');
  await page.getByPlaceholder('Tags (comma separated)').fill('qa, responsive, umlaut-ä');
  await page.getByRole('button', { name: 'Create robot' }).dblclick();

  await expect(
    page.getByText('Robot created. You can now copy the claim token into your client config.'),
  ).toBeVisible();
  await expect(page.getByLabel('Robot Name')).toHaveValue(robotName);
  await page.getByLabel('Robot Name').fill(editedName);
  await page
    .getByPlaceholder('Describe your robot and how viewers should use it')
    .fill('Updated through the browser UI.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Robot settings saved.')).toBeVisible();

  const roomPagePromise = page.context().waitForEvent('page');
  await page.getByRole('link', { name: 'Open', exact: true }).click();
  const roomPage = await roomPagePromise;
  await roomPage.waitForLoadState('domcontentloaded');
  await expect(roomPage.getByRole('heading', { name: editedName })).toBeVisible();
  await roomPage.close();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain(`Delete robot ${editedName}?`);
    await dialog.accept();
  });
  await page.locator('aside').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Robot deleted.')).toBeVisible();
  await expect(page.getByRole('button', { name: `Open dashboard for ${editedName}` })).toHaveCount(
    0,
  );
});
