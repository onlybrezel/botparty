import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export type E2ERole = 'admin' | 'moderator' | 'owner' | 'viewer';

const EMAIL_BY_ROLE: Record<E2ERole, string> = {
  admin: 'admin@botparty.test',
  moderator: 'moderator@botparty.test',
  owner: 'owner@botparty.test',
  viewer: 'viewer@botparty.test',
};

export function e2ePassword() {
  return process.env.E2E_USER_PASSWORD ?? 'E2eDemoPassword!2026';
}

export async function waitForLoginForm(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
}

export async function signIn(page: Page, role: E2ERole) {
  await page.goto('/login');
  // WebKit can expose the server-rendered form before React has attached its
  // controlled input handlers. Waiting for the initial auth bootstrap keeps
  // real form input from being overwritten during hydration.
  await waitForLoginForm(page);
  await page.getByLabel('Email').fill(EMAIL_BY_ROLE[role]);
  await page
    .getByLabel('Password')
    .fill(
      role === 'admin'
        ? (process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdminPassword!2026')
        : e2ePassword(),
    );
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: /user menu/i }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForLoadState('networkidle');
}
