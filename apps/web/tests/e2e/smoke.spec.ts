import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Explore', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Real robots.*Shared control that stays fun/i }),
  ).toBeVisible();
});

test('explore page loads and displays robots', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.getByRole('heading', { name: 'Explore robot rooms' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Test Robot by Administrator/ })).toBeVisible();
});

test('robot room page loads with guest access', async ({ page }) => {
  await page.goto('/robot/test-robot');

  await expect(page.getByRole('heading', { name: 'Test Robot' })).toBeVisible();
  await expect(page.getByText('Robot is offline', { exact: true })).toBeVisible();
});

test('queue guidance displays correctly for an offline robot', async ({ page }) => {
  await page.goto('/robot/test-robot');

  await expect(page.getByText('Queue control', { exact: true })).toBeVisible();
  await expect(page.getByText('Join the queue to control this robot.')).toBeVisible();
});

test('navigation menu is responsive', async ({ page }) => {
  await page.goto('/');

  const nav = page.getByRole('navigation');
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Explore', exact: true })).toBeVisible();
});

test('settings page is accessible', async ({ page }) => {
  await page.goto('/settings');

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel('Email')).toBeVisible();
});
