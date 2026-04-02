'use client';

import { useEffect, useMemo, useState } from 'react';
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

export default function ModDashboardPage() {
  const router = useRouter();
  const { accessToken } = useAuth();

  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.getModerationOverview>> | null>(null);
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [profanity, setProfanity] = useState<Awaited<ReturnType<typeof api.getRobotProfanityOverview>> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
          pushToast('Kein Zugriff auf das Mod Dashboard.', 'error');
          router.replace('/dashboard');
          return;
        }

        setAllowed(true);
        const [staffUsers, modOverview] = await Promise.all([
          api.getAdminUsers({ limit: 120 }),
          api.getModerationOverview(),
        ]);
        setUsers(staffUsers as StaffUser[]);
        setOverview(modOverview);
        if (modOverview.robots[0]) {
          setSelectedRobotId(modOverview.robots[0].id);
          const prof = await api.getRobotProfanityOverview(modOverview.robots[0].id);
          setProfanity(prof);
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Mod Dashboard konnte nicht geladen werden.', 'error');
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

  const refresh = async () => {
    if (!accessToken) return;
    setRefreshing(true);
    try {
      api.setToken(accessToken);
      const [staffUsers, modOverview] = await Promise.all([
        api.getAdminUsers({ q: query || undefined, limit: 120 }),
        api.getModerationOverview(),
      ]);
      setUsers(staffUsers as StaffUser[]);
      setOverview(modOverview);
      if (selectedRobotId) {
        const prof = await api.getRobotProfanityOverview(selectedRobotId);
        setProfanity(prof);
      }
      pushToast('Mod Daten aktualisiert.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Aktualisierung fehlgeschlagen.', 'error');
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
      pushToast('Nutzer entsperrt.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Entsperren fehlgeschlagen.', 'error');
    }
  };

  const deleteRobotAsStaff = async (robotId: string, robotName: string) => {
    if (!accessToken) return;
    if (!window.confirm(`Robot ${robotName} wirklich loeschen?`)) return;

    try {
      api.setToken(accessToken);
      await api.deleteRobotAsStaff(robotId);
      await refresh();
      pushToast('Robot geloescht.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Robot konnte nicht geloescht werden.', 'error');
    }
  };

  const setRobotVisibility = async (
    robotId: string,
    visibility: 'PUBLIC' | 'PRIVATE',
  ) => {
    if (!accessToken) return;
    try {
      api.setToken(accessToken);
      await api.updateRobotAsStaff(robotId, { visibility });
      await refresh();
      pushToast(`Robot Sichtbarkeit gesetzt: ${visibility}`, 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Robot konnte nicht aktualisiert werden.', 'error');
    }
  };

  if (!accessToken || !allowed || loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="text-sm text-[var(--muted-foreground)]">Lade Mod Dashboard...</p>
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
              Nutzer, aktive Strafen, Moderationshistorie und Robot-Administration.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Aktualisieren...' : 'Aktualisieren'}
          </button>
        </div>
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Aktive Bans</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Ban className="h-5 w-5 text-red-300" />{overview?.counts.bans ?? 0}</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Aktive Timeouts</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Clock3 className="h-5 w-5 text-amber-300" />{overview?.counts.timeouts ?? 0}</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Blockierte Beleidigungen</p>
          <p className="mt-2 text-2xl font-black">{profanity?.total ?? 0}</p>
        </article>
      </section>

      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Beleidigungs-Log</h2>
          <select
            value={selectedRobotId ?? ''}
            onChange={async (event) => {
              const nextRobotId = event.target.value || null;
              setSelectedRobotId(nextRobotId);
              if (!nextRobotId || !accessToken) {
                setProfanity(null);
                return;
              }
              try {
                api.setToken(accessToken);
                const data = await api.getRobotProfanityOverview(nextRobotId);
                setProfanity(data);
              } catch (err) {
                pushToast(err instanceof Error ? err.message : 'Profanity-Log konnte nicht geladen werden.', 'error');
              }
            }}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
          >
            <option value="">Robot waehlen</option>
            {(overview?.robots ?? []).map((robot) => (
              <option key={robot.id} value={robot.id}>{robot.name}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Top Nutzer (Count)</p>
            {(profanity?.byUser ?? []).length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">Noch keine Eintraege.</p>
            ) : (
              profanity?.byUser.slice(0, 10).map((entry) => (
                <p key={entry.userId} className="text-sm">{entry.userId.slice(0, 8)}...: {entry.count}</p>
              ))
            )}
          </div>
          <div className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Letzte Events</p>
            {(profanity?.events ?? []).length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">Noch keine Events.</p>
            ) : (
              profanity?.events.map((event, idx) => (
                <p key={`${event.ts}-${idx}`} className="mb-1 text-xs text-[var(--muted-foreground)]">
                  [{new Date(event.ts).toLocaleTimeString()}] <span className="text-[var(--foreground)]">{event.username}</span>: {event.content}
                </p>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 text-lg font-bold">Aktive Strafen (robot-spezifisch)</h2>
        <div className="space-y-2">
          {(overview?.activeRestrictions ?? []).length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Keine aktiven Timeouts/Bans.</p>
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
                    Entsperren
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
          <h2 className="text-lg font-bold">Nutzer</h2>
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-8 pr-3 text-sm"
              placeholder="Suche Nutzer..."
            />
          </div>
        </div>

        <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
          {filteredUsers.map((user) => (
            <div key={user.id} className="grid grid-cols-12 gap-2 border-b border-[var(--border)] px-3 py-2 text-sm last:border-none">
              <span className="col-span-4 truncate">{user.displayName ?? user.username}</span>
              <span className="col-span-4 truncate text-[var(--muted-foreground)]">{user.email}</span>
              <span className="col-span-2 text-xs text-[var(--muted-foreground)]">{user.role}</span>
              <span className="col-span-2 text-right text-xs text-[var(--muted-foreground)]">{user.credits} cr</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 text-lg font-bold">Robots verwalten</h2>
        <div className="space-y-2">
          {(overview?.robots ?? []).map((robot) => (
            <div key={robot.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
              <span className="font-medium">{robot.name}</span>
              <span className="text-[var(--muted-foreground)]">/{robot.slug}</span>
              <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs">{robot.status}</span>
              <span className="text-[var(--muted-foreground)]">Owner: {robot.owner.displayName ?? robot.owner.username}</span>
              <button
                type="button"
                onClick={() => void setRobotVisibility(robot.id, 'PUBLIC')}
                className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300"
              >
                Public
              </button>
              <button
                type="button"
                onClick={() => void setRobotVisibility(robot.id, 'PRIVATE')}
                className="rounded border border-amber-500/40 px-2 py-1 text-xs text-amber-300"
              >
                Private
              </button>
              <button
                type="button"
                onClick={() => void deleteRobotAsStaff(robot.id, robot.name)}
                className="ml-auto inline-flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Loeschen
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
