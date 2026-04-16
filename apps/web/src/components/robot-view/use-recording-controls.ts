import { useState, useCallback } from 'react';
import { api, type AdminRobotRecordingStatus } from '@/lib/api';
import { pushToast } from '@/lib/toast';

/**
 * Custom hook to manage robot recording state and controls.
 * Only available to admins/mods.
 */
export function useRecordingControls(robotId: string) {
  const [recordingState, setRecordingState] = useState<AdminRobotRecordingStatus | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingAction, setRecordingAction] = useState<'start' | 'stop' | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const fetchRecordingStatus = useCallback(async () => {
    try {
      const status = await api.getRobotRecordingStatus(robotId);
      setRecordingState(status);
    } catch (err) {
      console.error('Failed to fetch recording status:', err);
    }
  }, [robotId]);

  const startRecording = useCallback(async () => {
    setRecordingLoading(true);
    setRecordingError(null);
    try {
      setRecordingAction('start');
      const result = await api.startRobotRecording(robotId);
      setRecordingState(result);
      pushToast('Recording started', 'success');
    } catch (err: any) {
      const message = err?.message || 'Failed to start recording';
      setRecordingError(message);
      pushToast(message, 'error');
    } finally {
      setRecordingLoading(false);
      setRecordingAction(null);
    }
  }, [robotId]);

  const stopRecording = useCallback(async () => {
    setRecordingLoading(true);
    setRecordingError(null);
    try {
      setRecordingAction('stop');
      const result = await api.stopRobotRecording(robotId);
      setRecordingState(result);
      pushToast('Recording stopped', 'success');
    } catch (err: any) {
      const message = err?.message || 'Failed to stop recording';
      setRecordingError(message);
      pushToast(message, 'error');
    } finally {
      setRecordingLoading(false);
      setRecordingAction(null);
    }
  }, [robotId]);

  return {
    recordingState,
    recordingLoading,
    recordingAction,
    recordingError,
    fetchRecordingStatus,
    startRecording,
    stopRecording,
  };
}
