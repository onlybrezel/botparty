'use strict';

module.exports = async function authenticateDashboard(browser, context) {
  const target = new URL(context.url);
  if (target.pathname !== '/dashboard') return;

  const email = process.env.LHCI_ADMIN_EMAIL;
  const password = process.env.LHCI_ADMIN_PASSWORD;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!email || !password || !apiUrl) {
    throw new Error(
      'LHCI_ADMIN_EMAIL, LHCI_ADMIN_PASSWORD and NEXT_PUBLIC_API_URL are required for dashboard audits.',
    );
  }

  const page = await browser.newPage();
  try {
    await page.goto(target.origin, { waitUntil: 'networkidle0' });
    const login = await page.evaluate(
      async ({ apiUrl: browserApiUrl, email: browserEmail, password: browserPassword }) => {
        const csrfResponse = await fetch(`${browserApiUrl}/api/v1/auth/csrf`, {
          method: 'GET',
          credentials: 'include',
        });
        if (!csrfResponse.ok) {
          return {
            ok: false,
            status: csrfResponse.status,
            message: await csrfResponse.text(),
          };
        }
        const { csrfToken } = await csrfResponse.json();
        const response = await fetch(`${browserApiUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({ email: browserEmail, password: browserPassword }),
        });
        const body = await response.json().catch(() => null);
        if (response.ok && body?.accessToken && body?.user) {
          window.sessionStorage.setItem(
            'botparty.auth.session.v1',
            JSON.stringify({
              state: {
                accessToken: body.accessToken,
                username: body.user.username,
                userId: body.user.id,
                displayName: body.user.displayName ?? null,
                role: body.user.role,
                hasHydrated: true,
              },
              version: 0,
            }),
          );
        }
        return {
          ok: response.ok,
          status: response.status,
          message: response.ok ? '' : JSON.stringify(body),
        };
      },
      { apiUrl, email, password },
    );
    if (!login.ok) {
      throw new Error(`Lighthouse fixture login failed (${login.status}): ${login.message}`);
    }

    await page.goto(`${target.origin}/dashboard`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => {
          if (window.location.pathname !== '/dashboard') return false;
          const rawSession = window.sessionStorage.getItem('botparty.auth.session.v1');
          if (!rawSession) return false;
          try {
            return Boolean(JSON.parse(rawSession)?.state?.username);
          } catch {
            return false;
          }
        },
        { timeout: 60_000 },
      );
    } catch (error) {
      const state = await page.evaluate(() => ({
        pathname: window.location.pathname,
        authSession: window.sessionStorage.getItem('botparty.auth.session.v1'),
      }));
      const cookieNames = (
        await page.cookies(`${apiUrl}/api/v1/auth/refresh`, target.origin)
      ).map((cookie) => cookie.name);
      throw new Error(
        `Lighthouse session restore failed: ${JSON.stringify({ ...state, cookieNames })}`,
        { cause: error },
      );
    }
    await page.waitForNetworkIdle({ idleTime: 500 });
    if (new URL(page.url()).pathname !== '/dashboard') {
      throw new Error(`Lighthouse fixture login failed: ${page.url()}`);
    }
  } finally {
    await page.close();
  }
};
