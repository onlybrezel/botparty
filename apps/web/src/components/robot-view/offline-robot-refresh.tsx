'use client';

import { useRouter } from 'next/navigation';
import { useVisibilityPolling } from '@/lib/use-visibility-polling';

export function OfflineRobotRefresh() {
  const router = useRouter();
  useVisibilityPolling(() => router.refresh(), {
    intervalMs: 30_000,
    hiddenIntervalMs: null,
    runImmediately: false,
  });
  return null;
}
