'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type UserSessionRecord } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const LIMIT_OPTIONS = [20, 50, 100] as const;

function formatDuration(durationMs: number | null) {
  if (!durationMs || durationMs <= 0) {
    return 'In progress';
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export default function SessionsPage() {
  const router = useRouter();
  const { accessToken, hasHydrated } = useAuth();
  const [limit, setLimit] = useState<number>(50);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<UserSessionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    api.setToken(accessToken);
    api.sessions.getMySessions(limit)
      .then((result) => {
        if (active) {
          setSessions(result);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load sessions.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accessToken, hasHydrated, limit, router]);

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return sessions;
    }
    return sessions.filter((session) =>
      [session.robot.name, session.robot.slug].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [query, sessions]);

  const analytics = useMemo(() => {
    const totalDurationMs = sessions.reduce((sum, session) => sum + Math.max(session.durationMs ?? 0, 0), 0);
    const totalCommands = sessions.reduce((sum, session) => sum + session.totalCommands, 0);
    const peakViewers = sessions.reduce((max, session) => Math.max(max, session.peakViewers), 0);
    const sessionsWithLatency = sessions.filter((session) => typeof session.avgLatencyMs === 'number');
    const averageLatency = sessionsWithLatency.length
      ? Math.round(
          sessionsWithLatency.reduce((sum, session) => sum + (session.avgLatencyMs ?? 0), 0) / sessionsWithLatency.length,
        )
      : null;
    const hourBuckets = new Map<number, number>();
    for (const session of sessions) {
      const hour = new Date(session.startedAt).getHours();
      hourBuckets.set(hour, (hourBuckets.get(hour) ?? 0) + 1);
    }
    const peakHourEntry = [...hourBuckets.entries()].sort((left, right) => right[1] - left[1])[0] ?? null;

    return {
      totalSessions: sessions.length,
      totalDurationHours: (totalDurationMs / (1000 * 60 * 60)).toFixed(1),
      totalCommands,
      peakViewers,
      averageLatency,
      peakHour: peakHourEntry ? `${String(peakHourEntry[0]).padStart(2, '0')}:00` : null,
    };
  }, [sessions]);

  if (!hasHydrated || !accessToken) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="border-b border-[var(--border)] pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Recent control turns, command counts and session replays.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr),12rem]">
            <label htmlFor="session-filter" className="sr-only">Filter sessions</label>
            <input
              id="session-filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by robot name or slug"
              className="h-11 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            />
            <label htmlFor="session-limit" className="sr-only">Number of sessions</label>
            <Select id="session-limit" value={String(limit)} onChange={(event) => setLimit(Number(event.target.value))}>
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </header>

      <div className="mt-6">
        {!loading && !error && sessions.length > 0 ? (
          <div className="mb-6 grid grid-cols-2 border-y border-[var(--border)] sm:grid-cols-3 xl:grid-cols-5">
            <div className="border-b border-r border-[var(--border)] p-4 xl:border-b-0">
              <p className="text-xs text-[var(--muted-foreground)]">Sessions</p>
              <p className="mt-1 text-xl font-semibold">{analytics.totalSessions}</p>
            </div>
            <div className="border-b border-[var(--border)] p-4 sm:border-r xl:border-b-0">
              <p className="text-xs text-[var(--muted-foreground)]">Drive time</p>
              <p className="mt-1 text-xl font-semibold">{analytics.totalDurationHours}h</p>
            </div>
            <div className="border-b border-r border-[var(--border)] p-4 xl:border-b-0">
              <p className="text-xs text-[var(--muted-foreground)]">Commands</p>
              <p className="mt-1 text-xl font-semibold">{analytics.totalCommands}</p>
            </div>
            <div className="border-b border-[var(--border)] p-4 sm:border-r xl:border-b-0">
              <p className="text-xs text-[var(--muted-foreground)]">Peak viewers</p>
              <p className="mt-1 text-xl font-semibold">{analytics.peakViewers}</p>
            </div>
            <div className="p-4">
              <p className="text-xs text-[var(--muted-foreground)]">Peak hour</p>
              <p className="mt-1 text-xl font-semibold">{analytics.peakHour ?? '-'}</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Avg latency {analytics.averageLatency !== null ? `${analytics.averageLatency}ms` : '-'}
              </p>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
            Loading session history...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-6 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-6 text-center">
            <p className="text-base font-semibold">
              {sessions.length > 0 ? 'No matching sessions' : 'No sessions yet'}
            </p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              {sessions.length > 0
                ? 'Try another robot name or clear the filter.'
                : 'Join a queue from Explore and your completed control turns will appear here.'}
            </p>
            {sessions.length > 0 ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-4 inline-flex rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"
              >
                Clear filter
              </button>
            ) : (
              <Link
                href="/explore"
                className="mt-4 inline-flex rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"
              >
                Explore robots
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredSessions.map((session) => (
              <article key={session.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold">{session.robot.name}</h2>
                      <Badge tone={session.status === 'ACTIVE' ? 'success' : 'default'}>
                        {session.status === 'ACTIVE' ? 'Active' : 'Ended'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">/{session.robot.slug}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/sessions/${session.id}`}
                      className="inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium"
                    >
                      View replay
                    </Link>
                    <Link
                      href={`/robot/${session.robot.slug}`}
                      className="inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium"
                    >
                      Open robot
                    </Link>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-sm text-[var(--muted-foreground)] sm:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide">Started</p>
                    <p className="mt-1 text-[var(--foreground)]">{new Date(session.startedAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide">Ended</p>
                    <p className="mt-1 text-[var(--foreground)]">
                      {session.endedAt ? new Date(session.endedAt).toLocaleString() : 'Still active'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide">Duration</p>
                    <p className="mt-1 text-[var(--foreground)]">{formatDuration(session.durationMs)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide">Commands</p>
                    <p className="mt-1 text-[var(--foreground)]">{session.totalCommands}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide">Peak viewers</p>
                    <p className="mt-1 text-[var(--foreground)]">{session.peakViewers}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
