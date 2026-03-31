import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload, RefreshTokenPayload } from '@botparty/shared';
import { registerSchema, loginSchema } from '@botparty/shared';
import type { z } from 'zod';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: z.infer<typeof registerSchema>) {
    const data = registerSchema.parse(input);

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
    const data = loginSchema.parse(input);

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
    const refreshTokenValue = this.jwt.sign(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

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
}
