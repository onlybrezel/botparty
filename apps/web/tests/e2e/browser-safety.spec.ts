import { expect, test } from './support/fixtures';
import { e2ePassword, waitForLoginForm } from './support/auth';

test('core pages run under the enforced content security policy', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });

  for (const route of ['/', '/explore', '/robot/admin/test-robot', '/login', '/pricing']) {
    const response = await page.goto(route);
    const csp = response?.headers()['content-security-policy'];
    const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    const frameworkNonces = await page
      .locator('script[src]')
      .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
    expect(frameworkNonces.length).toBeGreaterThan(0);
    expect(frameworkNonces).toContain(nonce);
    expect(frameworkNonces.filter(Boolean).every((scriptNonce) => scriptNonce === nonce)).toBe(
      true,
    );
    await page.waitForLoadState('networkidle');
  }

  expect(violations).toEqual([]);
});

test('Tab keeps normal browser focus movement in the robot room', async ({ page }) => {
  await page.goto('/robot/test-robot');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element
      ? `${element.tagName}:${element.id}:${element.getAttribute('aria-label') ?? ''}:${element.textContent?.trim() ?? ''}`
      : '';
  });
  await page.keyboard.press('Tab');
  const second = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element
      ? `${element.tagName}:${element.id}:${element.getAttribute('aria-label') ?? ''}:${element.textContent?.trim() ?? ''}`
      : '';
  });

  expect(first).not.toBe('');
  expect(second).not.toBe('');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  expect(second).not.toBe(first);
});

test('opening a second tab does not invalidate the first tab login form', async ({ context, page }) => {
  await page.goto('/login');
  await waitForLoginForm(page);

  const secondTab = await context.newPage();
  await secondTab.goto('/login');
  await waitForLoginForm(secondTab);

  await page.getByLabel('Email').fill('viewer@botparty.test');
  await page.getByLabel('Password').fill(e2ePassword());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible();

  await secondTab.close();
});
