'use client';

import { useEffect } from 'react';

export function SentryBrowser() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
    if (!dsn) {
      return;
    }

    let cleanup: (() => void) | undefined;

    const moduleName = '@sentry/nextjs';
    void import(moduleName)
      .then((sentry) => {
        sentry.init({
          dsn,
          environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'development',
          tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.05'),
        });

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
          sentry.captureException(event.reason);
        };

        window.addEventListener('unhandledrejection', onUnhandledRejection);
        cleanup = () => {
          window.removeEventListener('unhandledrejection', onUnhandledRejection);
        };
      })
      .catch(() => {
        // Sentry package is optional in local/dev environments.
      });

    return () => {
      cleanup?.();
    };
  }, []);

  return null;
}
