'use client';

import { useEffect, useRef, useState } from 'react';
import type { RobotOnboardingStatus } from '@botparty/shared';
import { api, type RobotTelemetryPoint } from '@/lib/api';
import { useVisibilityPolling } from '@/lib/use-visibility-polling';
import type { RemoteActionType } from './types';

const REMOTE_ACTION_TYPES = new Set<RemoteActionType>([
  'restart_video',
  'restart_control',
  'restart_chat',
  'update_client',
  'set_log_stream',
]);

function isRemoteActionType(value: string): value is RemoteActionType {
  return REMOTE_ACTION_TYPES.has(value as RemoteActionType);
}

export function useDashboardRobotPolling({
  accessToken,
  robotId,
}: {
  accessToken: string | null;
  robotId: string | null;
}) {
  const enabled = Boolean(accessToken && robotId);
  const contextKey = `${accessToken ?? ''}\u0000${robotId ?? ''}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  const [pendingActionTypes, setPendingActionTypes] = useState<RemoteActionType[]>([]);
  const [diagLogs, setDiagLogs] = useState<Array<{ ts: number; line: string }>>([]);
  const [telemetry, setTelemetry] = useState<{
    latest: RobotTelemetryPoint | null;
    history: RobotTelemetryPoint[];
  }>({ latest: null, history: [] });
  const [onboarding, setOnboarding] = useState<RobotOnboardingStatus | null>(null);

  useEffect(() => {
    setPendingActionTypes([]);
    setDiagLogs([]);
    setTelemetry({ latest: null, history: [] });
    setOnboarding(null);
  }, [contextKey]);

  useVisibilityPolling(
    async () => {
      if (!accessToken || !robotId) return;
      const requestContext = contextKey;
      api.setToken(accessToken);
      const result = await api.robots.getPendingRobotActions(robotId);
      if (contextKeyRef.current !== requestContext) return;
      setPendingActionTypes(
        Array.from(new Set(result.actions.map((action) => action.type).filter(isRemoteActionType))),
      );
    },
    { enabled, intervalMs: 5_000, hiddenIntervalMs: null },
  );

  useVisibilityPolling(
    async () => {
      if (!accessToken || !robotId) return;
      const requestContext = contextKey;
      api.setToken(accessToken);
      const result = await api.robots.getRobotLogs(robotId);
      if (contextKeyRef.current !== requestContext) return;
      setDiagLogs(result.logs.slice(-150));
    },
    { enabled, intervalMs: 10_000, hiddenIntervalMs: null },
  );

  useVisibilityPolling(
    async () => {
      if (!accessToken || !robotId) return;
      const requestContext = contextKey;
      api.setToken(accessToken);
      const [nextTelemetry, nextOnboarding] = await Promise.all([
        api.robots.getRobotTelemetry(robotId),
        api.robots.getOnboardingStatus(robotId),
      ]);
      if (contextKeyRef.current !== requestContext) return;
      setTelemetry(nextTelemetry);
      setOnboarding(nextOnboarding);
    },
    { enabled, intervalMs: 10_000, hiddenIntervalMs: null },
  );

  return {
    pendingActionTypes,
    setPendingActionTypes,
    diagLogs,
    setDiagLogs,
    telemetry,
    onboarding,
  };
}
