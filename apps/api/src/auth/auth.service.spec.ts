import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn().mockResolvedValue(true),
}));

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockRedisMulti = {
  set: jest.fn().mockReturnThis(),
  del: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  eval: jest.fn(),
  multi: jest.fn(() => mockRedisMulti),
};

const mockMail = {
  isEnabled: jest.fn().mockReturnValue(true),
  sendEmailVerification: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountLockoutNoticeEmail: jest.fn().mockResolvedValue(undefined),
};

const configValues: Record<string, string | undefined> = {};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key in configValues) return configValues[key];
    if (key === 'JWT_SECRET') return 'test-secret';
    if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
    if (key === 'JWT_EXPIRES_IN') return '15m';
    if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
    if (key === 'REQUIRE_EMAIL_VERIFICATION') return 'false';
    return undefined;
  }),
  getOrThrow: jest.fn((key: string) => {
    if (key === 'JWT_SECRET') return 'test-secret';
    if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
    if (key === 'JWT_EXPIRES_IN') return '15m';
    if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
    return 'test-value';
  }),
};

const mockJwt = {
  sign: jest.fn()
    .mockReturnValueOnce('mock-access-token')
    .mockReturnValueOnce('mock-refresh-token'),
  verify: jest.fn().mockReturnValue({ sub: 'user-1', username: 'testuser', role: 'USER', tokenVersion: 0 }),
};

