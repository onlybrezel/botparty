import { existsSync, writeFileSync } from 'node:fs';
import { signIn } from '../support/auth';
import { expect, test } from '../support/fixtures';

const signalDirectory = process.env.E2E_FAILOVER_SIGNAL_DIR ?? '/results/failover-signals';
const signalPath = (name: string) => `${signalDirectory}/${name}`;

async function waitForOrchestratorSignal(name: string) {
  await expect
    .poll(() => existsSync(signalPath(name)) || existsSync(signalPath('failover-error')), {
      timeout: 45_000,
      message: `waiting for failover signal: ${name}`,
    })
    .toBe(true);
  expect(existsSync(signalPath('failover-error')), 'Docker failover orchestration failed').toBe(
    false,
  );
}

test('an active browser session remains usable while one API instance is restarted', async ({
  page,
  browserIssues,
}) => {
  browserIssues.allowHttpError(502, /\/api\/v1\/users\/me$/);
  browserIssues.allowHttpError(504, /\/api\/v1\/users\/me$/);
  // The one request already assigned to the stopped replica may fail. The
  // session bootstrap must retry it against the surviving replica.
  browserIssues.allowHttpError(502, /\/api\/v1\/auth\/refresh$/);
  browserIssues.allowHttpError(504, /\/api\/v1\/auth\/refresh$/);

  await signIn(page, 'owner');
  await page.goto('/settings');
  const displayName = page.getByLabel('Display Name');
  const originalDisplayName = await displayName.inputValue();

  writeFileSync(signalPath('failover-ready'), 'ready\n');
  await waitForOrchestratorSignal('failover-stopped');

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Robots', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.goto('/settings');
  await displayName.fill('API failover browser check');
  await page.getByRole('button', { name: 'Save Profile' }).click();

  const successToast = page.getByText('Profile updated.');
  const transientErrorToast = page.getByText(
    /bad gateway|gateway timeout|temporarily unavailable/i,
  );
  await expect(successToast.or(transientErrorToast)).toBeVisible();
  if (await transientErrorToast.isVisible()) {
    await expect(displayName).toHaveValue('API failover browser check');
    await page.getByRole('button', { name: 'Save Profile' }).click();
  }
  await expect(successToast).toBeVisible();

  writeFileSync(signalPath('failover-restart-requested'), 'restart\n');
  await waitForOrchestratorSignal('failover-restarted');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(displayName).toHaveValue('API failover browser check');
  await displayName.fill(originalDisplayName);
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Profile updated.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Open user menu for e2e_owner/i })).toBeVisible();

  writeFileSync(signalPath('failover-complete'), 'complete\n');
});
