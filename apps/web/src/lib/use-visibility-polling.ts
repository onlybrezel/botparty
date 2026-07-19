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
    let pageLeaving = false;
    let running = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      if (disposed || !navigator.onLine) return;
      const delay = document.visibilityState === 'visible' ? intervalMs : hiddenIntervalMs;
      if (delay === null) return;
      timer = window.setTimeout(() => void run(), delay);
    };

    const run = async () => {
      if (disposed || running || !navigator.onLine) return;
      running = true;
      try {
        await taskRef.current();
      } catch (error) {
        if (!disposed && !pageLeaving && navigator.onLine) {
          console.error('Background refresh failed', error);
        }
      } finally {
        running = false;
        schedule();
      }
    };

    const handleVisibilityChange = () => {
      clearTimer();
      if (document.visibilityState === 'visible') {
        void run();
      } else {
        schedule();
      }
    };

    const handlePageHide = () => {
      pageLeaving = true;
      clearTimer();
    };

    const handlePageShow = () => {
      pageLeaving = false;
      if (document.visibilityState === 'visible') {
        void run();
      } else {
        schedule();
      }
    };

    const handleOffline = () => {
      clearTimer();
    };

    const handleOnline = () => {
      clearTimer();
      if (document.visibilityState === 'visible') {
        void run();
      } else {
        schedule();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    if (runImmediately && document.visibilityState === 'visible') {
      void run();
    } else {
      schedule();
    }

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [enabled, hiddenIntervalMs, intervalMs, runImmediately]);
}
