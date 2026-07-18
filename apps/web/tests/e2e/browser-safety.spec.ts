import { expect, test } from '@playwright/test';

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

    const frameworkNonces = await page.locator('script[src]').evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce),
    );
    expect(frameworkNonces.length).toBeGreaterThan(0);
    expect(frameworkNonces).toContain(nonce);
    expect(frameworkNonces.filter(Boolean).every((scriptNonce) => scriptNonce === nonce)).toBe(true);
  }

  expect(violations).toEqual([]);
});

test('Tab keeps normal browser focus movement in the robot room', async ({ page }) => {
  await page.goto('/robot/test-robot');
  await expect(page.locator('main')).toBeVisible();

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
