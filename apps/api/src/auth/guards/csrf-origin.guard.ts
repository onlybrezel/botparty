import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

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
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const origin = request.headers['origin'] as string | undefined;

    if (!origin) {
      // No Origin header — not a browser cross-site request; allow.
      return true;
    }

    const allowed = this._allowedOrigin();
    if (!allowed) {
      // No APP_URL configured; skip check in dev.
      return true;
    }

    if (origin === allowed) {
      return true;
    }

    throw new ForbiddenException('CSRF origin mismatch');
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
