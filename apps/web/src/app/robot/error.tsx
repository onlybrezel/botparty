'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RobotError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[RobotError]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-black text-[var(--destructive)]">Error</p>
      <h1 className="mt-4 text-2xl font-bold">Failed to load robot room</h1>
      <p className="mt-2 max-w-sm text-[var(--muted-foreground)]">
        Something went wrong loading this robot. The robot may be offline or unavailable.
      </p>
      {error.digest && (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">Error ID: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--primary-hover)]"
      >
        Try again
      </button>
    </div>
  );
}
