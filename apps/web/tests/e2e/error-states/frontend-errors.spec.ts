import { signIn, waitForLoginForm } from '../support/auth';
import { expect, test } from '../support/fixtures';

test('rate-limited sign-in shows a useful error without leaving the form', async ({
  page,
  browserIssues,
}) => {
  browserIssues.allowHttpError(429, /\/api\/v1\/auth\/login$/);
  await page.route('**/api/v1/auth/login', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 429,
        message: 'Too many sign-in attempts. Try again in one minute.',
      }),
    });
  });

  await page.goto('/login');
  await waitForLoginForm(page);
  await page.getByLabel('Email').fill('viewer@botparty.test');
  await page.getByLabel('Password').fill('E2eDemoPassword!2026');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.locator('form').getByRole('alert')).toContainText('Too many sign-in attempts');
  await expect(page.getByLabel('Email')).toHaveValue('viewer@botparty.test');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
});

test('temporary dashboard failure ends loading and exposes the server message', async ({
  page,
  browserIssues,
}) => {
  await signIn(page, 'owner');
  browserIssues.allowHttpError(503, /\/api\/v1\/robots\/my$/);
  await page.route('**/api/v1/robots/my', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 503,
        message: 'Robot service is temporarily unavailable.',
      }),
    });
  });

  await page.goto('/dashboard');
  await expect(page.getByText('Robot service is temporarily unavailable.')).toBeVisible();
  await expect(page.getByText('Loading robots...')).toHaveCount(0);
});

test('a failed profile save keeps the entered value and allows a retry', async ({
  page,
  browserIssues,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/settings');
  const displayName = page.getByLabel('Display Name');
  await displayName.fill('Unsaved QA Name');

  browserIssues.allowHttpError(503, /\/api\/v1\/users\/me$/);
  let attempts = 0;
  await page.route('**/api/v1/users/me', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 503,
          message: 'Profile service is temporarily unavailable.',
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Profile service is temporarily unavailable.')).toBeVisible();
  await expect(displayName).toHaveValue('Unsaved QA Name');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Profile updated.')).toBeVisible();

  await displayName.fill('Vera Viewer');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Profile updated.')).toBeVisible();
});

test('server and gateway failures end dashboard loading with a useful visible message', async ({
  page,
  browserIssues,
}) => {
  await signIn(page, 'owner');
  const failures = [
    { status: 500, message: 'Robot service failed unexpectedly.' },
    { status: 502, message: 'Robot service gateway is temporarily unavailable.' },
    { status: 504, message: 'Robot service timed out.' },
  ] as const;
  let activeFailure: (typeof failures)[number] = failures[0];

  for (const failure of failures) {
    browserIssues.allowHttpError(failure.status, /\/api\/v1\/robots\/my$/);
  }
  await page.route('**/api/v1/robots/my', async (route) => {
    await route.fulfill({
      status: activeFailure.status,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: activeFailure.status, message: activeFailure.message }),
    });
  });

  for (const [index, failure] of failures.entries()) {
    activeFailure = failure;
    if (index === 0) {
      await page.goto('/dashboard');
    } else {
      await page.getByRole('link', { name: 'Explore', exact: true }).click();
      await expect(page).toHaveURL(/\/explore$/);
      await page.getByRole('button', { name: /open user menu/i }).click();
      await page.getByRole('link', { name: 'Robots', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    }
    await expect(page.getByText(failure.message)).toBeVisible();
    await expect(page.getByText('Loading robots...')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
  }
});

test('conflict and validation responses preserve profile edits for correction and retry', async ({
  page,
  browserIssues,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/settings');
  const displayName = page.getByLabel('Display Name');
  await displayName.fill('Profile edit in progress');

  browserIssues.allowHttpError(409, /\/api\/v1\/users\/me$/);
  browserIssues.allowHttpError(422, /\/api\/v1\/users\/me$/);
  const failures = [
    { status: 409, message: 'This profile changed in another tab. Review and try again.' },
    { status: 422, message: 'Display name contains an unsupported value.' },
  ];
  let attempt = 0;
  await page.route('**/api/v1/users/me', async (route) => {
    if (route.request().method() !== 'PATCH' || attempt >= failures.length) {
      await route.continue();
      return;
    }
    const failure = failures[attempt]!;
    attempt += 1;
    await route.fulfill({
      status: failure.status,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: failure.status, message: failure.message }),
    });
  });

  for (const failure of failures) {
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await expect(page.getByRole('alert').filter({ hasText: failure.message })).toBeVisible();
    await expect(displayName).toHaveValue('Profile edit in progress');
  }

  await displayName.fill('Vera Viewer');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Profile updated.')).toBeVisible();
});

test('an offline save keeps profile input and succeeds after the browser reconnects', async ({
  context,
  page,
  browserIssues,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/settings');
  const displayName = page.getByLabel('Display Name');
  await displayName.fill('Offline profile edit');
  await page.waitForLoadState('networkidle');

  const offlineErrors =
    /ERR_INTERNET_DISCONNECTED|NS_ERROR_OFFLINE|Internet connection appears to be offline|Load failed|WebKit encountered an internal error/i;
  browserIssues.allowRequestFailure(/\/api\/v1\/users\/me$/, offlineErrors);
  browserIssues.allowConsoleError(offlineErrors);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(
    page.getByRole('alert').filter({
      hasText: 'Cannot reach the service. Check your connection and try again.',
    }),
  ).toBeVisible();
  await expect(displayName).toHaveValue('Offline profile edit');

  await context.setOffline(false);
  await displayName.fill('Vera Viewer');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Profile updated.')).toBeVisible();
});
