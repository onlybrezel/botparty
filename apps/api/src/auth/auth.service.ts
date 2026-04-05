import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload, RefreshTokenPayload, ForgotPasswordInput, ResetPasswordInput } from '@botparty/shared';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '@botparty/shared';
import type { z } from 'zod';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';

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

  async register(input: z.infer<typeof registerSchema>) {
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

    const user = await this.prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        passwordHash,
        displayName: data.displayName ?? data.username,
      },
    });

    this.logger.log(`User registered: ${user.username}`);
    return this.generateTokens(user);
  }

  async login(input: z.infer<typeof loginSchema>) {
    const data = loginSchema.parse({
      ...input,
      email: input.email.trim().toLowerCase(),
    });

    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await verify(user.passwordHash, data.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log(`User logged in: ${user.username}`);
    return this.generateTokens(user);
  }

  async refreshToken(refreshToken: string) {
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

      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async revokeRefreshTokens(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async requestPasswordReset(input: ForgotPasswordInput) {
    const data = forgotPasswordSchema.parse({
      ...input,
      email: input.email.trim().toLowerCase(),
    });
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

  private generateTokens(user: { id: string; username: string; role: string; tokenVersion: number }) {
    const jwtPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role as JwtPayload['role'],
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      tokenVersion: user.tokenVersion,
    };

    const accessToken = this.jwt.sign(jwtPayload);
    const refreshExpiresIn = this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN');
    const refreshTokenValue = this.jwt.sign(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiresIn,
    } as any);

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private passwordResetKey(tokenHash: string) {
    return `auth:password-reset:${tokenHash}`;
  }

  private passwordResetUserKey(userId: string) {
    return `auth:password-reset:user:${userId}`;
  }
}
