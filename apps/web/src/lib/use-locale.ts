'use client';

import { useEffect, useState } from 'react';
import { BOTPARTY_LOCALE_COOKIE, defaultLocale, isSupportedLocale, type Locale } from './i18n';

export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Read locale from cookie (only on client)
    if (typeof document !== 'undefined') {
      const cookies = document.cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${BOTPARTY_LOCALE_COOKIE}=`));

      if (cookies) {
        const value = cookies.split('=')[1];
        if (isSupportedLocale(value)) {
          setLocale(value);
        }
      }
    }
  }, []);

  // Return default locale on server-side or until mounted
  if (!mounted) {
    return defaultLocale;
  }

  return locale;
}
