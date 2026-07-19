import { signIn } from '../support/auth';
import { expect, test } from '../support/fixtures';

const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.right > document.documentElement.clientWidth + 1 || bounds.left < -1;
      })
      .slice(0, 5)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        text: element.textContent?.trim().slice(0, 80) ?? '',
        width: Math.round(element.getBoundingClientRect().width),
      })),
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders)).toBeLessThanOrEqual(
    dimensions.clientWidth,
  );
}

for (const viewport of viewports) {
  test(`${viewport.width}x${viewport.height} keeps primary guest and owner pages usable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expectNoPageOverflow(page);

    if (viewport.width < 1024) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await expect(page.getByRole('link', { name: 'Explore', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close navigation menu' }).click();
    } else {
      await expect(
        page.getByRole('navigation').getByRole('link', { name: 'Explore', exact: true }),
      ).toBeVisible();
    }

    for (const route of ['/explore', '/login']) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      await expectNoPageOverflow(page);
    }

    await signIn(page, 'owner');
    for (const route of ['/dashboard', '/settings', '/sessions']) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      await expectNoPageOverflow(page);
      if (route === '/dashboard') {
        await page.getByRole('button', { name: 'Open dashboard for Owner Test Robot' }).click();
        await expect(page.getByLabel('Robot Name')).toBeVisible();
        await expectNoPageOverflow(page);
      }
    }

    if (viewport.width <= 430) {
      const notifications = page.getByRole('button', { name: 'Notifications' });
      await notifications.click();
      await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
      await expectNoPageOverflow(page);
      await page.keyboard.press('Escape');
    }
  });
}

for (const zoom of [1, 1.25, 1.5, 2]) {
  test(`${Math.round(zoom * 100)} percent zoom-equivalent reflow keeps actions reachable`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: Math.floor(1440 / zoom),
      height: Math.floor(900 / zoom),
    });
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.goto('/explore');
    await expect(page.getByRole('button', { name: 'Apply filters' })).toBeVisible();
    await expectNoPageOverflow(page);

    await signIn(page, 'owner');
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'Save Profile' })).toBeVisible();
    await expectNoPageOverflow(page);
  });
}
