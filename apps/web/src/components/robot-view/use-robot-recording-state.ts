import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RobotPublic } from '@botparty/shared';
import { api, type AdminRobotRecordingStatus } from '@/lib/api';
import { pushToast } from '@/lib/toast';
import { getErrorMessage, isRobotOnline } from './robot-view-state.helpers';

function hasSameRecordingState(
  current: AdminRobotRecordingStatus | null,
  next: AdminRobotRecordingStatus,
) {
  return Boolean(
    current &&
      current.active === next.active &&
      current.activeCount === next.activeCount &&
      current.egressId === next.egressId &&
      current.startedAt === next.startedAt &&
      JSON.stringify(current.sessions) === JSON.stringify(next.sessions),
  );
}

function clearActiveRecording(
  current: AdminRobotRecordingStatus | null,
): AdminRobotRecordingStatus | null {
  if (!current?.active) {
    return current;
  }

  return {
    ...current,
    active: false,
    activeCount: 0,
    egressId: null,
    startedAt: null,
    sessions: [],
  };
}

type UseRobotRecordingStateParams = {
  robotId: string;
  robotStatus: RobotPublic['status'];
  isAdmin: boolean;
  accessToken: string | null;
};

export function useRobotRecordingState({
  robotId,
  robotStatus,
  isAdmin,
  accessToken,
}: UseRobotRecordingStateParams) {
  const [recordingState, setRecordingState] = useState<AdminRobotRecordingStatus | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingAction, setRecordingAction] = useState<'start' | 'stop' | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const refreshRecordingStatus = useCallback(async () => {
    if (!isAdmin || !accessToken) {
      return;
    }

    if (!isRobotOnline(robotStatus)) {
      setRecordingState((current) => clearActiveRecording(current));
      return;
    }

    api.setToken(accessToken);

    try {
      const next = await api.moderation.getAdminRobotRecordingStatus(robotId);
      setRecordingState((current) => (hasSameRecordingState(current, next) ? current : next));
      setRecordingError(null);
    } catch (error) {
      setRecordingError(getErrorMessage(error, 'Recording status unavailable'));
    }
  }, [accessToken, isAdmin, robotId, robotStatus]);

  useEffect(() => {
    if (!isAdmin || !accessToken) {
      setRecordingState(null);
      setRecordingError(null);
      return;
    }

    setRecordingLoading(true);
    void refreshRecordingStatus().finally(() => {
      setRecordingLoading(false);
    });

    const intervalId = window.setInterval(() => {
      void refreshRecordingStatus();
    }, 7000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [accessToken, isAdmin, refreshRecordingStatus]);

  const toggleRecording = useCallback(async () => {
    if (!isAdmin || !accessToken || recordingAction) {
      return;
    }

    const shouldStart = !recordingState?.active;
    setRecordingAction(shouldStart ? 'start' : 'stop');
    setRecordingError(null);
    api.setToken(accessToken);

    let timeoutId: number | null = null;

    try {
      const actionPromise = shouldStart
        ? api.moderation.startAdminRobotRecording(robotId)
        : api.moderation.stopAdminRobotRecording(robotId);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error('Recording request timed out. Please try again.'));
        }, 15000);
      });

      const next = await Promise.race([actionPromise, timeoutPromise]);
      setRecordingState(next);
      pushToast(shouldStart ? 'Recording started.' : 'Recording stopped.', 'success', 1800);
    } catch (error) {
      const message = getErrorMessage(error, 'Recording action failed');
      setRecordingError(message);
      pushToast(message, 'error', 2600);
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      setRecordingAction(null);
      void refreshRecordingStatus();
    }
  }, [
    accessToken,
    isAdmin,
    recordingAction,
    recordingState?.active,
    refreshRecordingStatus,
    robotId,
  ]);

  const recordingCameraSummary = useMemo(() => {
    const cameraIds = (recordingState?.sessions ?? [])
      .map((session) => session.cameraId)
      .filter((cameraId): cameraId is string => Boolean(cameraId));

    if (cameraIds.length === 0) {
      return recordingState?.active ? 'default camera' : null;
    }

    return cameraIds.join(', ');
  }, [recordingState]);

  return {
    recordingState,
    recordingLoading,
    recordingAction,
    recordingError,
    recordingCameraSummary,
    toggleRecording,
    refreshRecordingStatus,
  };
}
