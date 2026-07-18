'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Activity, Server, Users, Bot, UserRound, Siren, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { pushToast } from '@/lib/toast';
import { RuntimeView } from '@/components/mod/runtime-view';
import { ModerationView } from '@/components/mod/moderation-view';
import { UsersView } from '@/components/mod/users-view';
import { RobotsView } from '@/components/mod/robots-view';
import { formatPercent, roomModeToFields } from '@/components/mod/utils';
import { ModDashboardHeader } from '@/components/mod/mod-dashboard-header';
import {
  createRobotDraft,
  detectDefaultTimezone,
  parseRecordingMeta,
  toIsoDateTime,
  validateRobotDraftSchedule,
  type ModView,
  type RobotDraft,
  type StaffUser,
  type UserDraft,
} from '@/components/mod/mod-dashboard-model';
import { useVisibilityPolling } from '@/lib/use-visibility-polling';

export default function ModDashboardPage() {
  const router = useRouter();
  const { accessToken, hasHydrated, role: authRole, userId: authUserId, setSession, logout } = useAuth();

  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.moderation.getModerationOverview>> | null>(null);
  const [runtimeOverview, setRuntimeOverview] = useState<Awaited<ReturnType<typeof api.moderation.getModRuntimeOverview>> | null>(null);
  const [selectedRuntimeRobotId, setSelectedRuntimeRobotId] = useState<string>('');
  const [selectedRobotId, setSelectedRobotId] = useState<string>('ALL');
  const [activeView, setActiveView] = useState<ModView>('moderation');
  const [profanity, setProfanity] = useState<Awaited<ReturnType<typeof api.moderation.getGlobalProfanityOverview>> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [editingRobotId, setEditingRobotId] = useState<string | null>(null);
  const [robotDraft, setRobotDraft] = useState<RobotDraft | null>(null);
  const [moderationActionUserId, setModerationActionUserId] = useState<string | null>(null);
  const [runtimeActionLoading, setRuntimeActionLoading] = useState<string | null>(null);
  const [recordingActionLoading, setRecordingActionLoading] = useState<string | null>(null);
  const [recordingFiles, setRecordingFiles] = useState<Awaited<ReturnType<typeof api.moderation.listAdminRecordings>>>([]);
  const [selectedRecordingFile, setSelectedRecordingFile] = useState<string | null>(null);
  const [recordingRobotFilter, setRecordingRobotFilter] = useState<string>('ALL');
  const [recordingCameraFilter, setRecordingCameraFilter] = useState<string>('ALL');
  const [playerCurrentSec, setPlayerCurrentSec] = useState(0);
  const [playerDurationSec, setPlayerDurationSec] = useState(0);
  const recordingVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!accessToken) {
      router.replace('/login');
      return;
    }

    const boot = async () => {
      try {
        api.setToken(accessToken);
        const me = await api.users.getMe();
        const role = String(me.role);
        const isStaff = ['ADMIN', 'MOD', 'MODERATOR', 'CREATOR'].includes(role);
        if (!isStaff) {
          pushToast('No access to mod dashboard.', 'error');
          router.replace('/dashboard');
          return;
        }

        setAllowed(true);
        const [staffUsers, modOverview, runtime, globalProfanity] = await Promise.all([
          api.users.getAdminUsers({ limit: 120 }),
          api.moderation.getModerationOverview(),
          api.moderation.getModRuntimeOverview(),
          api.moderation.getGlobalProfanityOverview(),
        ]);
        setUsers(staffUsers as StaffUser[]);
        setOverview(modOverview);
        setRuntimeOverview(runtime);
        setProfanity(globalProfanity);
        if (me.role === 'ADMIN') {
          const recordings = await api.moderation.listAdminRecordings();
          setRecordingFiles(recordings);
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Failed to load mod dashboard.', 'error');
      } finally {
        setLoading(false);
      }
    };

    void boot();
  }, [accessToken, hasHydrated, router]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      [user.username, user.displayName ?? '', user.email ?? ''].some((value) => value.toLowerCase().includes(q)),
    );
  }, [users, query]);

  const filteredProfanityEvents = useMemo(() => {
    if (!profanity) return [];
    if (selectedRobotId === 'ALL') return profanity.events;
    return profanity.events.filter((event) => event.robotId === selectedRobotId);
  }, [profanity, selectedRobotId]);

  const selectedRuntimeRobot = useMemo(() => {
    if (!runtimeOverview?.robots.length) return null;
    return runtimeOverview.robots.find((robot) => robot.id === selectedRuntimeRobotId) ?? runtimeOverview.robots[0] ?? null;
  }, [runtimeOverview, selectedRuntimeRobotId]);

  const handleRuntimeRobotUpdate = async () => {
    if (!accessToken || !selectedRuntimeRobot || runtimeActionLoading) return;

    setRuntimeActionLoading(selectedRuntimeRobot.id);
    try {
      api.setToken(accessToken);
      const result = await api.moderation.enqueueStaffRobotAction(selectedRuntimeRobot.id, { type: 'update_client' });
      if (result.alreadyQueued) {
        pushToast('Client update is already queued for this robot.', 'info', 2600);
        return;
      }
      pushToast('Client update queued from mod runtime.', 'success', 2600);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to queue client update.', 'error');
    } finally {
      setRuntimeActionLoading(null);
    }
  };

  const activeRecordings = useMemo(() => {
    return (runtimeOverview?.robots ?? []).filter((robot) => robot.livekit?.activeRecording);
  }, [runtimeOverview]);

  const stopRecordingForRobot = async (robotId: string) => {
    if (!accessToken || !viewerIsAdmin || recordingActionLoading) return;

    setRecordingActionLoading(robotId);
    try {
      api.setToken(accessToken);
      await api.moderation.stopAdminRobotRecording(robotId);
      await refresh({ silent: true });
      pushToast('Recording stopped.', 'success', 1600);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to stop recording.', 'error');
    } finally {
      setRecordingActionLoading(null);
    }
  };

  const stopAllRecordings = async () => {
    if (!accessToken || !viewerIsAdmin || recordingActionLoading || activeRecordings.length === 0) return;

    setRecordingActionLoading('__all__');
    try {
      api.setToken(accessToken);
      await Promise.all(activeRecordings.map((robot) => api.moderation.stopAdminRobotRecording(robot.id)));
      await refresh({ silent: true });
      pushToast('All active recordings stopped.', 'success', 2200);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to stop all recordings.', 'error');
    } finally {
      setRecordingActionLoading(null);
    }
  };

  const selectedUser = useMemo(
    () => users.find((user) => user.id === editingUserId) ?? null,
    [editingUserId, users],
  );

  const viewerIsAdmin = authRole === 'ADMIN';

  const overviewCards = useMemo(
    () => [
      {
        key: 'restrictions',
        label: 'Open restrictions',
        value: (overview?.counts.bans ?? 0) + (overview?.counts.timeouts ?? 0),
        detail: `${overview?.counts.bans ?? 0} bans, ${overview?.counts.timeouts ?? 0} timeouts`,
        accent: 'text-red-300',
        icon: Ban,
      },
      {
        key: 'profanity',
        label: 'Blocked profanities',
        value: profanity?.total ?? 0,
        detail: `${filteredProfanityEvents.length} visible in current filter`,
        accent: 'text-amber-300',
        icon: Siren,
      },
      {
        key: 'runtime',
        label: 'Live viewers',
        value: runtimeOverview?.summary.totalViewers ?? 0,
        detail: `${runtimeOverview?.summary.queuedUsers ?? 0} queued users`,
        accent: 'text-sky-300',
        icon: Users,
      },
      {
        key: 'fleet',
        label: 'Robots online',
        value: runtimeOverview?.summary.onlineRobots ?? 0,
        detail: `${runtimeOverview?.summary.busyRobots ?? 0} busy, ${runtimeOverview?.summary.offlineRobots ?? 0} offline`,
        accent: 'text-emerald-300',
        icon: Bot,
      },
      {
        key: 'runtime-load',
        label: 'Avg host load',
        value: formatPercent(runtimeOverview?.summary.avgCpuPercent),
        detail: `RAM ${formatPercent(runtimeOverview?.summary.avgMemoryPercent)}`,
        accent: 'text-emerald-300',
        icon: Activity,
      },
      {
        key: 'rooms',
        label: 'LiveKit rooms',
        value: runtimeOverview?.livekit.totals.rooms ?? 0,
        detail: `${runtimeOverview?.livekit.totals.participants ?? 0} connected clients`,
        accent: 'text-sky-300',
        icon: Server,
      },
    ],
    [filteredProfanityEvents.length, overview, profanity, runtimeOverview],
  );

  const actionItems = useMemo(() => {
    const items: Array<{ title: string; detail: string; view: ModView }> = [];

    if ((overview?.activeRestrictions.length ?? 0) > 0) {
      items.push({
        title: 'Restrictions need review',
        detail: `${overview?.activeRestrictions.length ?? 0} active restriction entries are still open.`,
        view: 'moderation',
      });
    }

    if ((profanity?.events.length ?? 0) > 0) {
      items.push({
        title: 'Profanity events available',
        detail: `${profanity?.events.length ?? 0} recent events can be reviewed in the moderation tab.`,
        view: 'moderation',
      });
    }

    if (runtimeOverview && !runtimeOverview.livekit.available) {
      items.push({
        title: 'LiveKit telemetry degraded',
        detail: runtimeOverview.livekit.error ?? 'Room stats are unavailable right now.',
        view: 'runtime',
      });
    }

    if (runtimeOverview && !runtimeOverview.platform.available) {
      items.push({
        title: 'Docker runtime degraded',
        detail: runtimeOverview.platform.error ?? 'Container metrics are unavailable right now.',
        view: 'runtime',
      });
    }

    if (!items.length) {
      items.push({
        title: 'No urgent issues',
        detail: 'Moderation queue and runtime telemetry look stable at the moment.',
        view: 'moderation',
      });
    }

    return items.slice(0, 3);
  }, [overview, profanity, runtimeOverview]);

  const viewButtons: Array<{ id: ModView; label: string; description: string; icon: typeof Shield }> = [
    { id: 'moderation', label: 'Moderation', description: 'Restrictions, profanity, incident flow', icon: Shield },
    { id: 'runtime', label: 'Runtime', description: 'Ops, Docker, LiveKit, robot health', icon: Activity },
    ...(viewerIsAdmin ? [{ id: 'robots' as const, label: 'Robots', description: 'Robot administration and edits', icon: Bot }] : []),
    { id: 'users', label: 'Users', description: viewerIsAdmin ? 'Account administration' : 'Moderation identity lookup', icon: UserRound },
  ];

  useEffect(() => {
    const robots = runtimeOverview?.robots ?? [];
    if (robots.length === 0) {
      if (selectedRuntimeRobotId) {
        setSelectedRuntimeRobotId('');
      }
      return;
    }

    if (!selectedRuntimeRobotId || !robots.some((robot) => robot.id === selectedRuntimeRobotId)) {
      setSelectedRuntimeRobotId(robots[0]?.id ?? '');
    }
  }, [runtimeOverview, selectedRuntimeRobotId]);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!accessToken) return;
    setRefreshing(true);
    try {
      api.setToken(accessToken);
      const [staffUsers, modOverview, runtime, globalProfanity] = await Promise.all([
        api.users.getAdminUsers({ q: query || undefined, limit: 120 }),
        api.moderation.getModerationOverview(),
        api.moderation.getModRuntimeOverview(),
        api.moderation.getGlobalProfanityOverview(),
      ]);
      setUsers(staffUsers as StaffUser[]);
      setOverview(modOverview);
      setRuntimeOverview(runtime);
      setProfanity(globalProfanity);
      if (viewerIsAdmin) {
        const recordings = await api.moderation.listAdminRecordings();
        setRecordingFiles(recordings);
      }
      if (!options?.silent) {
        pushToast('Mod data refreshed.', 'success');
      }
    } catch (err) {
      if (!options?.silent) {
        pushToast(err instanceof Error ? err.message : 'Update failed.', 'error');
      }
    } finally {
      setRefreshing(false);
    }
  }, [accessToken, query, viewerIsAdmin]);

  const selectedRecording = useMemo(() => {
    if (!selectedRecordingFile) return null;
    return recordingFiles.find((file) => file.fileName === selectedRecordingFile) ?? null;
  }, [recordingFiles, selectedRecordingFile]);

  const recordingRobotNameMap = useMemo(() => {
    const robots = runtimeOverview?.robots ?? [];
    return new Map(robots.map((robot) => [robot.id, robot.name]));
  }, [runtimeOverview]);

  const recordingEntries = useMemo(() => {
    return recordingFiles
      .map((file) => {
        const parsed = parseRecordingMeta(file);
        const { recordedAt: _ignoredRecordedAt, ...rest } = file;
        void _ignoredRecordedAt;
        return {
          ...rest,
          parsedRobotId: parsed.robotId ?? null,
          parsedCameraId: parsed.cameraId,
          recordedAt: parsed.recordedAt,
          robotName: parsed.robotId ? (recordingRobotNameMap.get(parsed.robotId) ?? parsed.robotId) : null,
        };
      })
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  }, [recordingFiles, recordingRobotNameMap]);

  const recordingRobotOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of recordingEntries) {
      if (!entry.parsedRobotId) continue;
      map.set(entry.parsedRobotId, entry.robotName ?? entry.parsedRobotId);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [recordingEntries]);

  const recordingCameraOptions = useMemo(() => {
    const values = new Set<string>();
    for (const entry of recordingEntries) {
      if (entry.parsedCameraId) values.add(entry.parsedCameraId);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [recordingEntries]);

  const filteredRecordingEntries = useMemo(() => {
    return recordingEntries.filter((entry) => {
      if (recordingRobotFilter !== 'ALL' && entry.parsedRobotId !== recordingRobotFilter) {
        return false;
      }
      if (recordingCameraFilter !== 'ALL' && entry.parsedCameraId !== recordingCameraFilter) {
        return false;
      }
      return true;
    });
  }, [recordingCameraFilter, recordingEntries, recordingRobotFilter]);

  const selectedRecordingEntry = useMemo(() => {
    if (!selectedRecordingFile) return null;
    return recordingEntries.find((entry) => entry.fileName === selectedRecordingFile) ?? null;
  }, [recordingEntries, selectedRecordingFile]);

  const selectedRecordingClock = useMemo(() => {
    if (!selectedRecordingEntry?.recordedAt) return null;
    const ts = selectedRecordingEntry.recordedAt.getTime() + Math.max(0, playerCurrentSec) * 1000;
    return new Date(ts);
  }, [playerCurrentSec, selectedRecordingEntry]);

  const selectedRecordingEndClock = useMemo(() => {
    if (!selectedRecordingEntry?.recordedAt || !playerDurationSec || !Number.isFinite(playerDurationSec)) return null;
    return new Date(selectedRecordingEntry.recordedAt.getTime() + playerDurationSec * 1000);
  }, [playerDurationSec, selectedRecordingEntry]);

  const playerProgressPercent = useMemo(() => {
    if (!playerDurationSec || !Number.isFinite(playerDurationSec) || playerDurationSec <= 0) return 0;
    return Math.min(100, Math.max(0, (playerCurrentSec / playerDurationSec) * 100));
  }, [playerCurrentSec, playerDurationSec]);

  useEffect(() => {
    setPlayerCurrentSec(0);
    setPlayerDurationSec(0);
  }, [selectedRecordingFile]);

  useEffect(() => {
    if (!selectedRecordingFile) return;
    if (filteredRecordingEntries.some((entry) => entry.fileName === selectedRecordingFile)) return;
    setSelectedRecordingFile(filteredRecordingEntries[0]?.fileName ?? null);
  }, [filteredRecordingEntries, selectedRecordingFile]);

  useVisibilityPolling(
    () => refresh({ silent: true }),
    {
      enabled: Boolean(accessToken && allowed),
      intervalMs: 15_000,
      hiddenIntervalMs: null,
      runImmediately: false,
    },
  );

  const unrestrict = async (robotId: string, userId: string) => {
    if (!accessToken) return;
    try {
      setModerationActionUserId(userId);
      api.setToken(accessToken);
      await api.moderation.moderateRobotUser(robotId, {
        targetUserId: userId,
        action: 'UNBAN',
        reason: 'Removed by staff dashboard',
      });
      await refresh();
      pushToast('User unbanned.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Unban failed.', 'error');
    } finally {
      setModerationActionUserId(null);
    }
  };

  const timeoutProfanityUser = async (robotId: string, userId: string) => {
    if (!accessToken) return;
    try {
      setModerationActionUserId(userId);
      api.setToken(accessToken);
      await api.moderation.moderateRobotUser(robotId, {
        targetUserId: userId,
        action: 'TIMEOUT',
        durationSec: 10 * 60,
        reason: 'Blocked profanity confirmed by staff dashboard',
      });
      await refresh();
      pushToast('User timed out for 10 minutes.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Timeout failed.', 'error');
    } finally {
      setModerationActionUserId(null);
    }
  };

  const banProfanityUser = async (robotId: string, userId: string) => {
    if (!accessToken) return;
    try {
      setModerationActionUserId(userId);
      api.setToken(accessToken);
      await api.moderation.moderateRobotUser(robotId, {
        targetUserId: userId,
        action: 'BAN',
        reason: 'Repeated or severe profanity confirmed by staff dashboard',
      });
      await refresh();
      pushToast('User banned from the robot.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Ban failed.', 'error');
    } finally {
      setModerationActionUserId(null);
    }
  };

  const deleteRobotAsStaff = async (robotId: string, robotName: string) => {
    if (!accessToken) return;
    if (!window.confirm(`Delete robot ${robotName}? This cannot be undone.`)) return;

    try {
      api.setToken(accessToken);
      await api.robots.deleteRobotAsStaff(robotId);
      await refresh();
      if (editingRobotId === robotId) {
        setEditingRobotId(null);
        setRobotDraft(null);
      }
      pushToast('Robot deleted.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to delete robot.', 'error');
    }
  };

  const startUserEdit = (user: StaffUser) => {
    setEditingUserId(user.id);
    setUserDraft({
      username: user.username,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      password: '',
      role: user.role,
      isActive: user.isActive,
      credits: String(user.credits ?? 0),
      balance: String(user.balance ?? 0),
    });
  };

  const saveUserEdit = async () => {
    if (!editingUserId || !userDraft || !accessToken) return;
    try {
      api.setToken(accessToken);
      await api.users.updateAdminUser(editingUserId, {
        username: userDraft.username.trim(),
        email: userDraft.email.trim(),
        displayName: userDraft.displayName.trim() || null,
        password: userDraft.password.trim() || undefined,
        role: userDraft.role,
        isActive: userDraft.isActive,
        credits: Number(userDraft.credits),
        balance: Number(userDraft.balance),
      });
      if (editingUserId === authUserId) {
        setSession({
          username: userDraft.username.trim(),
          displayName: userDraft.displayName.trim() || null,
          role: userDraft.role,
        });
      }
      setEditingUserId(null);
      setUserDraft(null);
      await refresh();
      pushToast('User updated.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to update user.', 'error');
    }
  };

  const deleteUserAsStaff = async () => {
    if (!editingUserId || !selectedUser || !accessToken) return;
    if (!window.confirm(`Delete user ${selectedUser.username}? This cannot be undone.`)) return;

    try {
      api.setToken(accessToken);
      await api.users.deleteAdminUser(editingUserId);
      const deletedOwnAccount = editingUserId === authUserId;
      setEditingUserId(null);
      setUserDraft(null);
      await refresh();
      if (deletedOwnAccount) {
        logout();
        router.replace('/login');
        return;
      }
      pushToast('User deleted.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to delete user.', 'error');
    }
  };

  const startRobotEdit = (robot: NonNullable<Awaited<ReturnType<typeof api.moderation.getModerationOverview>>['robots']>[number]) => {
    setEditingRobotId(robot.id);
    setRobotDraft(createRobotDraft(robot));
  };

  const saveRobotEdit = async () => {
    if (!editingRobotId || !robotDraft || !accessToken) return;

    const scheduleError = validateRobotDraftSchedule(robotDraft);
    if (scheduleError) {
      pushToast(scheduleError, 'error');
      return;
    }

    try {
      api.setToken(accessToken);
      const { visibility, accessMode } = roomModeToFields(robotDraft.roomMode);
      const bitrate = Number(robotDraft.targetBitrateKbps);
      const maxTurnTime = Math.max(1000, Math.round(Number(robotDraft.maxTurnTime) || 60000));
      const maxViewers = Math.max(1, Math.round(Number(robotDraft.maxViewers) || 1000));
      const maxControllers = Math.max(1, Math.round(Number(robotDraft.maxControllers) || 1));
      const scheduleStart = robotDraft.scheduleEnabled ? toIsoDateTime(robotDraft.scheduleStart) : null;
      const scheduleEnd = robotDraft.scheduleEnabled ? toIsoDateTime(robotDraft.scheduleEnd) : null;
      await api.robots.updateRobotAsStaff(editingRobotId, {
        name: robotDraft.name.trim(),
        slug: robotDraft.slug.trim() || undefined,
        description: robotDraft.description.trim() || undefined,
        visibility,
        accessMode,
        queueMode: robotDraft.queueMode,
        scheduleStart,
        scheduleEnd,
        timezone: robotDraft.timezone.trim() || detectDefaultTimezone(),
        maxTurnTime,
        maxViewers,
        maxControllers,
        acl: {
          video: robotDraft.aclVideo,
          control: robotDraft.aclControl,
          chat: robotDraft.aclChat,
          estop: robotDraft.aclEStop,
        },
        stream: {
          targetBitrateKbps:
            Number.isFinite(bitrate) && bitrate >= 150 && bitrate <= 3000 ? Math.round(bitrate) : undefined,
        },
        tags: robotDraft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 12),
        accessPassword:
          robotDraft.roomMode === 'PASSWORD' ? robotDraft.accessPassword.trim() || undefined : undefined,
      });
      setEditingRobotId(null);
      setRobotDraft(null);
      await refresh();
      pushToast('Robot updated.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to update robot.', 'error');
    }
  };

  if (!hasHydrated || !accessToken || !allowed || loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="text-sm text-[var(--muted-foreground)]">Loading mod dashboard...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <ModDashboardHeader
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        overviewCards={overviewCards}
        actionItems={actionItems}
        generatedAt={runtimeOverview?.generatedAt}
        ingressKbps={runtimeOverview?.summary.totalIngressKbps}
        egressKbps={runtimeOverview?.summary.totalEgressKbps}
        activeView={activeView}
        onActiveViewChange={setActiveView}
        viewButtons={viewButtons}
      />

      {activeView === 'runtime' ? (
        <RuntimeView
          runtimeOverview={runtimeOverview}
          selectedRuntimeRobotId={selectedRuntimeRobotId}
          onSelectedRuntimeRobotIdChange={setSelectedRuntimeRobotId}
          runtimeActionLoading={runtimeActionLoading}
          onRuntimeRobotUpdate={handleRuntimeRobotUpdate}
          viewerIsAdmin={viewerIsAdmin}
          activeRecordings={activeRecordings}
          recordingActionLoading={recordingActionLoading}
          onStopRecording={stopRecordingForRobot}
          onStopAllRecordings={stopAllRecordings}
          recordingFiles={recordingFiles}
          recordingRobotFilter={recordingRobotFilter}
          onRecordingRobotFilterChange={setRecordingRobotFilter}
          recordingCameraFilter={recordingCameraFilter}
          onRecordingCameraFilterChange={setRecordingCameraFilter}
          recordingRobotOptions={recordingRobotOptions}
          recordingCameraOptions={recordingCameraOptions}
          filteredRecordingEntries={filteredRecordingEntries}
          recordingEntries={recordingEntries}
          selectedRecordingFile={selectedRecordingFile}
          onSelectRecordingFile={setSelectedRecordingFile}
          selectedRecording={selectedRecording}
          selectedRecordingEntry={selectedRecordingEntry}
          recordingVideoRef={recordingVideoRef}
          playerCurrentSec={playerCurrentSec}
          onPlayerCurrentSecChange={setPlayerCurrentSec}
          playerDurationSec={playerDurationSec}
          onPlayerDurationSecChange={setPlayerDurationSec}
          selectedRecordingClock={selectedRecordingClock}
          selectedRecordingEndClock={selectedRecordingEndClock}
          playerProgressPercent={playerProgressPercent}
        />
      ) : null}

      {activeView === 'moderation' ? (
        <ModerationView
          overview={overview}
          profanity={profanity}
          runtimeOverview={runtimeOverview}
          selectedRobotId={selectedRobotId}
          onSelectedRobotIdChange={setSelectedRobotId}
          filteredProfanityEvents={filteredProfanityEvents}
          onUnrestrict={unrestrict}
          onTimeoutProfanityUser={timeoutProfanityUser}
          onBanProfanityUser={banProfanityUser}
          moderationActionUserId={moderationActionUserId}
        />
      ) : null}

      {activeView === 'users' ? (
        <UsersView
          filteredUsers={filteredUsers}
          query={query}
          onQueryChange={setQuery}
          editingUserId={editingUserId}
          userDraft={userDraft}
          onStartUserEdit={startUserEdit}
          onUserDraftChange={setUserDraft}
          onSaveUserEdit={saveUserEdit}
          onCancelUserEdit={() => { setEditingUserId(null); setUserDraft(null); }}
          onDeleteUser={deleteUserAsStaff}
          viewerIsAdmin={viewerIsAdmin}
        />
      ) : null}

      {activeView === 'robots' && viewerIsAdmin ? (
        <RobotsView
          robots={overview?.robots ?? []}
          editingRobotId={editingRobotId}
          robotDraft={robotDraft}
          onStartRobotEdit={startRobotEdit}
          onRobotDraftChange={setRobotDraft}
          onSaveRobotEdit={saveRobotEdit}
          onCancelRobotEdit={() => { setEditingRobotId(null); setRobotDraft(null); }}
          onDeleteRobot={deleteRobotAsStaff}
        />
      ) : null}
    </div>
  );
}
