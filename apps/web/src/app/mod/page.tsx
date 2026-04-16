'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Shield, RefreshCw, Activity, Server, Users, Bot, UserRound, Siren, ChevronRight, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { pushToast } from '@/lib/toast';
import { useDesktopMotionPreference } from '@/lib/use-desktop-motion';
import { RuntimeView } from '@/components/mod/runtime-view';
import { ModerationView } from '@/components/mod/moderation-view';
import { UsersView } from '@/components/mod/users-view';
import { RobotsView } from '@/components/mod/robots-view';
import {
  formatBitrate,
  formatPercent,
  secondaryButtonClass,
  detectRoomMode,
  roomModeToFields,
} from '@/components/mod/utils';

type StaffUser = {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  role: 'ADMIN' | 'MOD' | 'USER';
  isActive: boolean;
  credits: number;
  balance: number;
  lastLoginAt: string | null;
};

type UserDraft = {
  username: string;
  email: string;
  displayName: string;
  password: string;
  role: 'ADMIN' | 'MOD' | 'USER';
  isActive: boolean;
  credits: string;
  balance: string;
};

type RobotDraft = {
  name: string;
  slug: string;
  description: string;
  roomMode: 'PUBLIC' | 'LINK_ONLY' | 'PASSWORD' | 'ALLOWED_USERS' | 'PRIVATE';
  queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
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
};

type ModView = 'moderation' | 'runtime' | 'robots' | 'users';

const parseCompactRecordingTime = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseRecordingMeta = (file: { fileName: string; robotId: string | null; modifiedAt: string; cameraId?: string | null; recordedAt?: string | null }) => {
  if (file.cameraId || file.recordedAt) {
    return {
      robotId: file.robotId,
      cameraId: file.cameraId ?? null,
      recordedAt: file.recordedAt ? new Date(file.recordedAt) : null,
    };
  }

  const nameWithoutExt = file.fileName.replace(/\.mp4$/i, '');
  const strict = nameWithoutExt.match(/^robot-([0-9a-f-]{36})(?:-([a-zA-Z0-9._-]+))?-(\d{4}-\d{2}-\d{2}T\d{6})$/i);
  if (strict) {
    const [, robotIdFromName, cameraIdRaw, compactTime] = strict;
    const parsedTime = compactTime ? parseCompactRecordingTime(compactTime) : null;
    return {
      robotId: file.robotId ?? robotIdFromName,
      cameraId: cameraIdRaw ? cameraIdRaw.replace(/^camera[-_]?/i, '') : null,
      recordedAt: parsedTime,
    };
  }

  const fallbackTimeMatch = nameWithoutExt.match(/(\d{4}-\d{2}-\d{2}T\d{6})(?!.*\d{4}-\d{2}-\d{2}T\d{6})/);
  const fallbackTimeToken = fallbackTimeMatch?.[1] ?? null;
  const recordedAt = fallbackTimeToken ? parseCompactRecordingTime(fallbackTimeToken) : null;
  const cameraMatch = nameWithoutExt.match(/(?:^|[-_])(camera|cam|stream)[-_]?([a-zA-Z0-9._-]+)/i);
  return {
    robotId: file.robotId,
    cameraId: cameraMatch?.[2] ?? null,
    recordedAt,
  };
};


function createRobotDraft(
  robot: NonNullable<Awaited<ReturnType<typeof api.getModerationOverview>>['robots']>[number],
): RobotDraft {
  const access = robot.metadata?.access;
  const stream = robot.metadata?.stream;

  return {
    name: robot.name,
    slug: robot.slug,
    description: robot.description ?? '',
    roomMode: detectRoomMode(robot),
    queueMode: robot.queueMode,
    aclVideo: access?.video ?? 'AUTHENTICATED',
    aclControl: access?.control ?? 'AUTHENTICATED',
    aclChat: access?.chat ?? 'AUTHENTICATED',
    aclEStop: access?.estop ?? 'AUTHENTICATED',
    targetBitrateKbps:
      typeof stream?.targetBitrateKbps === 'number' ? String(stream.targetBitrateKbps) : '',
    maxTurnTime: String(robot.maxTurnTime),
    maxViewers: String(robot.maxViewers),
    maxControllers: String(robot.maxControllers),
    tags: robot.tags.join(', '),
    accessPassword: '',
  };
}

