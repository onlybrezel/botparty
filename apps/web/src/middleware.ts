import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
function parseOrigins(raw: string | undefined): string[] {
  const origins = new Set<string>();
  for (const value of raw?.split(',') ?? []) {
    try {
      origins.add(new URL(value.trim()).origin);
    } catch {
      // Invalid optional origins are ignored here and rejected by deployment validation.
    }
  }
  return [...origins];
}

function buildCsp(nonce: string, pathname: string): string {
  const connectOrigins = [
    ...parseOrigins(process.env.NEXT_PUBLIC_API_URL),
    ...parseOrigins(process.env.NEXT_PUBLIC_WS_URL),
    ...parseOrigins(process.env.NEXT_PUBLIC_LIVEKIT_URL),
    ...parseOrigins(process.env.NEXT_PUBLIC_APP_URL),
    ...parseOrigins(process.env.CSP_EXTRA_CONNECT_ORIGINS),
  ];
  const imageOrigins = [
    ...parseOrigins(process.env.NEXT_PUBLIC_APP_URL),
    ...parseOrigins(process.env.THUMBNAIL_PUBLIC_BASE_URL),
    ...parseOrigins(process.env.CSP_EXTRA_IMG_ORIGINS),
  ];
  const devConnect = process.env.NODE_ENV === 'production' ? [] : ['http:', 'ws:'];
  const devScript = process.env.NODE_ENV === 'production' ? [] : ["'unsafe-eval'"];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    pathname.startsWith('/embed/') ? 'frame-ancestors https:' : "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${devScript.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${[...new Set(imageOrigins)].join(' ')}`.trim(),
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' ${[...new Set([...connectOrigins, ...devConnect])].join(' ')}`.trim(),
    "manifest-src 'self'",
    'report-uri /api/v1/health/csp-report',
  ].join('; ');
}

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/dashboard/robots/new') {
    const dashboard = request.nextUrl.clone();
    dashboard.pathname = '/dashboard';
    dashboard.hash = 'new-robot';
    return NextResponse.redirect(dashboard, 308);
  }

  if (request.nextUrl.pathname === '/de' || request.nextUrl.pathname.startsWith('/de/')) {
    const canonical = request.nextUrl.clone();
    canonical.pathname = request.nextUrl.pathname.slice(3) || '/';
    return NextResponse.redirect(canonical, 308);
  }

  if (request.nextUrl.pathname === '/explore') {
    const hasSearchFilters = ['q', 'status', 'sort', 'tag', 'limit', 'offset'].some((key) =>
      request.nextUrl.searchParams.has(key),
    );
    if (hasSearchFilters) {
      const filtered = request.nextUrl.clone();
      filtered.pathname = '/explore/search';
      return NextResponse.redirect(filtered, 308);
    }
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, request.nextUrl.pathname);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-botparty-locale', 'en');
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|brand/|.*\\..*).*)',
  ],
};