const fakeUser = {
  id: 'user-1',
  username: 'testuser',
  email: 'test@example.com',
  passwordHash: 'hashed',
  isActive: true,
  role: 'USER',
  tokenVersion: 0,
  displayName: 'Test User',
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.keys(configValues).forEach((key) => delete configValues[key]);
    mockJwt.sign
      .mockReturnValueOnce('mock-access-token')
      .mockReturnValueOnce('mock-refresh-token');
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.eval.mockResolvedValue(1);
    mockMail.isEnabled.mockReturnValue(true);
    mockMail.sendEmailVerification.mockResolvedValue(undefined);
    mockMail.sendPasswordResetEmail.mockResolvedValue(undefined);
    mockMail.sendAccountLockoutNoticeEmail.mockResolvedValue(undefined);
    mockJwt.verify.mockImplementation((token: string) => {
      if (token === 'mock-refresh-token' || token === 'valid-refresh-token') {
        return { sub: 'user-1', tokenVersion: 0, jti: 'refresh-1', exp: Math.floor(Date.now() / 1000) + 3600 };
      }
      if (token === 'old-token') {
        return { sub: 'user-1', tokenVersion: 99, jti: 'refresh-old', exp: Math.floor(Date.now() / 1000) + 3600 };
      }
      return { sub: 'user-1', username: 'testuser', role: 'USER', tokenVersion: 0 };
    });

    service = new AuthService(
      mockPrisma as never,
      mockJwt as never,
      mockConfig as never,
      mockRedis as never,
      mockMail as never,
    );
  });

  describe('login', () => {
    it('rejects locked-out accounts', async () => {
      mockRedis.get.mockResolvedValueOnce('1');

      await expect(
        service.login({ email: 'test@example.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects invalid credentials (user not found)', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockRedis.incr.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(undefined);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('increments attempt counter and locks after N failures', async () => {
      const argon2 = jest.requireMock('argon2') as { verify: jest.Mock };
      argon2.verify.mockResolvedValueOnce(false);

      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce(fakeUser);
      mockRedis.incr.mockResolvedValueOnce(10);
      mockRedis.expire.mockResolvedValueOnce(undefined);
      mockRedis.set.mockResolvedValueOnce('OK');
      mockRedis.del.mockResolvedValueOnce(undefined);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongpass' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:client-lockout:'),
        '1',
        'EX',
        expect.any(Number),
      );
    });

    it('isolates lockouts by email and client IP so one shared account cannot lock out every client', async () => {
      mockRedis.get
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, emailVerified: true });
      mockPrisma.user.update.mockResolvedValueOnce(fakeUser);
      mockRedis.del.mockResolvedValueOnce(1);

      await expect(
        service.login(
          { email: fakeUser.email, password: 'correctpass' },
          { remoteIp: '203.0.113.10' },
        ),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.login(
          { email: fakeUser.email, password: 'correctpass' },
          { remoteIp: '203.0.113.11' },
        ),
      ).resolves.toHaveProperty('accessToken');

      const firstKey = mockRedis.get.mock.calls[0]?.[0] as string;
      const secondKey = mockRedis.get.mock.calls[1]?.[0] as string;
      expect(firstKey).toContain('auth:client-lockout:');
      expect(secondKey).toContain('auth:client-lockout:');
      expect(firstKey).not.toBe(secondKey);
    });

    it('returns tokens on successful login', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, emailVerified: true });
      mockRedis.del.mockResolvedValue(undefined);
      mockPrisma.user.update.mockResolvedValueOnce(fakeUser);
      mockRedis.set.mockResolvedValueOnce('OK');

      const result = await service.login({ email: 'test@example.com', password: 'correctpass' });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('blocks unverified accounts when verification is required', async () => {
      configValues.REQUIRE_EMAIL_VERIFICATION = 'true';
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...fakeUser,
        emailVerified: false,
      });
      mockRedis.incr.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);
      mockPrisma.user.update.mockResolvedValueOnce({});

      await expect(
        service.login({ email: fakeUser.email, password: 'correctpass' }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockMail.sendEmailVerification).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshToken', () => {
    it('throws when no token provided', async () => {
      await expect(service.refreshToken(null)).rejects.toThrow(UnauthorizedException);
      await expect(service.refreshToken('')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when token version mismatch', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, tokenVersion: 0 });

      await expect(service.refreshToken('old-token')).rejects.toThrow(UnauthorizedException);
    });

    it('returns new tokens on valid refresh', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, emailVerified: true });
      mockRedis.eval.mockResolvedValueOnce(1);

      const result = await service.refreshToken('valid-refresh-token');
      expect(result).toHaveProperty('accessToken');
      expect(result.refreshToken).toBeTruthy();
      expect(result.rotated).toBe(true);
    });

    it('returns access-only token when prev hash matches (concurrent refresh)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, emailVerified: true });
      mockRedis.eval.mockResolvedValueOnce(0);
      mockRedis.get.mockResolvedValueOnce(
        'ba518c093e1e0df01cfe01436563cd37f6a1f47697fcc620e818a2d062665083',
      );

      const result = await service.refreshToken('valid-refresh-token');
      expect(result).toHaveProperty('accessToken');
      expect(result.refreshToken).toBeNull();
      expect(result.rotated).toBe(false);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('revokes tokens when an older refresh token is replayed', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, emailVerified: true });
      mockRedis.eval.mockResolvedValueOnce(0);
      mockRedis.get.mockResolvedValueOnce('different-hash');
      mockPrisma.user.update.mockResolvedValueOnce({ ...fakeUser, tokenVersion: 1 });
      mockRedis.del.mockResolvedValueOnce(1);

      await expect(service.refreshToken('valid-refresh-token')).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });
  });

  describe('resolveValidAccessTokenPayload', () => {
    it('returns null when the access token no longer matches tokenVersion', async () => {
      mockJwt.verify.mockReturnValueOnce({
        sub: 'user-1',
        username: 'testuser',
        role: 'USER',
        tokenVersion: 9,
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, tokenVersion: 0 });

      await expect(service.resolveValidAccessTokenPayload('expired-access-token')).resolves.toBeNull();
    });

    it('returns the fresh user snapshot for valid access tokens', async () => {
      mockJwt.verify.mockReturnValueOnce({
        sub: 'user-1',
        username: 'stale-name',
        role: 'USER',
        tokenVersion: 0,
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: fakeUser.id,
        username: 'fresh-name',
        role: 'ADMIN',
        isActive: true,
        tokenVersion: 0,
      });

      await expect(service.resolveValidAccessTokenPayload('valid-access-token')).resolves.toEqual({
        sub: 'user-1',
        username: 'fresh-name',
        role: 'ADMIN',
        tokenVersion: 0,
      });
    });
  });

  describe('register', () => {
    it('throws ConflictException if email already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(fakeUser);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'StrongPass1!',
          username: 'newuser',
          displayName: 'New User',
          acceptedTermsVersion: '2026-07-17',
          acceptedPrivacyVersion: '2026-07-17',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if username already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({ ...fakeUser, email: 'other@example.com' });

      await expect(
        service.register({
          email: 'new@example.com',
          password: 'StrongPass1!',
          username: 'testuser',
          displayName: 'New',
          acceptedTermsVersion: '2026-07-17',
          acceptedPrivacyVersion: '2026-07-17',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns a verification-pending response when email verification is required', async () => {
      configValues.REQUIRE_EMAIL_VERIFICATION = 'true';
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce({
        ...fakeUser,
        emailVerified: false,
        createdAt: new Date('2026-04-29T12:00:00Z'),
      });

      await expect(
        service.register({
          email: fakeUser.email,
          password: 'StrongPass1!',
          username: fakeUser.username,
          displayName: 'New User',
          acceptedTermsVersion: '2026-07-17',
          acceptedPrivacyVersion: '2026-07-17',
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          requiresEmailVerification: true,
          message: expect.stringContaining('verify your email'),
        }),
      );
      expect(mockMail.sendEmailVerification).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestPasswordReset', () => {
    it('suppresses reset emails after the per-email rate limit is hit', async () => {
      mockRedis.incr.mockResolvedValueOnce(4);

      await expect(service.requestPasswordReset({ email: 'test@example.com' })).resolves.toEqual({
        message: 'If the account exists, a reset email has been sent.',
      });

      expect(mockRedis.expire).not.toHaveBeenCalled();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockMail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('sets the rate-limit TTL on the first request and sends email for active users', async () => {
      mockRedis.incr.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: fakeUser.id,
        email: fakeUser.email,
        username: fakeUser.username,
        isActive: true,
      });
      mockRedis.set.mockResolvedValue('OK');

      await expect(service.requestPasswordReset({ email: fakeUser.email })).resolves.toEqual({
        message: 'If the account exists, a reset email has been sent.',
      });

      expect(mockRedis.expire).toHaveBeenCalledWith(
        `auth:password-reset:limit:${fakeUser.email}`,
        15 * 60,
      );
      expect(mockMail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('additional security and recovery branches', () => {
    const registration = {
      email: 'new@example.com',
      password: 'StrongPass1!',
      username: 'newuser',
      displayName: undefined,
      acceptedTermsVersion: '2026-07-17',
      acceptedPrivacyVersion: '2026-07-17',
    } as const;

    it('fails closed when verified registration requires unavailable mail', async () => {
      configValues.REQUIRE_EMAIL_VERIFICATION = 'true';
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockMail.isEnabled.mockReturnValue(false);
      await expect(service.register(registration)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('deletes a newly created account when the verification message cannot be queued', async () => {
      configValues.REQUIRE_EMAIL_VERIFICATION = 'true';
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ ...fakeUser, emailVerified: false });
      mockMail.sendEmailVerification.mockRejectedValue(new Error('smtp offline'));
      await expect(service.register(registration)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: fakeUser.id } });
    });

    it('registers an immediately verified account and stores legal versions', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockImplementation(({ data }) => Promise.resolve({ ...fakeUser, ...data }));
      await expect(service.register(registration)).resolves.toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          user: expect.objectContaining({ displayName: 'newuser' }),
        }),
      );
      expect(mockPrisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ emailVerified: true, emailVerificationToken: null, acceptedTermsVersion: '2026-07-17' }) });
    });

    it('verifies an email token digest exactly once', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      await expect(service.verifyEmail('bad')).rejects.toBeInstanceOf(BadRequestException);
      mockPrisma.user.findFirst.mockResolvedValueOnce(fakeUser);
      await expect(service.verifyEmail('good')).resolves.toEqual({ message: 'Email verified successfully' });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: fakeUser.id }, data: { emailVerified: true, emailVerificationToken: null, emailVerificationExpiry: null } });
    });

    it('rejects inactive users and wrong passwords without account-wide lockout', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, isActive: false });
      await expect(service.login({ email: fakeUser.email, password: 'correctpass' }, { remoteIp: '203.0.113.2' })).rejects.toBeInstanceOf(UnauthorizedException);
      const argon2 = jest.requireMock('argon2') as { verify: jest.Mock };
      argon2.verify.mockResolvedValueOnce(false);
      mockPrisma.user.findUnique.mockResolvedValueOnce(fakeUser);
      mockRedis.incr.mockResolvedValueOnce(2).mockResolvedValueOnce(2);
      await expect(service.login({ email: fakeUser.email, password: 'wrong' }, { remoteIp: '203.0.113.3' })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockRedis.set).not.toHaveBeenCalledWith(expect.stringContaining('lockout'), expect.anything(), expect.anything(), expect.anything());
    });

    it('does not fail login if the risk-notice email fails', async () => {
      const argon2 = jest.requireMock('argon2') as { verify: jest.Mock };
      argon2.verify.mockResolvedValueOnce(false);
      mockPrisma.user.findUnique.mockResolvedValueOnce(fakeUser);
      mockRedis.incr.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
      mockMail.sendAccountLockoutNoticeEmail.mockRejectedValue(new Error('mail offline'));
      await expect(service.login({ email: fakeUser.email, password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
      await Promise.resolve();
      expect(mockMail.sendAccountLockoutNoticeEmail).toHaveBeenCalled();
    });

    it('rejects refresh for missing, inactive, unverified, or malformed sessions', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.refreshToken('valid-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, isActive: false });
      await expect(service.refreshToken('valid-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
      configValues.REQUIRE_EMAIL_VERIFICATION = 'true';
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, emailVerified: false });
      await expect(service.refreshToken('valid-refresh-token')).rejects.toBeInstanceOf(ForbiddenException);
      mockJwt.verify.mockImplementationOnce(() => { throw new Error('bad signature'); });
      await expect(service.refreshToken('broken')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('uses the default refresh TTL when the candidate has no exp claim', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, emailVerified: true });
      mockJwt.verify
        .mockReturnValueOnce({ sub: fakeUser.id, tokenVersion: 0 })
        .mockReturnValueOnce({ sub: fakeUser.id, tokenVersion: 0 });
      await expect(service.refreshToken('valid-refresh-token')).resolves.toEqual(expect.objectContaining({ rotated: true }));
      expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 2, expect.any(String), expect.any(String), expect.any(String), expect.any(String), String(7 * 24 * 60 * 60), '15');
    });

    it('revokes both refresh-token slots explicitly', async () => {
      await service.revokeRefreshTokens(fakeUser.id);
      expect(mockRedis.del).toHaveBeenCalledWith(`auth:refresh-token:${fakeUser.id}`, `auth:refresh-token:prev:${fakeUser.id}`);
    });

    it('returns null for empty, invalid, inactive, missing, and unverified access tokens', async () => {
      await expect(service.resolveValidAccessTokenPayload(' ')).resolves.toBeNull();
      mockJwt.verify.mockImplementationOnce(() => { throw new Error('invalid'); });
      await expect(service.resolveValidAccessTokenPayload('bad')).resolves.toBeNull();
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.resolveValidAccessTokenPayload('valid')).resolves.toBeNull();
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, isActive: false });
      await expect(service.resolveValidAccessTokenPayload('valid')).resolves.toBeNull();
      configValues.REQUIRE_EMAIL_VERIFICATION = 'true';
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, emailVerified: false });
      await expect(service.resolveValidAccessTokenPayload('valid')).resolves.toBeNull();
    });

    it('extracts access and refresh subjects without trusting invalid tokens', () => {
      expect(service.resolveAccessTokenSubject(undefined)).toBeNull();
      expect(service.resolveRefreshTokenSubject(' ')).toBeNull();
      mockJwt.verify.mockReturnValueOnce({ sub: 42 });
      expect(service.resolveAccessTokenSubject('no-sub')).toBeNull();
      mockJwt.verify.mockReturnValueOnce({ sub: 42 });
      expect(service.resolveRefreshTokenSubject('no-sub')).toBeNull();
      mockJwt.verify.mockImplementationOnce(() => { throw new Error('bad'); });
      expect(service.resolveAccessTokenSubject('bad')).toBeNull();
      mockJwt.verify.mockImplementationOnce(() => { throw new Error('bad'); });
      expect(service.resolveRefreshTokenSubject('bad')).toBeNull();
      mockJwt.verify.mockReturnValueOnce({ sub: fakeUser.id });
      expect(service.resolveAccessTokenSubject('good')).toBe(fakeUser.id);
      mockJwt.verify.mockReturnValueOnce({ sub: fakeUser.id });
      expect(service.resolveRefreshTokenSubject('good')).toBe(fakeUser.id);
    });

    it('returns the same reset response for missing and inactive accounts', async () => {
      mockRedis.incr.mockResolvedValue(2);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...fakeUser, isActive: false });
      await expect(service.requestPasswordReset({ email: ' missing@example.com ' })).resolves.toHaveProperty('message');
      await expect(service.requestPasswordReset({ email: fakeUser.email })).resolves.toHaveProperty('message');
      expect(mockMail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('removes reset keys when mail delivery fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: fakeUser.id, email: fakeUser.email, username: fakeUser.username, isActive: true });
      mockMail.sendPasswordResetEmail.mockRejectedValue(new Error('smtp'));
      await expect(service.requestPasswordReset({ email: fakeUser.email })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRedis.del).toHaveBeenCalledTimes(2);
    });

    it('resends verification only for active unverified accounts and rate-limits repeats', async () => {
      const response = { message: 'If the account exists, a verification email has been sent.' };
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...fakeUser, isActive: false, emailVerified: false })
        .mockResolvedValueOnce({ ...fakeUser, isActive: true, emailVerified: true })
        .mockResolvedValueOnce({ ...fakeUser, isActive: true, emailVerified: false })
        .mockResolvedValueOnce({ ...fakeUser, isActive: true, emailVerified: false });
      await expect(service.resendEmailVerification({ email: 'none@example.com' })).resolves.toEqual(response);
      await expect(service.resendEmailVerification({ email: fakeUser.email })).resolves.toEqual(response);
      await expect(service.resendEmailVerification({ email: fakeUser.email })).resolves.toEqual(response);
      mockRedis.incr.mockResolvedValueOnce(1);
      await expect(service.resendEmailVerification({ email: ` ${fakeUser.email.toUpperCase()} ` })).resolves.toEqual(response);
      expect(mockMail.sendEmailVerification).toHaveBeenCalledTimes(1);
      mockRedis.incr.mockResolvedValueOnce(4);
      await expect(service.resendEmailVerification({ email: fakeUser.email })).resolves.toEqual(response);
      expect(mockMail.sendEmailVerification).toHaveBeenCalledTimes(1);
    });

    it('rejects missing, superseded, and invalid reset payloads', async () => {
      await expect(service.resetPassword({ token: 'a'.repeat(64), password: 'StrongPass2!' })).rejects.toBeInstanceOf(BadRequestException);
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ userId: fakeUser.id, email: fakeUser.email })).mockResolvedValueOnce(null);
      await expect(service.resetPassword({ token: 'b'.repeat(64), password: 'StrongPass2!' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resets the password, increments token version, and consumes both keys', async () => {
      const token = 'c'.repeat(64);
      const { createHash } = await import('crypto');
      const digest = createHash('sha256').update(token).digest('hex');
      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify({ userId: fakeUser.id, email: fakeUser.email }))
        .mockResolvedValueOnce(digest);
      await expect(service.resetPassword({ token, password: 'StrongPass2!' })).resolves.toEqual({ message: 'Password reset successful' });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: fakeUser.id }, data: { passwordHash: 'hashed', tokenVersion: { increment: 1 } } });
      expect(mockRedis.del).toHaveBeenCalledTimes(2);
    });
  });
});
