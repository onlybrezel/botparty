'use client';

import { useEffect } from 'react';
import { resolveThemeClass, usePreferences } from '@/lib/preferences';

export function ThemeController() {
  const theme = usePreferences((state) => state.theme);

  useEffect(() => {
    let releaseFrame: number | undefined;

    const finishThemeChange = () => {
      if (releaseFrame !== undefined) {
        window.cancelAnimationFrame(releaseFrame);
      }
      delete document.documentElement.dataset['themeChanging'];
    };

    const applyTheme = () => {
      const nextTheme = resolveThemeClass(theme);
      const root = document.documentElement;
      const currentTheme = root.classList.contains('light')
        ? 'light'
        : root.classList.contains('dark')
          ? 'dark'
          : null;

      if (releaseFrame !== undefined) {
        window.cancelAnimationFrame(releaseFrame);
      }
      root.dataset['themeChanging'] = 'true';
      if (currentTheme && currentTheme !== nextTheme) {
        root.classList.replace(currentTheme, nextTheme);
      } else if (!currentTheme) {
        root.classList.add(nextTheme);
      }
      root.dataset['theme'] = nextTheme;

      releaseFrame = window.requestAnimationFrame(() => {
        releaseFrame = window.requestAnimationFrame(() => {
          delete root.dataset['themeChanging'];
          releaseFrame = undefined;
        });
      });
    };

    applyTheme();

    if (theme !== 'system') {
      return finishThemeChange;
    }

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme();
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
      finishThemeChange();
    };
  }, [theme]);

  return null;
}
