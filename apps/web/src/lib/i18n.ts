export const BOTPARTY_LOCALE_COOKIE = 'botparty.locale';
export const supportedLocales = ['en'] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = 'en';

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return supportedLocales.includes((value ?? '') as Locale);
}

export function getPreferredLocale(acceptLanguage?: string | null): Locale {
  const candidates = (acceptLanguage ?? '')
    .split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase())
    .filter((part): part is string => Boolean(part));

  for (const candidate of candidates) {
    if (candidate === 'en' || candidate.startsWith('en-')) {
      return 'en';
    }
  }

  return defaultLocale;
}

export function stripLocalePrefix(pathname: string): { locale: Locale | null; pathname: string } {
  const segments = pathname.split('/');
  const candidate = segments[1];
  if (!isSupportedLocale(candidate)) {
    return { locale: null, pathname: pathname || '/' };
  }

  const nextPath = `/${segments.slice(2).join('/')}`.replace(/\/+/g, '/');
  return {
    locale: candidate,
    pathname: nextPath === '/' ? '/' : nextPath.replace(/\/$/, '') || '/',
  };
}

export function localizePath(pathname: string, _locale: Locale): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const stripped = stripLocalePrefix(normalizedPath).pathname;
  return stripped;
}

export function localizeHref(pathname: string, locale: Locale, search?: string): string {
  const normalizedSearch = search
    ? search.startsWith('?')
      ? search
      : `?${search}`
    : '';
  return `${localizePath(pathname, locale)}${normalizedSearch}`;
}

export function localeFromPathname(pathname: string): Locale {
  return stripLocalePrefix(pathname).locale ?? defaultLocale;
}
