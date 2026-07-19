import { signIn } from '../support/auth';
import { expect, test } from '../support/fixtures';

test('robot owners can operate controls, access rules, media, ingress, and webhooks through the dashboard', async ({
  page,
}) => {
  await signIn(page, 'owner');
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open dashboard for Owner Test Robot' }).click();
  await expect(page.getByLabel('Robot Name')).toHaveValue('Owner Test Robot');

  await page.getByRole('button', { name: 'Open OBS connection help' }).click();
  const obsDialog = page.getByRole('dialog', { name: 'OBS low-latency setup' });
  await expect(obsDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(obsDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open OBS connection help' })).toBeFocused();

  await page.getByLabel('Room access').selectOption('ALLOWED_USERS');
  const allowedUsername = page.getByLabel('Username to allow');
  await allowedUsername.fill('e2e_viewer');
  await allowedUsername.locator('..').getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('@e2e_viewer')).toBeVisible();
  await page
    .getByText('@e2e_viewer')
    .locator('..')
    .locator('..')
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(page.getByText('@e2e_viewer')).toHaveCount(0);
  await page.getByLabel('Room access').selectOption('PUBLIC');

  const controlLabel = `QA Horn ${test.info().project.name}`;
  const updatedControlLabel = `${controlLabel} Updated`;
  await page.getByLabel('Control label').first().fill(controlLabel);
  await page.getByLabel('Control command').first().fill('qa_horn');
  await page.getByRole('button', { name: 'Add control button' }).click();
  let controlRow = page.getByRole('group', { name: `Control ${controlLabel}` });
  await expect(controlRow).toContainText('Enabled');
  await controlRow.getByRole('button', { name: 'Disable' }).click();
  await expect(controlRow).toContainText('Disabled');
  await controlRow.getByRole('button', { name: 'Enable' }).click();
  await controlRow.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Control label').nth(1).fill(updatedControlLabel);
  await page.getByRole('button', { name: 'Save control button' }).click();
  controlRow = page.getByRole('group', { name: `Control ${updatedControlLabel}` });
  await expect(controlRow).toContainText('qa_horn');

  page.once('dialog', async (dialog) => dialog.accept());
  await controlRow.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(updatedControlLabel, { exact: true })).toHaveCount(0);

  const thumbnailInput = page.locator('input[type="file"][accept*="image/png"]');
  await thumbnailInput.setInputFiles('public/brand/favicon-32x32.png');
  await expect(
    page.locator('[role="status"]').filter({ hasText: 'Thumbnail uploaded.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove thumbnail for Owner Test Robot' }).click();
  await expect(
    page.locator('[role="status"]').filter({ hasText: 'Thumbnail removed.' }),
  ).toBeVisible();

  await page.getByLabel('Camera ID').fill(`qa-${test.info().project.name}`);
  await page.getByLabel('Camera display label').fill('QA camera');
  await page.getByRole('button', { name: 'Add external camera ingress' }).click();
  const cameraId = `qa-${test.info().project.name}`;
  await expect(page.getByText(cameraId, { exact: true })).toBeVisible();
  page.once('dialog', async (dialog) => dialog.accept());
  await page.getByRole('button', { name: `Delete ingress for ${cameraId} camera` }).click();
  await expect(page.getByText(cameraId, { exact: true })).toHaveCount(0);

  const webhookUrl = `https://example.com/botparty/${test.info().project.name}`;
  await page.getByLabel('Delivery URL').fill(webhookUrl);
  await page.getByRole('button', { name: 'Create webhook' }).click();
  await expect(page.getByText('Copy this signing secret now')).toBeVisible();
  const webhookHeader = page.getByText(webhookUrl).locator('..').locator('..');
  page.once('dialog', async (dialog) => dialog.accept());
  await webhookHeader.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(webhookUrl)).toHaveCount(0);

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Generate a new claim token');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Regenerate token' }).click();
  await expect(
    page.getByText('Claim token regenerated. Update config.yaml before restarting the client.'),
  ).toBeVisible();
  await expect(page.getByText('Not available')).toHaveCount(0);
});
