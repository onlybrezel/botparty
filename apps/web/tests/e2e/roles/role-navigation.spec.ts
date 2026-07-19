import { signIn, signOut, waitForLoginForm, type E2ERole } from '../support/auth';
import { expect, test } from '../support/fixtures';

const roles: Array<{
  role: E2ERole;
  canModerate: boolean;
  canViewAnalytics: boolean;
}> = [
  { role: 'admin', canModerate: true, canViewAnalytics: true },
  { role: 'moderator', canModerate: true, canViewAnalytics: false },
  { role: 'owner', canModerate: false, canViewAnalytics: false },
  { role: 'viewer', canModerate: false, canViewAnalytics: false },
];

async function openUserMenu(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /open user menu/i }).click();
}

for (const roleCase of roles) {
  test(`${roleCase.role} sees and can use the correct account navigation`, async ({ page }) => {
    await signIn(page, roleCase.role);

    await openUserMenu(page);
    await expect(page.getByRole('link', { name: 'Robots', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wallet', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sessions', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Moderation', exact: true })).toHaveCount(
      roleCase.canModerate ? 1 : 0,
    );
    await expect(page.getByRole('link', { name: 'Product Analytics', exact: true })).toHaveCount(
      roleCase.canViewAnalytics ? 1 : 0,
    );

    await page.getByRole('link', { name: 'Robots', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Robots', exact: true })).toBeVisible();

    await openUserMenu(page);
    await page.getByRole('link', { name: 'Wallet', exact: true }).click();
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible();

    await openUserMenu(page);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

    await openUserMenu(page);
    await page.getByRole('link', { name: 'Sessions', exact: true }).click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();

    if (roleCase.canModerate) {
      await openUserMenu(page);
      await page.getByRole('link', { name: 'Moderation', exact: true }).click();
      await expect(page).toHaveURL(/\/mod$/);
      await expect(page.getByRole('heading', { name: 'Moderation', exact: true })).toBeVisible();
    }

    await signOut(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Email')).toBeVisible();
  });
}

test('regular users and moderators receive clean handling for forbidden staff deep links', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/mod');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Robots', exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, 'moderator');
  await page.goto('/mod/analytics');
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', { name: 'Watch and control real robots online.' }),
  ).toBeVisible();
});

test('disabled accounts receive a visible login error and no authenticated navigation', async ({
  page,
  browserIssues,
}) => {
  browserIssues.allowHttpError(401, /\/api\/v1\/auth\/login$/);
  await page.goto('/login');
  await waitForLoginForm(page);
  await page.getByLabel('Email').fill('disabled@botparty.test');
  await page.getByLabel('Password').fill(process.env.E2E_USER_PASSWORD ?? 'E2eDemoPassword!2026');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('form').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /open user menu/i })).toHaveCount(0);
});
