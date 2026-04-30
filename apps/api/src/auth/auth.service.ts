import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from 'argon2';
import { createHash, randomBytes } from 'crypto';
import type { StringValue } from 'ms';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload, RefreshTokenPayload, ForgotPasswordInput, ResetPasswordInput } from '@botparty/shared';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '@botparty/shared';
import type { z } from 'zod';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';

const asJwtExpiresIn = (value: string): StringValue => value as StringValue;

const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_LOCKOUT_SEC = 15 * 60; // 15 minutes
const MAX_PASSWORD_RESET_REQUESTS = 3;
const PASSWORD_RESET_WINDOW_SEC = 15 * 60;
const MAX_EMAIL_VERIFICATION_RESENDS = 3;
const EMAIL_VERIFICATION_WINDOW_SEC = 15 * 60;

type AuthResult =
  | {
      accessToken: string;
      refreshToken: string;
      user: {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
        role: string;
        createdAt: string;
      };
      requiresEmailVerification?: false;
      message?: string;
    }
  | {
      accessToken?: undefined;
      refreshToken?: undefined;
      user: {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
        role: string;
        createdAt: string;
      };
      requiresEmailVerification: true;
      message: string;
    };

type AuthTokenResult = Extract<AuthResult, { accessToken: string }>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
  ) {}

  async register(input: z.infer<typeof registerSchema>): Promise<AuthResult> {
    const data = registerSchema.parse({
      ...input,
      email: input.email.trim().toLowerCase(),
      username: input.username.trim(),
    });

    // Check uniqueness
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { username: data.username }],
      },
    });

    if (existing) {
      throw new ConflictException(
        existing.email === data.email ? 'Email already registered' : 'Username already taken',
      );
    }

    const passwordHash = await hash(data.password, { type: 2 }); // argon2id

    const requireVerification = this.requiresEmailVerification();
    const verificationToken = randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await this.prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        passwordHash,
        displayName: data.displayName ?? data.username,
        emailVerified: !requireVerification,
        emailVerificationToken: requireVerification ? verificationToken : null,
        emailVerificationExpiry: requireVerification ? verificationExpiry : null,
      },
    });

    if (requireVerification) {
      this.mail.sendEmailVerification(user.email, verificationToken).catch((err: unknown) => {
        this.logger.warn(`Failed to send verification email to ${user.email}`, err);
      });
      return {
        user: this.buildSessionUser(user),
        requiresEmailVerification: true,
        message: 'Check your inbox to verify your email address before signing in.',
      };
    }

    this.logger.log(`User registered: ${user.username}`);
    return this.generateTokens(user);
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        emailVerificationToken: token,
        emailVerificationExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      },
    });

    this.logger.log(`Email verified for user: ${user.username}`);
    return { message: 'Email verified successfully' };
  }

  async login(input: z.infer<typeof loginSchema>): Promise<AuthTokenResult> {
    const data = loginSchema.parse({
      ...input,
      email: input.email.trim().toLowerCase(),
    });

    const lockoutKey = `auth:lockout:${data.email}`;
    const attemptsKey = `auth:attempts:${data.email}`;

    const lockout = await this.redis.get(lockoutKey);
    if (lockout) {
      throw new UnauthorizedException('Account temporarily locked due to too many failed login attempts. Please try again later.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user || !user.isActive) {
      await this.redis.incr(attemptsKey);
      await this.redis.expire(attemptsKey, LOGIN_LOCKOUT_SEC);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await verify(user.passwordHash, data.password);
    if (!valid) {
      const attempts = await this.redis.incr(attemptsKey);
      await this.redis.expire(attemptsKey, LOGIN_LOCKOUT_SEC);
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        await this.redis.set(lockoutKey, '1', 'EX', LOGIN_LOCKOUT_SEC);
        await this.redis.del(attemptsKey);
        this.logger.warn(`Account locked after ${MAX_LOGIN_ATTEMPTS} failed attempts: ${data.email}`);
        this.mail.sendAccountLockoutNoticeEmail(data.email, Math.ceil(LOGIN_LOCKOUT_SEC / 60)).catch((error: unknown) => {
          this.logger.warn(`Failed to send account lockout email to ${data.email}: ${(error as Error).message}`);
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (this.requiresEmailVerification() && !user.emailVerified) {
      await this.queueEmailVerificationResend(user.id, user.email);
      throw new ForbiddenException('Email address not verified. Check your inbox for a fresh verification link.');
    }

    // Clear failed attempt counters on successful login
    await this.redis.del(attemptsKey);
    await this.redis.del(lockoutKey);

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log(`User logged in: ${user.username}`);
    return this.generateTokens(user);
  }

  async refreshToken(refreshToken: string | null | undefined): Promise<AuthTokenResult> {
    if (!refreshToken?.trim()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    try {
      const payload = this.jwt.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      if (this.requiresEmailVerification() && !user.emailVerified) {
        throw new ForbiddenException('Email address not verified');
      }

      const isCurrentToken = await this.isCurrentRefreshToken(user.id, refreshToken);
      if (!isCurrentToken) {
        await this.revokeRefreshTokens(user.id);
        throw new UnauthorizedException('Refresh token reuse detected');
      }

      return this.generateTokens(user);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async revokeRefreshTokens(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.redis.del(this.refreshTokenKey(userId));
  }

  async resolveValidAccessTokenPayload(accessToken?: string | null): Promise<JwtPayload | null> {
    const token = accessToken?.trim();
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          username: true,
          role: true,
          emailVerified: true,
          isActive: true,
          tokenVersion: true,
        },
      });

      if (
        !user
        || !user.isActive
        || user.tokenVersion !== payload.tokenVersion
        || (this.requiresEmailVerification() && !user.emailVerified)
      ) {
        return null;
      }

      return {
        ...payload,
        username: user.username,
        role: user.role as JwtPayload['role'],
        tokenVersion: user.tokenVersion,
      };
    } catch {
      return null;
    }
  }

  resolveAccessTokenSubject(accessToken?: string | null) {
    const token = accessToken?.trim();
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  resolveRefreshTokenSubject(refreshToken?: string | null) {
    const token = refreshToken?.trim();
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwt.verify<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  async requestPasswordReset(input: ForgotPasswordInput) {
    const data = forgotPasswordSchema.parse({
      ...input,
      email: input.email.trim().toLowerCase(),
    });
    const resetLimitKey = `auth:password-reset:limit:${data.email}`;
    const resetAttempts = await this.redis.incr(resetLimitKey);
    if (resetAttempts === 1) {
      await this.redis.expire(resetLimitKey, PASSWORD_RESET_WINDOW_SEC);
    }
    if (resetAttempts > MAX_PASSWORD_RESET_REQUESTS) {
      this.logger.warn(`Password reset rate limit exceeded for ${data.email}`);
      return { message: 'If the account exists, a reset email has been sent.' };
    }

    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true, email: true, username: true, isActive: true },
    });

    if (!user || !user.isActive) {
      this.logger.warn(`Password reset requested for missing or inactive email: ${data.email}`);
      return { message: 'If the account exists, a reset email has been sent.' };
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(token);
    const ttlSec = Number(this.config.get<string>('PASSWORD_RESET_TTL_SEC', '3600'));
    const payload = JSON.stringify({
      userId: user.id,
      email: user.email,
      createdAt: new Date().toISOString(),
    });

    await this.redis.set(this.passwordResetKey(tokenHash), payload, 'EX', ttlSec);
    await this.redis.set(this.passwordResetUserKey(user.id), tokenHash, 'EX', ttlSec);

    try {
      await this.mail.sendPasswordResetEmail(user.email, token);
      this.logger.log(`Password reset email queued for ${user.username}`);
    } catch (error) {
      await this.redis.del(this.passwordResetKey(tokenHash));
      await this.redis.del(this.passwordResetUserKey(user.id));
      this.logger.error(`Failed to send password reset email to ${user.email}`, (error as Error).message);
      throw new BadRequestException('Password reset email could not be sent');
    }

    return { message: 'If the account exists, a reset email has been sent.' };
  }

  async resendEmailVerification(input: { email: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive || user.emailVerified) {
      return { message: 'If the account exists, a verification email has been sent.' };
    }

    await this.queueEmailVerificationResend(user.id, user.email);
    return { message: 'If the account exists, a verification email has been sent.' };
  }

  async resetPassword(input: ResetPasswordInput) {
    const data = resetPasswordSchema.parse(input);
    const tokenHash = this.hashResetToken(data.token);
    const raw = await this.redis.get(this.passwordResetKey(tokenHash));

    if (!raw) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const payload = JSON.parse(raw) as { userId: string; email: string };
    const latestTokenHash = await this.redis.get(this.passwordResetUserKey(payload.userId));

    if (!latestTokenHash || latestTokenHash !== tokenHash) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const passwordHash = await hash(data.password, { type: 2 });

    await this.prisma.user.update({
      where: { id: payload.userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
    });

    await this.redis.del(this.passwordResetKey(tokenHash));
    await this.redis.del(this.passwordResetUserKey(payload.userId));

    this.logger.log(`Password reset completed for user ${payload.userId}`);
    return { message: 'Password reset successful' };
  }

  private async generateTokens(user: {
    id: string;
    username: string;
    role: string;
    tokenVersion: number;
    displayName?: string | null;
    avatarUrl?: string | null;
    createdAt?: Date;
  }): Promise<AuthTokenResult> {
    const jwtPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role as JwtPayload['role'],
      tokenVersion: user.tokenVersion,
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      tokenVersion: user.tokenVersion,
      jti: randomBytes(16).toString('hex'),
    };

    const accessToken = this.jwt.sign(jwtPayload);
    const refreshExpiresIn = this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN');
    const refreshTokenValue = this.jwt.sign(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: asJwtExpiresIn(refreshExpiresIn),
    } satisfies JwtSignOptions);
    await this.storeRefreshToken(user.id, refreshTokenValue);

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      user: this.buildSessionUser(user),
    };
  }

  private buildSessionUser(user: {
    id: string;
    username: string;
    role: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    createdAt?: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? null,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role,
      createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  private requiresEmailVerification() {
    return this.config.get<string>('REQUIRE_EMAIL_VERIFICATION') === 'true';
  }

  private async queueEmailVerificationResend(userId: string, email: string) {
    const resendKey = `auth:email-verification:resend:${email}`;
    const resendAttempts = await this.redis.incr(resendKey);
    if (resendAttempts === 1) {
      await this.redis.expire(resendKey, EMAIL_VERIFICATION_WINDOW_SEC);
    }
    if (resendAttempts > MAX_EMAIL_VERIFICATION_RESENDS) {
      this.logger.warn(`Email verification resend rate limit exceeded for ${email}`);
      return;
    }

    const token = randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationToken: token,
        emailVerificationExpiry: expiry,
      },
    });

    this.mail.sendEmailVerification(email, token).catch((error: unknown) => {
      this.logger.warn(`Failed to send verification email to ${email}: ${(error as Error).message}`);
    });
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private passwordResetKey(tokenHash: string) {
    return `auth:password-reset:${tokenHash}`;
  }

  private passwordResetUserKey(userId: string) {
    return `auth:password-reset:user:${userId}`;
  }

  private refreshTokenKey(userId: string) {
    return `auth:refresh-token:${userId}`;
  }

  private async storeRefreshToken(userId: string, refreshToken: string) {
    const payload = this.jwt.verify<RefreshTokenPayload & { exp?: number }>(refreshToken, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
    const ttlSec = typeof payload.exp === 'number' ? Math.max(1, payload.exp - Math.floor(Date.now() / 1000)) : 7 * 24 * 60 * 60;
    await this.redis.set(this.refreshTokenKey(userId), this.hashRefreshToken(refreshToken), 'EX', ttlSec);
  }

  private async isCurrentRefreshToken(userId: string, refreshToken: string) {
    const storedHash = await this.redis.get(this.refreshTokenKey(userId));
    if (!storedHash) {
      return false;
    }
    return storedHash === this.hashRefreshToken(refreshToken);
  }
}
