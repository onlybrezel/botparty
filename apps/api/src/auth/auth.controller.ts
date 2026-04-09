import { Controller, Post, Body, HttpCode, HttpStatus, Headers, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import type { FastifyReply } from 'fastify';
import {
  buildClearedCookie,
  buildHttpOnlyCookie,
  extractBearerToken,
  getAccessCookieName,
  getAccessCookieTtlMs,
  getAuthCookieSameSite,
  getRefreshCookieName,
  getRefreshCookieTtlMs,
  parseCookie,
  shouldUseSecureAuthCookies,
} from './auth.cookies';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(
    @Body() body: { username: string; email: string; password: string; displayName?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const tokens = await this.authService.register(body);
    this.applyAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email/password' })
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const tokens = await this.authService.login(body);
    this.applyAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Body() body: { refreshToken?: string } | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const refreshToken =
      body?.refreshToken?.trim() ||
      parseCookie(cookieHeader, getRefreshCookieName(this.configService));
    const tokens = await this.authService.refreshToken(refreshToken);
    this.applyAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout / revoke refresh tokens' })
  async logout(
    @Headers('authorization') authorization: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Body() body: { refreshToken?: string } | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const accessToken =
      extractBearerToken(authorization) ||
      parseCookie(cookieHeader, getAccessCookieName(this.configService));
    const refreshToken =
      body?.refreshToken?.trim() ||
      parseCookie(cookieHeader, getRefreshCookieName(this.configService));
    const userId =
      this.authService.resolveAccessTokenSubject(accessToken) ||
      this.authService.resolveRefreshTokenSubject(refreshToken);

    if (userId) {
      await this.authService.revokeRefreshTokens(userId);
    }

    this.clearAuthCookies(reply);
    return { message: 'Logged out successfully' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.requestPasswordReset(body);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body);
  }

  private applyAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string) {
    const secure = shouldUseSecureAuthCookies(this.configService);
    const sameSite = getAuthCookieSameSite(this.configService);
    reply.header('set-cookie', [
      buildHttpOnlyCookie(getAccessCookieName(this.configService), accessToken, {
        path: '/',
        maxAgeMs: getAccessCookieTtlMs(this.configService),
        secure,
        sameSite,
      }),
      buildHttpOnlyCookie(getRefreshCookieName(this.configService), refreshToken, {
        path: '/api/v1/auth',
        maxAgeMs: getRefreshCookieTtlMs(this.configService),
        secure,
        sameSite,
      }),
    ]);
  }

  private clearAuthCookies(reply: FastifyReply) {
    const secure = shouldUseSecureAuthCookies(this.configService);
    const sameSite = getAuthCookieSameSite(this.configService);
    reply.header('set-cookie', [
      buildClearedCookie(getAccessCookieName(this.configService), {
        path: '/',
        secure,
        sameSite,
      }),
      buildClearedCookie(getRefreshCookieName(this.configService), {
        path: '/api/v1/auth',
        secure,
        sameSite,
      }),
    ]);
  }
}
