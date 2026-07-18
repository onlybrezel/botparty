'use client';

import { useEffect, useRef } from 'react';

type VisibilityPollingOptions = {
  enabled?: boolean;
  intervalMs: number;
  hiddenIntervalMs?: number | null;
  runImmediately?: boolean;
};

export function useVisibilityPolling(
  task: () => void | Promise<void>,
  {
    enabled = true,
    intervalMs,
    hiddenIntervalMs = null,
    runImmediately = true,
  }: VisibilityPollingOptions,
) {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let running = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      if (disposed) return;
      const delay = document.visibilityState === 'visible' ? intervalMs : hiddenIntervalMs;
      if (delay === null) return;
      timer = window.setTimeout(() => void run().catch(() => undefined), delay);
    };

    const run = async () => {
      if (disposed || running) return;
      running = true;
      try {
        await taskRef.current();
      } finally {
        running = false;
        schedule();
      }
    };

    const handleVisibilityChange = () => {
      clearTimer();
      if (document.visibilityState === 'visible') {
        void run().catch(() => undefined);
      } else {
        schedule();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (runImmediately && document.visibilityState === 'visible') {
      void run().catch(() => undefined);
    } else {
      schedule();
    }

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, hiddenIntervalMs, intervalMs, runImmediately]);
}
