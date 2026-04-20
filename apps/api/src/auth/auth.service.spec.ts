import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
  },
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
};

const mockMail = {
  sendEmailVerification: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountLockoutNoticeEmail: jest.fn().mockResolvedValue(undefined),
};

const mockConfig = {
  get: jest.fn((key: string) => {
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
  sign: jest.fn().mockReturnValue('mock-token'),
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
        expect.stringContaining('auth:lockout:'),
        '1',
        'EX',
        expect.any(Number),
      );
    });

    it('returns tokens on successful login', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce(fakeUser);
      mockRedis.del.mockResolvedValue(undefined);
      mockPrisma.user.update.mockResolvedValueOnce(fakeUser);

      const result = await service.login({ email: 'test@example.com', password: 'correctpass' });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  describe('refreshToken', () => {
    it('throws when no token provided', async () => {
      await expect(service.refreshToken(null)).rejects.toThrow(UnauthorizedException);
      await expect(service.refreshToken('')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when token version mismatch', async () => {
      mockJwt.verify.mockReturnValueOnce({ sub: 'user-1', tokenVersion: 99 });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...fakeUser, tokenVersion: 0 });

      await expect(service.refreshToken('old-token')).rejects.toThrow(UnauthorizedException);
    });

    it('returns new tokens on valid refresh', async () => {
      mockJwt.verify.mockReturnValueOnce({ sub: 'user-1', tokenVersion: 0 });
      mockPrisma.user.findUnique.mockResolvedValueOnce(fakeUser);

      const result = await service.refreshToken('valid-refresh-token');
      expect(result).toHaveProperty('accessToken');
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
        }),
      ).rejects.toThrow(ConflictException);
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
});
