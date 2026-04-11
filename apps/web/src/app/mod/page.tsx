'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shield, Search, Ban, Clock3, Trash2, RefreshCw, Activity, Server, Users, Bot, UserRound, Siren, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { pushToast } from '@/lib/toast';
import { Select } from '@/components/ui/select';

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
  description: string;
  tags: string;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
};

type ModView = 'moderation' | 'runtime' | 'robots' | 'users';

const formatPercent = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '-';
  if (value > 0 && value < 1) return '<1%';
  if (value < 10) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
};

const formatAge = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '-';
  if (value < 60) return `${value}s ago`;
  if (value < 3600) return `${Math.floor(value / 60)}m ago`;
  return `${Math.floor(value / 3600)}h ago`;
};

const formatBitrate = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '-';
  if (value <= 0) return '0 kbps';
  if (value >= 1000) return `${(value / 1000).toFixed(1)} Mbps`;
  return `${value.toFixed(value < 10 ? 1 : 0)} kbps`;
};

const formatBytes = (value: number | null | undefined) => {
  if (typeof value !== 'number' || value <= 0) return '-';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
};

const formatUptime = (value: number | null | undefined) => {
  if (typeof value !== 'number' || value < 0) return '-';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const formatClientBuild = (
  telemetry:
    | {
        clientVersion: string | null;
        gitBranch: string | null;
        gitCommit: string | null;
        gitDirty: boolean;
      }
    | null
    | undefined,
) => {
  if (!telemetry) return '-';
  const parts: string[] = [];
  if (telemetry.clientVersion) parts.push(`v${telemetry.clientVersion}`);
  if (telemetry.gitBranch) parts.push(telemetry.gitBranch);
  if (telemetry.gitCommit) parts.push(telemetry.gitCommit);
  if (telemetry.gitDirty) parts.push('dirty');
  return parts.length > 0 ? parts.join(' • ') : '-';
};

const statusClassName = (status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE') => {
  switch (status) {
    case 'ONLINE':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'BUSY':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'MAINTENANCE':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    default:
      return 'border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]';
  }
};

export default function ModDashboardPage() {
  const router = useRouter();
  const { accessToken, hasHydrated, role: authRole, userId: authUserId, setSession, logout } = useAuth();

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
    setRobotDraft({
      name: robot.name,
      description: robot.description ?? '',
      tags: robot.tags.join(', '),
      visibility: robot.visibility,
    });
  };

  const saveRobotEdit = async () => {
    if (!editingRobotId || !robotDraft || !accessToken) return;
    try {
      api.setToken(accessToken);
      await api.updateRobotAsStaff(editingRobotId, {
        name: robotDraft.name.trim(),
        description: robotDraft.description.trim() || undefined,
        visibility: robotDraft.visibility,
        tags: robotDraft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 12),
      });
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
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Updating...' : 'Update'}
              </button>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {overviewCards.map((card) => {
                const Icon = card.icon;
                return (
                  <article key={card.key} className="rounded-2xl border border-[var(--border)] bg-[var(--background)]/90 p-4 backdrop-blur">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{card.label}</p>
                      <Icon className={`h-4 w-4 ${card.accent}`} />
                    </div>
                    <p className="mt-3 text-2xl font-black">{card.value}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{card.detail}</p>
                  </article>
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
                <button
                  key={`${item.title}-${index}`}
                  type="button"
                  onClick={() => setActiveView(item.view)}
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-left transition hover:border-sky-400/40 hover:bg-sky-500/5"
                >
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.detail}</p>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 text-[var(--muted-foreground)]" />
                </button>
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
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id)}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  active
                    ? 'border-sky-400/40 bg-sky-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
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
              </button>
            );
          })}
        </div>
      </section>

      {activeView === 'runtime' ? (
        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Runtime Overview</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Host load from robot telemetry plus active LiveKit rooms, publishers, clients, and queue pressure.
            </p>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Snapshot {runtimeOverview ? new Date(runtimeOverview.generatedAt).toLocaleTimeString() : '-'}
          </p>
        </div>

        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Fleet Status</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <p>Online: <span className="font-semibold">{runtimeOverview?.summary.onlineRobots ?? 0}</span></p>
              <p>Busy: <span className="font-semibold">{runtimeOverview?.summary.busyRobots ?? 0}</span></p>
              <p>Offline: <span className="font-semibold">{runtimeOverview?.summary.offlineRobots ?? 0}</span></p>
              <p>Maint: <span className="font-semibold">{runtimeOverview?.summary.maintenanceRobots ?? 0}</span></p>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">LiveKit</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <p>Rooms: <span className="font-semibold">{runtimeOverview?.livekit.totals.rooms ?? 0}</span></p>
              <p>Publishers: <span className="font-semibold">{runtimeOverview?.livekit.totals.publishers ?? 0}</span></p>
              <p>Subscribers: <span className="font-semibold">{runtimeOverview?.livekit.totals.subscribers ?? 0}</span></p>
              <p>Ingress est.: <span className="font-semibold">{formatBitrate(runtimeOverview?.livekit.totals.estimatedIngressKbps)}</span></p>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Connectivity</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <p>Telemetry fresh: <span className="font-semibold">{runtimeOverview?.summary.telemetryFreshRobots ?? 0}</span></p>
              <p>Control WS: <span className="font-semibold">{runtimeOverview?.summary.controlConnectedRobots ?? 0}</span></p>
              <p>LiveKit OK: <span className="font-semibold">{runtimeOverview?.summary.livekitConnectedRobots ?? 0}</span></p>
              <p>Active sessions: <span className="font-semibold">{runtimeOverview?.summary.activeSessions ?? 0}</span></p>
            </div>
          </div>
        </div>

        {!runtimeOverview?.livekit.available && runtimeOverview?.livekit.error ? (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            LiveKit room stats are currently unavailable: {runtimeOverview.livekit.error}
          </div>
        ) : null}

        {!runtimeOverview?.platform.available && runtimeOverview?.platform.error ? (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Container and host metrics are currently unavailable: {runtimeOverview.platform.error}
          </div>
        ) : null}

        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold">Docker Host</h3>
            <p className="text-xs text-[var(--muted-foreground)]">cAdvisor snapshot</p>
          </div>
          {runtimeOverview?.platform.host ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">CPU</p>
                <p className="mt-1 text-sm font-semibold">{formatPercent(runtimeOverview.platform.host.cpuPercent)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Memory</p>
                <p className="mt-1 text-sm font-semibold">{formatPercent(runtimeOverview.platform.host.memoryPercent)}</p>
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                  {formatBytes(runtimeOverview.platform.host.memoryUsageBytes)} / {formatBytes(runtimeOverview.platform.host.memoryBytes)}
                </p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Ingress</p>
                <p className="mt-1 text-sm font-semibold">{formatBitrate(runtimeOverview.platform.host.rxKbps)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Egress</p>
                <p className="mt-1 text-sm font-semibold">{formatBitrate(runtimeOverview.platform.host.txKbps)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">No Docker host metrics available right now.</p>
          )}
        </div>

        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold">Docker Containers</h3>
            <p className="text-xs text-[var(--muted-foreground)]">API, web, LiveKit, nginx, redis, postgres, cAdvisor</p>
          </div>
          {(runtimeOverview?.platform.containers ?? []).length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {(runtimeOverview?.platform.containers ?? []).map((container) => (
                <div key={container.service} className="rounded border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{container.service}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">{container.containerName ?? 'container name unavailable'}</p>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)]">CPU {formatPercent(container.cpuPercent)}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded border border-[var(--border)] px-2 py-1.5">
                      <p className="text-[var(--muted-foreground)]">CPU</p>
                      <p className="font-semibold">{formatPercent(container.cpuPercent)}</p>
                    </div>
                    <div className="rounded border border-[var(--border)] px-2 py-1.5">
                      <p className="text-[var(--muted-foreground)]">Memory</p>
                      <p className="font-semibold">{formatPercent(container.memoryPercent)}</p>
                    </div>
                    <div className="rounded border border-[var(--border)] px-2 py-1.5">
                      <p className="text-[var(--muted-foreground)]">Ingress</p>
                      <p className="font-semibold">{formatBitrate(container.rxKbps)}</p>
                    </div>
                    <div className="rounded border border-[var(--border)] px-2 py-1.5">
                      <p className="text-[var(--muted-foreground)]">Egress</p>
                      <p className="font-semibold">{formatBitrate(container.txKbps)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">
                    Memory {formatBytes(container.memoryUsageBytes)} / {formatBytes(container.memoryLimitBytes)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">No Docker container metrics available right now.</p>
          )}
        </div>

        {viewerIsAdmin ? (
          <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold">Recording Control (Admin)</h3>
                <p className="text-xs text-[var(--muted-foreground)]">Live view of active room recordings with direct stop controls.</p>
              </div>
              <button
                type="button"
                onClick={() => void stopAllRecordings()}
                disabled={activeRecordings.length === 0 || recordingActionLoading !== null}
                className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 disabled:opacity-60"
              >
                {recordingActionLoading === '__all__' ? 'Stopping all...' : 'Stop all'}
              </button>
            </div>

            {activeRecordings.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">No active recordings right now.</p>
            ) : (
              <div className="grid gap-2 xl:grid-cols-2">
                {activeRecordings.map((robot) => (
                  <div key={robot.id} className="rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{robot.name}</p>
                        <p className="text-[10px] text-[var(--muted-foreground)]">/{robot.slug}</p>
                      </div>
                      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                        Recording
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Clients: {robot.livekit?.participants ?? 0} · Publishers: {robot.livekit?.publishers ?? 0}
                      </p>
                      <button
                        type="button"
                        onClick={() => void stopRecordingForRobot(robot.id)}
                        disabled={recordingActionLoading !== null}
                        className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 disabled:opacity-60"
                      >
                        {recordingActionLoading === robot.id ? 'Stopping...' : 'Stop'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold">Robot Runtime</h3>
              <p className="text-xs text-[var(--muted-foreground)]">Select one robot to inspect instead of rendering the full fleet list.</p>
            </div>
            <Select
              value={selectedRuntimeRobotId}
              onChange={(event) => setSelectedRuntimeRobotId(event.target.value)}
              disabled={(runtimeOverview?.robots ?? []).length === 0}
              className="min-w-56 bg-[var(--card)] disabled:opacity-60"
            >
              {(runtimeOverview?.robots ?? []).map((robot) => (
                <option key={robot.id} value={robot.id}>
                  {robot.name}
                </option>
              ))}
            </Select>
          </div>

          {selectedRuntimeRobot ? (
            <article key={selectedRuntimeRobot.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold">{selectedRuntimeRobot.name}</h3>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClassName(selectedRuntimeRobot.status)}`}>
                      {selectedRuntimeRobot.status}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                      {selectedRuntimeRobot.visibility}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    /{selectedRuntimeRobot.slug} · owner {selectedRuntimeRobot.owner.displayName ?? selectedRuntimeRobot.owner.username}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Client {formatClientBuild(selectedRuntimeRobot.telemetry)} · Python {selectedRuntimeRobot.telemetry?.pythonVersion ?? '-'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRuntimeRobotUpdate()}
                    disabled={runtimeActionLoading === selectedRuntimeRobot.id}
                    className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 disabled:opacity-60"
                  >
                    {runtimeActionLoading === selectedRuntimeRobot.id ? 'Queueing...' : 'Force Update'}
                  </button>
                  <Link
                    href={`/robot/${selectedRuntimeRobot.slug}`}
                    className="rounded border border-sky-500/40 px-2 py-1 text-xs text-sky-300"
                  >
                    Preview
                  </Link>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Viewers</p>
                  <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.viewerCount}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Queue</p>
                  <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.queueLength} · {selectedRuntimeRobot.queueMode}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Controller</p>
                  <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.activeSession?.user.displayName ?? selectedRuntimeRobot.activeSession?.user.username ?? selectedRuntimeRobot.queueHead?.displayName ?? selectedRuntimeRobot.queueHead?.username ?? '-'}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Heartbeat</p>
                  <p className="mt-1 text-sm font-semibold">{formatAge(selectedRuntimeRobot.heartbeatAgeSec)}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Telemetry</p>
                  <p className="mt-1 text-sm font-semibold">{formatAge(selectedRuntimeRobot.telemetryAgeSec)}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">LiveKit Room</p>
                  <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.livekit ? `${selectedRuntimeRobot.livekit.participants} clients` : '-'}</p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">CPU</p>
                  <p className="mt-1 text-sm font-semibold">{formatPercent(selectedRuntimeRobot.telemetry?.cpuPercent)}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">RAM</p>
                  <p className="mt-1 text-sm font-semibold">{formatPercent(selectedRuntimeRobot.telemetry?.memoryPercent)}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Temp</p>
                  <p className="mt-1 text-sm font-semibold">
                    {typeof selectedRuntimeRobot.telemetry?.temperatureC === 'number' ? `${selectedRuntimeRobot.telemetry.temperatureC.toFixed(1)} C` : '-'}
                  </p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Uptime</p>
                  <p className="mt-1 text-sm font-semibold">{formatUptime(selectedRuntimeRobot.telemetry?.uptimeSec)}</p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs xl:col-span-2">
                  <p className="text-[var(--muted-foreground)]">Client Build</p>
                  <p className="mt-1 text-sm font-semibold">{formatClientBuild(selectedRuntimeRobot.telemetry)}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs xl:col-span-2">
                  <p className="text-[var(--muted-foreground)]">Python</p>
                  <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.telemetry?.pythonVersion ?? '-'}</p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Control WS</p>
                  <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.telemetry?.controlConnected ? 'Connected' : 'Offline'}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">LiveKit</p>
                  <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.telemetry?.livekitConnected ? 'Connected' : 'Offline'}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Commands</p>
                  <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.telemetry?.commandsReceived ?? '-'}</p>
                </div>
                <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted-foreground)]">Ingress est.</p>
                  <p className="mt-1 text-sm font-semibold">{formatBitrate(selectedRuntimeRobot.livekit?.estimatedIngressKbps)}</p>
                </div>
              </div>

              <div className="mt-3 rounded border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                <p>
                  LiveKit clients: {selectedRuntimeRobot.livekit?.participantNames.length ? selectedRuntimeRobot.livekit.participantNames.join(', ') : 'none'}
                </p>
                <p className="mt-1">
                  Publishers {selectedRuntimeRobot.livekit?.publishers ?? 0} · Subscribers {selectedRuntimeRobot.livekit?.subscribers ?? 0} · Recording {selectedRuntimeRobot.livekit?.activeRecording ? 'on' : 'off'}
                </p>
              </div>
            </article>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">No robot runtime data available right now.</p>
          )}
        </div>
      </section>
      ) : null}

      {activeView === 'moderation' ? (
        <section className="mb-6 grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Active Restrictions</h2>
                  <p className="text-sm text-[var(--muted-foreground)]">Robot-specific bans and timeouts that may need follow-up.</p>
                </div>
                <div className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-200">
                  {(overview?.activeRestrictions ?? []).length} open
                </div>
              </div>
              <div className="space-y-2">
                {(overview?.activeRestrictions ?? []).length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)]">No active timeouts or bans.</p>
                ) : (
                  overview?.activeRestrictions.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs font-semibold">{entry.action}</span>
                        <span>{entry.user.displayName ?? entry.user.username}</span>
                        <span className="text-[var(--muted-foreground)]">on /{entry.robot.slug}</span>
                        <span className="text-[var(--muted-foreground)]">by {entry.moderator?.username ?? 'unknown'}</span>
                        <button
                          type="button"
                          onClick={() => void unrestrict(entry.robot.id, entry.user.id)}
                          className="ml-auto rounded border border-emerald-500/40 px-2 py-0.5 text-xs text-emerald-300"
                        >
                          Unban
                        </button>
                      </div>
                      {entry.reason && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{entry.reason}</p>}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div>
                  <h2 className="text-lg font-bold">Profanity Log</h2>
                  <p className="text-sm text-[var(--muted-foreground)]">Recent blocked messages across the fleet.</p>
                </div>
                <Select
                  value={selectedRobotId}
                  onChange={(event) => setSelectedRobotId(event.target.value || 'ALL')}
                  className="ml-auto bg-[var(--background)]"
                >
                  <option value="ALL">All robots</option>
                  {(overview?.robots ?? []).map((robot) => (
                    <option key={robot.id} value={robot.id}>{robot.name}</option>
                  ))}
                </Select>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Top Users</p>
                  {(profanity?.byUser ?? []).length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">No entries yet.</p>
                  ) : (
                    profanity?.byUser.slice(0, 12).map((entry) => (
                      <p key={entry.userId} className="text-sm">{entry.userId.slice(0, 8)}...: {entry.count}</p>
                    ))
                  )}
                </div>
                <div className="max-h-72 overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Recent Events</p>
                  {filteredProfanityEvents.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">No events yet.</p>
                  ) : (
                    filteredProfanityEvents.map((event, idx) => (
                      <p key={`${event.ts}-${idx}`} className="mb-1 text-xs text-[var(--muted-foreground)]">
                        [{new Date(event.ts).toLocaleTimeString()}] <span className="text-[var(--foreground)]">{event.username}</span> in <span className="text-sky-300">{event.robotName}</span>: {event.content}
                      </p>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h2 className="text-lg font-bold">Moderation Snapshot</h2>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Active bans</p>
                  <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Ban className="h-5 w-5 text-red-300" />{overview?.counts.bans ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Active timeouts</p>
                  <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Clock3 className="h-5 w-5 text-amber-300" />{overview?.counts.timeouts ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Blocked profanities</p>
                  <p className="mt-2 text-2xl font-black">{profanity?.total ?? 0}</p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h2 className="text-lg font-bold">Escalation Signals</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="font-semibold">Queue pressure</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{runtimeOverview?.summary.queuedUsers ?? 0} users are waiting for control.</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="font-semibold">Robot availability</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {runtimeOverview?.summary.onlineRobots ?? 0} online, {runtimeOverview?.summary.maintenanceRobots ?? 0} in maintenance.
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="font-semibold">LiveKit health</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {runtimeOverview?.livekit.available ? `${runtimeOverview?.livekit.totals.publishers ?? 0} publishers active.` : runtimeOverview?.livekit.error ?? 'Unavailable'}
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </section>
      ) : null}

      {activeView === 'users' ? (
        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-bold">Users</h2>
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-8 pr-3 text-sm"
              placeholder="Search users..."
            />
          </div>
        </div>

        <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
          {filteredUsers.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => startUserEdit(user)}
              className="grid w-full grid-cols-12 gap-2 border-b border-[var(--border)] px-3 py-2 text-left text-sm last:border-none hover:bg-[var(--muted)]"
            >
              <span className="col-span-3 truncate">{user.displayName ?? user.username}</span>
              <span className="col-span-4 truncate text-[var(--muted-foreground)]">{user.email}</span>
              <span className="col-span-2 text-xs text-[var(--muted-foreground)]">{user.role}</span>
              <span className="col-span-2 text-right text-xs text-[var(--muted-foreground)]">{user.credits} cr</span>
              <span className="col-span-1 text-right text-xs text-sky-300">Edit</span>
            </button>
          ))}
        </div>

        {editingUserId && userDraft && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Edit user</p>
                <p className="mt-1 text-sm font-semibold">{selectedUser?.username ?? 'User'}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {viewerIsAdmin
                    ? 'Admins can edit credentials, password and delete accounts.'
                    : 'Mods can edit regular user profiles. Sensitive account changes stay admin-only.'}
                </p>
              </div>
              {selectedUser ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                  <p>Role: {selectedUser.role}</p>
                  <p>Status: {selectedUser.isActive ? 'Active' : 'Inactive'}</p>
                </div>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={userDraft.username}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, username: event.target.value } : prev))}
                placeholder="Username"
                disabled={!viewerIsAdmin}
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
              <input
                value={userDraft.email}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
                placeholder="Email"
                type="email"
                disabled={!viewerIsAdmin}
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-5">
              <input
                value={userDraft.displayName}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, displayName: event.target.value } : prev))}
                placeholder="Display name"
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              />
              <Select
                value={userDraft.role}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, role: event.target.value as UserDraft['role'] } : prev))}
                disabled={!viewerIsAdmin}
                className="h-[38px] rounded border bg-[var(--card)] px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="USER">USER</option>
                <option value="MOD">MOD</option>
                <option value="ADMIN">ADMIN</option>
              </Select>
              <input
                value={userDraft.credits}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, credits: event.target.value } : prev))}
                placeholder="Credits"
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              />
              <input
                value={userDraft.balance}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, balance: event.target.value } : prev))}
                placeholder="Balance"
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              />
              <label className="inline-flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={userDraft.isActive}
                  onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, isActive: event.target.checked } : prev))}
                />
                Active
              </label>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={userDraft.password}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, password: event.target.value } : prev))}
                placeholder={viewerIsAdmin ? 'New password (optional)' : 'Password changes are admin-only'}
                type="password"
                autoComplete="new-password"
                disabled={!viewerIsAdmin}
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                Leave password empty to keep the current password.
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveUserEdit()}
                className="rounded border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300"
              >
                Save user
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingUserId(null);
                  setUserDraft(null);
                }}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)]"
              >
                Cancel
              </button>
              {viewerIsAdmin ? (
                <button
                  type="button"
                  onClick={() => void deleteUserAsStaff()}
                  className="ml-auto inline-flex items-center gap-2 rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete user
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>
      ) : null}

      {activeView === 'robots' ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="mb-4 text-lg font-bold">Manage Robots</h3>
        <div className="space-y-2">
          {(overview?.robots ?? []).map((robot) => (
            <div key={robot.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
              <span className="font-medium">{robot.name}</span>
              <span className="text-[var(--muted-foreground)]">/{robot.slug}</span>
              <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs">{robot.status}</span>
              <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs">{robot.visibility}</span>
              <span className="text-[var(--muted-foreground)]">Owner: {robot.owner.displayName ?? robot.owner.username}</span>
              <Link
                href={`/robot/${robot.slug}`}
                className="rounded border border-sky-500/40 px-2 py-1 text-xs text-sky-300"
              >
                Preview
              </Link>
              <button
                type="button"
                onClick={() => startRobotEdit(robot)}
                className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void deleteRobotAsStaff(robot.id, robot.name)}
                className="ml-auto inline-flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          ))}
        </div>

        {editingRobotId && robotDraft && (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Edit robot</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={robotDraft.name}
                onChange={(event) => setRobotDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                placeholder="Name"
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              />
              <Select
                value={robotDraft.visibility}
                onChange={(event) => setRobotDraft((prev) => (prev ? { ...prev, visibility: event.target.value as RobotDraft['visibility'] } : prev))}
                className="h-[38px] rounded border bg-[var(--card)] px-2 py-1.5 text-sm"
              >
                <option value="PUBLIC">PUBLIC</option>
                <option value="UNLISTED">UNLISTED</option>
                <option value="PRIVATE">PRIVATE</option>
              </Select>
              <input
                value={robotDraft.tags}
                onChange={(event) => setRobotDraft((prev) => (prev ? { ...prev, tags: event.target.value } : prev))}
                placeholder="Tags (comma separated)"
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm sm:col-span-2"
              />
              <textarea
                value={robotDraft.description}
                onChange={(event) => setRobotDraft((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                placeholder="Description"
                rows={4}
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm sm:col-span-2"
              />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveRobotEdit()}
                className="rounded border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300"
              >
                Save robot
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingRobotId(null);
                  setRobotDraft(null);
                }}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
      ) : null}
    </div>
  );
}
