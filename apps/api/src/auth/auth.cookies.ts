import { ConfigService } from '@nestjs/config';

const DEFAULT_ACCESS_COOKIE_NAME = 'bp_access';
const DEFAULT_REFRESH_COOKIE_NAME = 'bp_refresh';
const DEFAULT_CSRF_COOKIE_NAME = 'bp_csrf';
const DEFAULT_ACCESS_COOKIE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_REFRESH_COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SameSiteValue = 'Strict' | 'Lax' | 'None';

function readEnvLike(config: Pick<ConfigService, 'get'>, key: string): string | undefined {
  const value = config.get<string>(key);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function getAccessCookieName(config: Pick<ConfigService, 'get'>): string {
  return readEnvLike(config, 'AUTH_ACCESS_COOKIE_NAME') ?? DEFAULT_ACCESS_COOKIE_NAME;
}

export function getRefreshCookieName(config: Pick<ConfigService, 'get'>): string {
  return readEnvLike(config, 'AUTH_REFRESH_COOKIE_NAME') ?? DEFAULT_REFRESH_COOKIE_NAME;
}

export function getCsrfCookieName(config: Pick<ConfigService, 'get'>): string {
  return readEnvLike(config, 'AUTH_CSRF_COOKIE_NAME') ?? DEFAULT_CSRF_COOKIE_NAME;
}

export function shouldUseSecureAuthCookies(config: Pick<ConfigService, 'get'>): boolean {
  const configured = readEnvLike(config, 'AUTH_COOKIE_SECURE');
  if (!configured) {
    return (readEnvLike(config, 'NODE_ENV') ?? process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  }

  return configured.toLowerCase() === 'true';
}

export function getAuthCookieSameSite(config: Pick<ConfigService, 'get'>): SameSiteValue {
  const configured = readEnvLike(config, 'AUTH_COOKIE_SAMESITE');
  if (!configured) {
    return 'Strict';
  }

  const normalized = configured.toLowerCase();
  if (normalized === 'none') {
    return 'None';
  }
  if (normalized === 'lax') {
    return 'Lax';
  }
  return 'Strict';
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const chunk of header.split(';')) {
    const trimmed = chunk.trim();
    if (!trimmed) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (key !== name) {
      continue;
    }

    const rawValue = trimmed.slice(separator + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

export function extractBearerToken(authorization?: string): string | null {
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function parseDurationMs(raw: string | undefined, fallbackMs: number): number {
  if (!raw) {
    return fallbackMs;
  }

  const value = raw.trim().toLowerCase();
  const match = value.match(/^(\d+)(ms|s|m|h|d|w)?$/);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  if (!Number.isFinite(amount) || amount <= 0) {
    return fallbackMs;
  }

  const multiplier =
    unit === 'w'
      ? 7 * 24 * 60 * 60 * 1000
      : unit === 'd'
        ? 24 * 60 * 60 * 1000
        : unit === 'h'
          ? 60 * 60 * 1000
          : unit === 'm'
            ? 60 * 1000
            : unit === 's'
              ? 1000
              : 1;

  return amount * multiplier;
}

export function getAccessCookieTtlMs(config: Pick<ConfigService, 'get'>): number {
  return parseDurationMs(readEnvLike(config, 'JWT_EXPIRES_IN'), DEFAULT_ACCESS_COOKIE_TTL_MS);
}

export function getRefreshCookieTtlMs(config: Pick<ConfigService, 'get'>): number {
  return parseDurationMs(readEnvLike(config, 'JWT_REFRESH_EXPIRES_IN'), DEFAULT_REFRESH_COOKIE_TTL_MS);
}

type CookieOptions = {
  path: string;
  maxAgeMs: number;
  secure: boolean;
  sameSite: SameSiteValue;
};

export function buildHttpOnlyCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeMs / 1000))}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function buildClearedCookie(
  name: string,
  options: Omit<CookieOptions, 'maxAgeMs'>,
): string {
  const parts = [
    `${name}=`,
    'HttpOnly',
    `Path=${options.path}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    `SameSite=${options.sameSite}`,
  ];

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function buildClientCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeMs / 1000))}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
