export type Locale = 'en';

export const defaultLocale: Locale = 'en';

function stripLocalePrefix(pathname: string): string {
  const segments = pathname.split('/');
  if (segments[1] !== defaultLocale) {
    return pathname || '/';
  }

  const nextPath = `/${segments.slice(2).join('/')}`.replace(/\/+/g, '/');
  return nextPath === '/' ? '/' : nextPath.replace(/\/$/, '') || '/';
}

export function localizePath(pathname: string, _locale: Locale): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return stripLocalePrefix(normalizedPath);
}
