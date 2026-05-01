'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const version = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || 'dev';
    const scriptUrl = `/sw.js?v=${encodeURIComponent(version)}`;
    let refreshing = false;

    navigator.serviceWorker.register(scriptUrl).then((registration) => {
      const ensureLatest = () => {
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      };

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) {
          return;
        }
        installing.addEventListener('statechange', ensureLatest);
      });

      if (registration.active?.scriptURL && !registration.active.scriptURL.includes(`v=${encodeURIComponent(version)}`)) {
        void registration.update();
      }
      ensureLatest();
    }).catch(() => {
      // Installability enhancement only. Ignore registration failures.
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) {
        return;
      }
      refreshing = true;
      window.location.reload();
    });
  }, []);

  return null;
}