export default function ModDashboardPage() {
  const router = useRouter();
  const { accessToken, hasHydrated, role: authRole, userId: authUserId, setSession, logout } = useAuth();
  const motionEnabled = useDesktopMotionPreference();

  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.getModerationOverview>> | null>(null);
  const [runtimeOverview, setRuntimeOverview] = useState<Awaited<ReturnType<typeof api.getModRuntimeOverview>> | null>(null);
  const [selectedRuntimeRobotId, setSelectedRuntimeRobotId] = useState<string>('');
  const [selectedRobotId, setSelectedRobotId] = useState<string>('ALL');
  const [activeView, setActiveView] = useState<ModView>('moderation');
  const [profanity, setProfanity] = useState<Awaited<ReturnType<typeof api.getGlobalProfanityOverview>> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [editingRobotId, setEditingRobotId] = useState<string | null>(null);
  const [robotDraft, setRobotDraft] = useState<RobotDraft | null>(null);
  const [runtimeActionLoading, setRuntimeActionLoading] = useState<string | null>(null);
  const [recordingActionLoading, setRecordingActionLoading] = useState<string | null>(null);
  const [recordingFiles, setRecordingFiles] = useState<Awaited<ReturnType<typeof api.listAdminRecordings>>>([]);
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
        const me = await api.getMe();
        const role = String(me.role);
        const isStaff = ['ADMIN', 'MOD', 'MODERATOR', 'CREATOR'].includes(role);
        if (!isStaff) {
          pushToast('No access to mod dashboard.', 'error');
          router.replace('/dashboard');
          return;
        }

        setAllowed(true);
        const [staffUsers, modOverview, runtime, globalProfanity] = await Promise.all([
          api.getAdminUsers({ limit: 120 }),
          api.getModerationOverview(),
          api.getModRuntimeOverview(),
          api.getGlobalProfanityOverview(),
        ]);
        setUsers(staffUsers as StaffUser[]);
        setOverview(modOverview);
        setRuntimeOverview(runtime);
        setProfanity(globalProfanity);
        if (me.role === 'ADMIN') {
          const recordings = await api.listAdminRecordings();
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
      [user.username, user.displayName ?? '', user.email].some((value) => value.toLowerCase().includes(q)),
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
      const result = await api.enqueueStaffRobotAction(selectedRuntimeRobot.id, { type: 'update_client' });
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
      await api.stopAdminRobotRecording(robotId);
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
      await Promise.all(activeRecordings.map((robot) => api.stopAdminRobotRecording(robot.id)));
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
    { id: 'robots', label: 'Robots', description: 'Robot administration and edits', icon: Bot },
    { id: 'users', label: 'Users', description: 'Staff user search and account edits', icon: UserRound },
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

  const refresh = async (options?: { silent?: boolean }) => {
    if (!accessToken) return;
    setRefreshing(true);
    try {
      api.setToken(accessToken);
      const [staffUsers, modOverview, runtime, globalProfanity] = await Promise.all([
        api.getAdminUsers({ q: query || undefined, limit: 120 }),
        api.getModerationOverview(),
        api.getModRuntimeOverview(),
        api.getGlobalProfanityOverview(),
      ]);
      setUsers(staffUsers as StaffUser[]);
      setOverview(modOverview);
      setRuntimeOverview(runtime);
      setProfanity(globalProfanity);
      if (viewerIsAdmin) {
        const recordings = await api.listAdminRecordings();
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
  };

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

  useEffect(() => {
    if (!accessToken || !allowed) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refresh({ silent: true });
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [accessToken, allowed]);

  const unrestrict = async (robotId: string, userId: string) => {
    if (!accessToken) return;
    try {
      api.setToken(accessToken);
      await api.moderateRobotUser(robotId, {
        targetUserId: userId,
        action: 'UNBAN',
        reason: 'Removed by staff dashboard',
      });
      await refresh();
      pushToast('User unbanned.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Unban failed.', 'error');
    }
  };

  const deleteRobotAsStaff = async (robotId: string, robotName: string) => {
    if (!accessToken) return;
    if (!window.confirm(`Delete robot ${robotName}? This cannot be undone.`)) return;

    try {
      api.setToken(accessToken);
      await api.deleteRobotAsStaff(robotId);
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
      email: user.email,
      displayName: user.displayName ?? '',
      password: '',
      role: user.role,
      isActive: user.isActive,
      credits: String(user.credits),
      balance: String(user.balance),
    });
  };

  const saveUserEdit = async () => {
    if (!editingUserId || !userDraft || !accessToken) return;
    try {
      api.setToken(accessToken);
      await api.updateAdminUser(editingUserId, {
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
      await api.deleteAdminUser(editingUserId);
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

  const startRobotEdit = (robot: NonNullable<Awaited<ReturnType<typeof api.getModerationOverview>>['robots']>[number]) => {
    setEditingRobotId(robot.id);
    setRobotDraft(createRobotDraft(robot));
  };

  const saveRobotEdit = async () => {
    if (!editingRobotId || !robotDraft || !accessToken) return;
    try {
      api.setToken(accessToken);
      const { visibility, accessMode } = roomModeToFields(robotDraft.roomMode);
      const bitrate = Number(robotDraft.targetBitrateKbps);
      const maxTurnTime = Math.max(1000, Math.round(Number(robotDraft.maxTurnTime) || 60000));
      const maxViewers = Math.max(1, Math.round(Number(robotDraft.maxViewers) || 1000));
      const maxControllers = Math.max(1, Math.round(Number(robotDraft.maxControllers) || 1));
      await api.updateRobotAsStaff(editingRobotId, {
        name: robotDraft.name.trim(),
        slug: robotDraft.slug.trim() || undefined,
        description: robotDraft.description.trim() || undefined,
        visibility,
        accessMode,
        queueMode: robotDraft.queueMode,
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
      <section className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--card)]">
        <div className="grid gap-0 xl:grid-cols-[1.35fr,0.95fr]">
          <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_38%),linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0))] p-6 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-sky-300">Staff Console</p>
                <h1 className="mt-2 flex items-center gap-3 text-3xl font-black tracking-tight">
                  <span className="rounded-2xl border border-sky-400/30 bg-sky-400/10 p-2">
                    <Shield className="h-7 w-7 text-sky-300" />
                  </span>
                  Mod Dashboard
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-[var(--muted-foreground)]">
                  Moderation comes first. Runtime, robot admin and staff user management are separated into focused work areas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className={secondaryButtonClass}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Updating...' : 'Update'}
              </button>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {overviewCards.map((card) => {
                const Icon = card.icon;
                return (
                  <motion.article
                    key={card.key}
                    initial={motionEnabled ? { opacity: 0, y: 16 } : false}
                    animate={motionEnabled ? { opacity: 1, y: 0 } : undefined}
                    whileHover={motionEnabled ? { y: -4, scale: 1.01 } : undefined}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--background)]/90 p-4 backdrop-blur"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{card.label}</p>
                      <Icon className={`h-4 w-4 ${card.accent}`} />
                    </div>
                    <p className="mt-3 text-2xl font-black">{card.value}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{card.detail}</p>
                  </motion.article>
                );
              })}
            </div>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Action Queue</h2>
                <p className="text-sm text-[var(--muted-foreground)]">Shortcuts into the area that currently needs attention.</p>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Snapshot {runtimeOverview ? new Date(runtimeOverview.generatedAt).toLocaleTimeString() : '-'}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {actionItems.map((item, index) => (
                <motion.button
                  key={`${item.title}-${index}`}
                  type="button"
                  onClick={() => setActiveView(item.view)}
                  whileHover={motionEnabled ? { x: 4 } : undefined}
                  whileTap={motionEnabled ? { scale: 0.99 } : undefined}
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-left transition hover:border-sky-400/40 hover:bg-sky-500/5"
                >
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.detail}</p>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 text-[var(--muted-foreground)]" />
                </motion.button>
              ))}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Platform traffic</p>
                <p className="mt-2 text-lg font-bold">{formatBitrate(runtimeOverview?.summary.totalIngressKbps)}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Ingress across tracked containers</p>
                <p className="mt-3 text-lg font-bold">{formatBitrate(runtimeOverview?.summary.totalEgressKbps)}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Egress across tracked containers</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Current focus</p>
                <p className="mt-2 text-lg font-bold capitalize">{activeView}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {(viewButtons.find((view) => view.id === activeView)?.description) ?? 'No section selected.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {viewButtons.map((view) => {
            const Icon = view.icon;
            const active = activeView === view.id;
            return (
              <motion.button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id)}
                whileHover={motionEnabled ? { y: -4, scale: 1.01 } : undefined}
                whileTap={motionEnabled ? { scale: 0.99 } : undefined}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  active
                    ? 'border-sky-400/50 bg-sky-500/12 shadow-[0_14px_30px_rgba(14,165,233,0.12),inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'border-[var(--border)] bg-[var(--card)] hover:border-sky-400/30 hover:bg-sky-500/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`rounded-xl p-2 ${active ? 'bg-sky-400/10 text-sky-300' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{view.label}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{view.description}</p>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

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

      {activeView === 'robots' ? (
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
