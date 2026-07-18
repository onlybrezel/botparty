'use strict';

module.exports = async function authenticateDashboard(browser, context) {
  const target = new URL(context.url);
  if (target.pathname !== '/dashboard') return;

  const email = process.env.LHCI_ADMIN_EMAIL;
  const password = process.env.LHCI_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('LHCI_ADMIN_EMAIL and LHCI_ADMIN_PASSWORD are required for dashboard audits.');
  }

  const page = await browser.newPage();
  try {
    await page.goto(`${target.origin}/login`, { waitUntil: 'networkidle0' });
    await page.type('input[type="email"]', email);
    await page.type('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.location.pathname.startsWith('/explore'));
    await page.waitForNetworkIdle({ idleTime: 500 });
    if (!new URL(page.url()).pathname.startsWith('/explore')) {
      throw new Error(`Lighthouse fixture login failed: ${page.url()}`);
    }
  } finally {
    await page.close();
  }
};
