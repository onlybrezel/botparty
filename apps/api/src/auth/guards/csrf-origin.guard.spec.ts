import { ForbiddenException } from '@nestjs/common';
import { CsrfOriginGuard } from './csrf-origin.guard';

const csrfToken = 'csrf-token-value';

function context(request: { method?: string; headers: Record<string, string | undefined> }) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function guard() {
  return new CsrfOriginGuard({
    get: jest.fn(
      (key: string) =>
        ({
          APP_URL: 'https://botparty.test',
          PUBLIC_WEB_URL: 'https://botparty.test',
          CORS_ORIGIN: 'https://botparty.test',
        })[key],
    ),
  });
}

function cookieRequest(overrides: Record<string, string | undefined> = {}) {
  return context({
    method: 'POST',
    headers: {
      origin: 'https://botparty.test',
      cookie: `bp_access=access-token; bp_csrf=${csrfToken}`,
      'x-csrf-token': csrfToken,
      ...overrides,
    },
  });
}

describe('CsrfOriginGuard', () => {
  it.each(['robots', 'queue', 'wallet', 'payouts', 'users', 'controls', 'moderation'])(
    'rejects a cookie-authenticated %s mutation without an origin',
    () => {
      expect(() => guard().canActivate(cookieRequest({ origin: undefined }))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('requires the double-submit token for allowed browser origins', () => {
    expect(() => guard().canActivate(cookieRequest({ 'x-csrf-token': 'wrong' }))).toThrow(
      'CSRF token mismatch',
    );
    expect(guard().canActivate(cookieRequest())).toBe(true);
  });

  it('accepts an allowed Referer when Origin is unavailable', () => {
    expect(
      guard().canActivate(
        cookieRequest({ origin: undefined, referer: 'https://botparty.test/dashboard' }),
      ),
    ).toBe(true);
  });

  it('keeps bearer clients and safe methods independent of browser CSRF cookies', () => {
    expect(
      guard().canActivate(
        context({ method: 'DELETE', headers: { authorization: 'Bearer token' } }),
      ),
    ).toBe(true);
    expect(
      guard().canActivate(
        context({ method: 'GET', headers: { cookie: 'bp_access=token' } }),
      ),
    ).toBe(true);
  });
});
