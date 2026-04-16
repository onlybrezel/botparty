'use client';

import { useEffect } from 'react';
import { resolveThemeClass, usePreferences } from '@/lib/preferences';

export function ThemeController() {
  const theme = usePreferences((state) => state.theme);

  useEffect(() => {
    const applyTheme = () => {
      const nextTheme = resolveThemeClass(theme);
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
    };

    applyTheme();

    if (theme !== 'system') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  return null;
}
