import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { getCsrfCookieName, parseCookie } from '../auth.cookies';

/**
 * Defense-in-depth CSRF origin guard for cookie-based mutation endpoints.
 *
 * The app defaults to SameSite=Strict cookies which already prevent CSRF.
 * This guard provides an additional layer by validating that the request
 * Origin (or Referer fallback) matches the configured APP_URL.  Requests
 * without an Origin header (e.g. direct REST clients, curl, mobile apps)
 * are passed through so as not to break non-browser flows.
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

    const allowed = this._allowedOrigin();
    if (!allowed) {
      // No APP_URL configured; skip check in dev.
      return true;
    }

    if (origin) {
      if (origin !== allowed) {
        throw new ForbiddenException('CSRF origin mismatch');
      }
    } else if (referer) {
      try {
        if (new URL(referer).origin !== allowed) {
          throw new ForbiddenException('CSRF referer mismatch');
        }
      } catch {
        throw new ForbiddenException('CSRF referer mismatch');
      }
    } else {
      throw new ForbiddenException('CSRF origin or referer required');
    }

    const csrfCookieName = getCsrfCookieName(this.configService);
    const cookieHeader = request.headers['cookie'] as string | undefined;
    const cookieToken = parseCookie(cookieHeader, csrfCookieName);
    const headerToken = (request.headers['x-csrf-token'] as string | undefined)?.trim();

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    return true;
  }

  private _allowedOrigin(): string | null {
    const raw = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim();
    if (!raw) {
      return null;
    }

    try {
      const url = new URL(raw);
      return url.origin; // e.g. "https://botparty.io"
    } catch {
      return null;
    }
  }
}
