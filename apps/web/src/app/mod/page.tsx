'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shield, Search, Ban, Clock3, Trash2, RefreshCw, Activity, Server, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { pushToast } from '@/lib/toast';

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
  displayName: string;
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

const formatPercent = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '-';
  return `${Math.round(value)}%`;
};

const formatAge = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '-';
  if (value < 60) return `${value}s ago`;
  if (value < 3600) return `${Math.floor(value / 60)}m ago`;
  return `${Math.floor(value / 3600)}h ago`;
};

const formatBitrate = (value: number | null | undefined) => {
  if (typeof value !== 'number' || value <= 0) return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(1)} Mbps`;
  return `${value} kbps`;
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
  const { accessToken } = useAuth();

  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.getModerationOverview>> | null>(null);
  const [runtimeOverview, setRuntimeOverview] = useState<Awaited<ReturnType<typeof api.getModRuntimeOverview>> | null>(null);
  const [selectedRuntimeRobotId, setSelectedRuntimeRobotId] = useState<string>('');
  const [selectedRobotId, setSelectedRobotId] = useState<string>('ALL');
  const [profanity, setProfanity] = useState<Awaited<ReturnType<typeof api.getGlobalProfanityOverview>> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [editingRobotId, setEditingRobotId] = useState<string | null>(null);
  const [robotDraft, setRobotDraft] = useState<RobotDraft | null>(null);

  useEffect(() => {
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
  }, [accessToken, router]);

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

  const refresh = async () => {
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
      pushToast('Mod data refreshed.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Update failed.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

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
      displayName: user.displayName ?? '',
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
        displayName: userDraft.displayName.trim() || null,
        role: userDraft.role,
        isActive: userDraft.isActive,
        credits: Number(userDraft.credits),
        balance: Number(userDraft.balance),
      });
      await refresh();
      pushToast('User updated.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to update user.', 'error');
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

  if (!accessToken || !allowed || loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="text-sm text-[var(--muted-foreground)]">Loading mod dashboard...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-black tracking-tight">
              <Shield className="h-7 w-7 text-sky-300" />
              Mod Dashboard
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Users, active restrictions, moderation history, and robot administration.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Updating...' : 'Update'}
          </button>
        </div>
      </section>

      <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Active Bans</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Ban className="h-5 w-5 text-red-300" />{overview?.counts.bans ?? 0}</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Active Timeouts</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Clock3 className="h-5 w-5 text-amber-300" />{overview?.counts.timeouts ?? 0}</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Blocked Profanities</p>
          <p className="mt-2 text-2xl font-black">{profanity?.total ?? 0}</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">LiveKit Rooms</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Server className="h-5 w-5 text-sky-300" />{runtimeOverview?.livekit.totals.rooms ?? 0}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {runtimeOverview?.livekit.available ? `${runtimeOverview.livekit.totals.publishers} publishers active` : 'LiveKit stats unavailable'}
          </p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Connected Clients</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Users className="h-5 w-5 text-sky-300" />{runtimeOverview?.livekit.totals.participants ?? 0}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{runtimeOverview?.summary.totalViewers ?? 0} viewers, {runtimeOverview?.summary.queuedUsers ?? 0} queued</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Average Host Load</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Activity className="h-5 w-5 text-emerald-300" />{formatPercent(runtimeOverview?.summary.avgCpuPercent)}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">RAM {formatPercent(runtimeOverview?.summary.avgMemoryPercent)} across reporting robots</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Platform Ingress</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black">{formatBitrate(runtimeOverview?.summary.totalIngressKbps)}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">Aggregate receive traffic across tracked containers</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Platform Egress</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black">{formatBitrate(runtimeOverview?.summary.totalEgressKbps)}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">Aggregate transmit traffic across tracked containers</p>
        </article>
      </section>

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

        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold">Robot Runtime</h3>
              <p className="text-xs text-[var(--muted-foreground)]">Select one robot to inspect instead of rendering the full fleet list.</p>
            </div>
            <select
              value={selectedRuntimeRobotId}
              onChange={(event) => setSelectedRuntimeRobotId(event.target.value)}
              disabled={(runtimeOverview?.robots ?? []).length === 0}
              className="min-w-56 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm disabled:opacity-60"
            >
              {(runtimeOverview?.robots ?? []).map((robot) => (
                <option key={robot.id} value={robot.id}>
                  {robot.name}
                </option>
              ))}
            </select>
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
                </div>
                <Link
                  href={`/robot/${selectedRuntimeRobot.slug}`}
                  className="rounded border border-sky-500/40 px-2 py-1 text-xs text-sky-300"
                >
                  Preview
                </Link>
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

      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Profanity Log (All Robots)</h2>
          <select
            value={selectedRobotId}
            onChange={(event) => setSelectedRobotId(event.target.value || 'ALL')}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
          >
            <option value="ALL">All robots</option>
            {(overview?.robots ?? []).map((robot) => (
              <option key={robot.id} value={robot.id}>{robot.name}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Top Users (Count)</p>
            {(profanity?.byUser ?? []).length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">No entries yet.</p>
            ) : (
              profanity?.byUser.slice(0, 12).map((entry) => (
                <p key={entry.userId} className="text-sm">{entry.userId.slice(0, 8)}...: {entry.count}</p>
              ))
            )}
          </div>
          <div className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
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

      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 text-lg font-bold">Active Restrictions (robot-specific)</h2>
        <div className="space-y-2">
          {(overview?.activeRestrictions ?? []).length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">No active timeouts or bans.</p>
          ) : (
            overview?.activeRestrictions.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
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
            <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Edit user</p>
            <div className="grid gap-2 sm:grid-cols-5">
              <input
                value={userDraft.displayName}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, displayName: event.target.value } : prev))}
                placeholder="Display name"
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              />
              <select
                value={userDraft.role}
                onChange={(event) => setUserDraft((prev) => (prev ? { ...prev, role: event.target.value as UserDraft['role'] } : prev))}
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              >
                <option value="USER">USER</option>
                <option value="MOD">MOD</option>
                <option value="ADMIN">ADMIN</option>
              </select>
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
            </div>
          </div>
        )}
      </section>

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
              <select
                value={robotDraft.visibility}
                onChange={(event) => setRobotDraft((prev) => (prev ? { ...prev, visibility: event.target.value as RobotDraft['visibility'] } : prev))}
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              >
                <option value="PUBLIC">PUBLIC</option>
                <option value="UNLISTED">UNLISTED</option>
                <option value="PRIVATE">PRIVATE</option>
              </select>
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
    </div>
  );
}
