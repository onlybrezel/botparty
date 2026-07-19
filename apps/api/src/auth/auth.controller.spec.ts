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

  return new AuthController({} as never, configService as never);
}

function createReply() {
  return { header: jest.fn() };
}

describe('AuthController CSRF bootstrap', () => {
  it('issues a valid token and client-readable API cookie', () => {
    const reply = createReply();

    const result = createController().getCsrfToken(undefined, reply as never);

    expect(result.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reply.header).toHaveBeenCalledWith(
      'set-cookie',
      expect.stringContaining(`bp_csrf=${result.csrfToken}; Path=/api/v1`),
    );
  });

  it('keeps an existing valid token stable across tabs and replaces malformed cookies', () => {
    const controller = createController();
    const firstReply = createReply();
    const first = controller.getCsrfToken(undefined, firstReply as never);

    const secondReply = createReply();
    const second = controller.getCsrfToken(
      `unrelated=value; bp_csrf=${first.csrfToken}`,
      secondReply as never,
    );
    expect(second.csrfToken).toBe(first.csrfToken);

    const replacement = controller.getCsrfToken('bp_csrf=not-a-valid-token', createReply() as never);
    expect(replacement.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(replacement.csrfToken).not.toBe('not-a-valid-token');
  });
});
