import type { Metadata } from 'next';
import { getServerApiUrl } from '@/lib/server-api-url';

export const metadata: Metadata = {
  title: 'Status',
  description: 'Live service health and platform activity for this BotParty deployment.',
};

export const revalidate = 15;

type HealthResponse = {
  status: 'healthy' | 'degraded';
  checks: Record<string, 'ok' | 'error' | 'disabled'>;
  timestamp: string;
};

type StatsResponse = {
  totalUsers: number;
  totalRobots: number;
  liveRobots: number;
  totalLiveViewers: number;
  activeQueueEntries: number;
  totalSessions: number;
  timestamp: string;
};

async function getHealth() {
  const apiUrl = getServerApiUrl();
  try {
    const response = await fetch(`${apiUrl}/api/v1/health`, { next: { revalidate } });
    if (!response.ok) {
      return null;
    }
    return response.json() as Promise<HealthResponse>;
  } catch {
    return null;
  }
}

async function getStats() {
  const apiUrl = getServerApiUrl();
  try {
    const response = await fetch(`${apiUrl}/api/v1/health/stats`, { next: { revalidate } });
    if (!response.ok) {
      return null;
    }
    return response.json() as Promise<StatsResponse>;
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const [health, stats] = await Promise.all([getHealth(), getStats()]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
          Operations
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Platform status</h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Public health and usage snapshot for the current BotParty deployment.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
                Service health
              </p>
              <h2 className="mt-2 text-xl font-bold">
                {health?.status === 'healthy'
                  ? 'Healthy'
                  : health?.status === 'degraded'
                    ? 'Degraded'
                    : 'Unavailable'}
              </h2>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                health?.status === 'healthy'
                  ? 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-100'
                  : 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
              }`}
            >
              {health?.status ?? 'unknown'}
            </span>
          </div>

          {health ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(health.checks).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3"
                >
                  <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                    {key}
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${value === 'ok' ? 'text-emerald-800 dark:text-emerald-300' : value === 'disabled' ? 'text-[var(--muted-foreground)]' : 'text-amber-900 dark:text-amber-200'}`}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">
              Health data is currently unavailable.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
            Live platform activity
          </p>
          {stats ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Live robots
                </p>
                <p className="mt-1 text-lg font-bold">{stats.liveRobots}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Live viewers
                </p>
                <p className="mt-1 text-lg font-bold">{stats.totalLiveViewers}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Queued users
                </p>
                <p className="mt-1 text-lg font-bold">{stats.activeQueueEntries}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Total sessions
                </p>
                <p className="mt-1 text-lg font-bold">{stats.totalSessions}</p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">
              Usage data is currently unavailable.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
