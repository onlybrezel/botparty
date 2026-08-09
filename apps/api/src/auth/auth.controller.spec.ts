import { AuthController } from './auth.controller';

function createController() {
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        AUTH_COOKIE_SECURE: 'false',
        AUTH_COOKIE_SAMESITE: 'strict',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return values[key];
    }),
  };

  const authService = {
    login: jest.fn(),
    refreshToken: jest.fn(),
    register: jest.fn(),
    requestPasswordReset: jest.fn(),
    resendEmailVerification: jest.fn(),
    resetPassword: jest.fn(),
    resolveAccessTokenSubject: jest.fn(),
    resolveRefreshTokenSubject: jest.fn(),
    revokeRefreshTokens: jest.fn(),
    verifyEmail: jest.fn(),
  };

  return new AuthController(authService, configService);
}

function createReply() {
  return { header: jest.fn() };
}

describe('AuthController CSRF bootstrap', () => {
  it('issues a valid token and client-readable API cookie', () => {
    const reply = createReply();

    const result = createController().getCsrfToken(undefined, reply);

    expect(result.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reply.header).toHaveBeenCalledWith(
      'set-cookie',
      expect.stringContaining(`bp_csrf=${result.csrfToken}; Path=/api/v1`),
    );
  });

  it('keeps an existing valid token stable across tabs and replaces malformed cookies', () => {
    const controller = createController();
    const firstReply = createReply();
    const first = controller.getCsrfToken(undefined, firstReply);

    const secondReply = createReply();
    const second = controller.getCsrfToken(
      `unrelated=value; bp_csrf=${first.csrfToken}`,
      secondReply,
    );
    expect(second.csrfToken).toBe(first.csrfToken);

    const replacement = controller.getCsrfToken('bp_csrf=not-a-valid-token', createReply());
    expect(replacement.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(replacement.csrfToken).not.toBe('not-a-valid-token');
  });
});
