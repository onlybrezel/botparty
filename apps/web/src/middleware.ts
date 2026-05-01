import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  BOTPARTY_LOCALE_COOKIE,
  getPreferredLocale,
  isSupportedLocale,
  stripLocalePrefix,
} from './lib/i18n';

export function middleware(request: NextRequest) {
  const cookieLocale = request.cookies.get(BOTPARTY_LOCALE_COOKIE)?.value;
  const preferredLocale = isSupportedLocale(cookieLocale)
    ? cookieLocale
    : getPreferredLocale(request.headers.get('accept-language'));
  const { locale, pathname } = stripLocalePrefix(request.nextUrl.pathname);
  const effectiveLocale = locale ?? preferredLocale;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-botparty-locale', effectiveLocale);

  const applyLocaleCookie = (response: NextResponse) => {
    if (cookieLocale !== effectiveLocale) {
      response.cookies.set(BOTPARTY_LOCALE_COOKIE, effectiveLocale, {
        path: '/',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  };

  if (locale) {
    const rewritten = request.nextUrl.clone();
    rewritten.pathname = pathname;
    return applyLocaleCookie(NextResponse.rewrite(rewritten, { request: { headers: requestHeaders } }));
  }

  return applyLocaleCookie(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|brand/|.*\\..*).*)',
  ],
};
