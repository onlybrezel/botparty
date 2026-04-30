import { Controller, Post, Get, Query, Body, HttpCode, HttpStatus, Headers, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import type { FastifyReply } from 'fastify';
import {
  buildClientCookie,
  buildClearedCookie,
  buildHttpOnlyCookie,
  extractBearerToken,
  getAccessCookieName,
  getAccessCookieTtlMs,
  getAuthCookieSameSite,
  getCsrfCookieName,
  getRefreshCookieName,
  getRefreshCookieTtlMs,
  parseCookie,
  shouldUseSecureAuthCookies,
} from './auth.cookies';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @UseGuards(CsrfOriginGuard)
  @ApiOperation({ summary: 'Register a new user' })
  async register(
    @Body() body: { username: string; email: string; password: string; displayName?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.register(body);
    if (result.accessToken && result.refreshToken) {
      this.applyAuthCookies(reply, result.accessToken, result.refreshToken);
    }
    return result;
  }

  @Get('csrf')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue CSRF token for double-submit protection' })
  getCsrfToken(@Res({ passthrough: true }) reply: FastifyReply) {
    const csrfToken = randomBytes(32).toString('base64url');
    const secure = shouldUseSecureAuthCookies(this.configService);
    const sameSite = getAuthCookieSameSite(this.configService);
    const csrfCookieName = getCsrfCookieName(this.configService);

    reply.header(
      'set-cookie',
      buildClientCookie(csrfCookieName, csrfToken, {
        path: '/api/v1/auth',
        maxAgeMs: getRefreshCookieTtlMs(this.configService),
        secure,
        sameSite,
      }),
    );

    return { csrfToken };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfOriginGuard)
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
  @UseGuards(CsrfOriginGuard)
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
    if (tokens.refreshToken) {
      this.applyAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    } else {
      this.applyAccessCookie(reply, tokens.accessToken);
    }
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfOriginGuard)
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
  @UseGuards(CsrfOriginGuard)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.requestPasswordReset(body);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfOriginGuard)
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body);
  }

  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify email address with one-time token' })
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('verify-email/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfOriginGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend an email verification link' })
  async resendVerifyEmail(@Body() body: { email: string }) {
    return this.authService.resendEmailVerification(body);
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

  private applyAccessCookie(reply: FastifyReply, accessToken: string) {
    const secure = shouldUseSecureAuthCookies(this.configService);
    const sameSite = getAuthCookieSameSite(this.configService);
    reply.header(
      'set-cookie',
      buildHttpOnlyCookie(getAccessCookieName(this.configService), accessToken, {
        path: '/',
        maxAgeMs: getAccessCookieTtlMs(this.configService),
        secure,
        sameSite,
      }),
    );
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
      buildClearedCookie(getCsrfCookieName(this.configService), {
        path: '/api/v1/auth',
        secure,
        sameSite,
      }),
    ]);
  }
}
