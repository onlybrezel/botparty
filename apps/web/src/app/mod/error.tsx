'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ModError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[ModError]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-black text-[var(--destructive)]">Error</p>
      <h1 className="mt-4 text-2xl font-bold">Moderation dashboard error</h1>
      <p className="mt-2 max-w-sm text-[var(--muted-foreground)]">
        Something went wrong loading the moderation dashboard. The error has been logged.
      </p>
      {error.digest && (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">Error ID: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-hover)] transition-colors"
      >
        Reload
      </button>
    </div>
  );
}
