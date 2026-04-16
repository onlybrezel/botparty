import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { pushToast } from '@/lib/toast';

export interface RobotDraft {
  name: string;
  slug: string;
  description: string;
  roomMode: 'PUBLIC' | 'LINK_ONLY' | 'PASSWORD' | 'ALLOWED_USERS' | 'PRIVATE';
  queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  timezone: string;
  aclVideo: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclControl: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclChat: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclEStop: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  targetBitrateKbps: string;
  maxTurnTime: string;
  maxViewers: string;
  maxControllers: string;
  tags: string;
  accessPassword: string;
}

/**
 * Custom hook for managing robot admin operations in mod dashboard.
 * Handles robot CRUD, filtering, and draft state.
 */
export function useRobotManagement() {
  const [robots, setRobots] = useState<any[]>([]);
  const [robotLoading, setRobotLoading] = useState(false);
  const [robotSearchFilter, setRobotSearchFilter] = useState('');
  const [editingRobotId, setEditingRobotId] = useState<string | null>(null);
  const [robotDraft, setRobotDraft] = useState<RobotDraft | null>(null);
  const [robotError, setRobotError] = useState<string | null>(null);

  const fetchRobots = useCallback(async () => {
    setRobotLoading(true);
    try {
      const fetchedRobots = await api.listAllRobots();
      setRobots(fetchedRobots);
      setRobotError(null);
    } catch (err: any) {
      const message = err?.message || 'Failed to load robots';
      setRobotError(message);
      pushToast(message, 'error');
    } finally {
      setRobotLoading(false);
    }
  }, []);

  const updateRobot = useCallback(
    async (robotId: string, draft: Partial<RobotDraft>) => {
      setRobotLoading(true);
      try {
        const updated = await api.updateRobot(robotId, {
          name: draft.name,
          description: draft.description,
          roomMode: draft.roomMode,
          queueMode: draft.queueMode,
          visibilityMode: draft.roomMode === 'PRIVATE' ? 'PRIVATE' : 'UNLISTED',
          accessPassword: draft.accessPassword || undefined,
          maxTurnTimeSec: draft.maxTurnTime ? Number(draft.maxTurnTime) : undefined,
          targetBitrateKbps: draft.targetBitrateKbps ? Number(draft.targetBitrateKbps) : undefined,
          maxViewers: draft.maxViewers ? Number(draft.maxViewers) : undefined,
          maxControllers: draft.maxControllers ? Number(draft.maxControllers) : undefined,
          tags: draft.tags?.split(',').map((t) => t.trim()) || [],
          scheduleStart: draft.scheduleStart || undefined,
          scheduleEnd: draft.scheduleEnd || undefined,
          timezone: draft.timezone || 'UTC',
          aclConfig: {
            video: draft.aclVideo || 'ALL',
            control: draft.aclControl || 'ALL',
            chat: draft.aclChat || 'ALL',
            estop: draft.aclEStop || 'AUTHENTICATED',
          },
        });

        setRobots((prev) => prev.map((r) => (r.id === robotId ? updated : r)));
        setEditingRobotId(null);
        setRobotDraft(null);
        pushToast('Robot updated successfully', 'success');
      } catch (err: any) {
        const message = err?.message || 'Failed to update robot';
        setRobotError(message);
        pushToast(message, 'error');
      } finally {
        setRobotLoading(false);
      }
    },
    [],
  );

  const deleteRobot = useCallback(
    async (robotId: string) => {
      if (!confirm('Are you sure you want to delete this robot? This cannot be undone.')) return;

      setRobotLoading(true);
      try {
        await api.deleteRobot(robotId);
        setRobots((prev) => prev.filter((r) => r.id !== robotId));
        pushToast('Robot deleted successfully', 'success');
      } catch (err: any) {
        const message = err?.message || 'Failed to delete robot';
        setRobotError(message);
        pushToast(message, 'error');
      } finally {
        setRobotLoading(false);
      }
    },
    [],
  );

  const filteredRobots = robots.filter(
    (r) =>
      r.name.toLowerCase().includes(robotSearchFilter.toLowerCase()) ||
      r.slug.toLowerCase().includes(robotSearchFilter.toLowerCase()) ||
      r.owner?.username?.toLowerCase().includes(robotSearchFilter.toLowerCase()),
  );

  return {
    robots: filteredRobots,
    robotLoading,
    robotSearchFilter,
    setRobotSearchFilter,
    editingRobotId,
    setEditingRobotId,
    robotDraft,
    setRobotDraft,
    robotError,
    fetchRobots,
    updateRobot,
    deleteRobot,
  };
}
