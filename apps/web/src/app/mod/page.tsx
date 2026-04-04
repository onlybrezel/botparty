'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shield, Search, Ban, Clock3, Trash2, RefreshCw } from 'lucide-react';
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

export default function ModDashboardPage() {
  const router = useRouter();
  const { accessToken } = useAuth();

  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.getModerationOverview>> | null>(null);
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
        const [staffUsers, modOverview, globalProfanity] = await Promise.all([
          api.getAdminUsers({ limit: 120 }),
          api.getModerationOverview(),
          api.getGlobalProfanityOverview(),
        ]);
        setUsers(staffUsers as StaffUser[]);
        setOverview(modOverview);
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

  const refresh = async () => {
    if (!accessToken) return;
    setRefreshing(true);
    try {
      api.setToken(accessToken);
      const [staffUsers, modOverview, globalProfanity] = await Promise.all([
        api.getAdminUsers({ q: query || undefined, limit: 120 }),
        api.getModerationOverview(),
        api.getGlobalProfanityOverview(),
      ]);
      setUsers(staffUsers as StaffUser[]);
      setOverview(modOverview);
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

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
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
