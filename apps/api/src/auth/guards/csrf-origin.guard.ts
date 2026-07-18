import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { getCsrfCookieName, parseCookie } from '../auth.cookies';
import { getAccessCookieName, getRefreshCookieName } from '../auth.cookies';
import { timingSafeEqual } from 'crypto';

/**
 * Defense-in-depth CSRF origin guard for cookie-based mutation endpoints.
 *
 * Cookie-authenticated mutation requests must come from a configured origin
 * and present the CSRF token in both the cookie and request header. Bearer
 * clients and unauthenticated requests do not rely on browser cookies and are
 * therefore not subject to this guard.
 */
@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const origin = request.headers['origin'] as string | undefined;
    const referer = request.headers['referer'] as string | undefined;
    const method = (request.method ?? 'GET').toUpperCase();

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return true;
    }

    if (
      typeof request.headers.authorization === 'string' &&
      request.headers.authorization.startsWith('Bearer ')
    ) {
      return true;
    }

    const cookieHeader = request.headers['cookie'] as string | undefined;
    const csrfCookieName = getCsrfCookieName(this.configService);
    const hasAuthCookie = Boolean(
      parseCookie(cookieHeader, getAccessCookieName(this.configService)) ||
      parseCookie(cookieHeader, getRefreshCookieName(this.configService)) ||
      parseCookie(cookieHeader, csrfCookieName),
    );
    if (!hasAuthCookie) return true;

    const allowed = this._allowedOrigins();
    if (allowed.size === 0) throw new ForbiddenException('CSRF origin is not configured');

    if (origin) {
      if (!allowed.has(origin)) {
        throw new ForbiddenException('CSRF origin mismatch');
      }
    } else if (referer) {
      try {
        if (!allowed.has(new URL(referer).origin)) {
          throw new ForbiddenException('CSRF referer mismatch');
        }
      } catch {
        throw new ForbiddenException('CSRF referer mismatch');
      }
    } else {
      throw new ForbiddenException('CSRF origin or referer required');
    }

    const cookieToken = parseCookie(cookieHeader, csrfCookieName);
    const headerToken = (request.headers['x-csrf-token'] as string | undefined)?.trim();

    if (!cookieToken || !headerToken || !this._sameToken(cookieToken, headerToken)) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    return true;
  }

  private _allowedOrigins(): Set<string> {
    const configured = [
      this.configService.get<string>('APP_URL'),
      this.configService.get<string>('PUBLIC_WEB_URL'),
      this.configService.get<string>('CORS_ORIGIN'),
    ];
    const origins = new Set<string>();
    for (const raw of configured) {
      for (const entry of raw?.split(',') ?? []) {
        try {
          origins.add(new URL(entry.trim()).origin);
        } catch {
          // Invalid values are rejected by environment validation in production.
        }
      }
    }
    return origins;
  }

  private _sameToken(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
