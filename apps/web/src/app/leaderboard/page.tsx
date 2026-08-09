import type { Metadata } from 'next';
import Link from 'next/link';
import type { PublicRobotOverview, RobotPublic } from '@botparty/shared';
import { Trophy, Eye, Radio, Clock3, Sparkles, Flame } from 'lucide-react';
import { getServerApiUrl } from '@/lib/server-api-url';
import { isPublicRobotOverview, isRecord, isRobotPublic, parseJsonArray } from '@/lib/api-response-guards';

type CreatorLeaderboardEntry = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  credits: number;
  createdAt: string;
  recentSessions: number;
  streakDays: number;
  robotCount: number;
  isNewOperator: boolean;
};

function isCreatorLeaderboardEntry(value: unknown): value is CreatorLeaderboardEntry {
  return isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['username'] === 'string'
    && (value['displayName'] === null || typeof value['displayName'] === 'string')
    && (value['avatarUrl'] === null || typeof value['avatarUrl'] === 'string')
    && typeof value['credits'] === 'number'
    && typeof value['createdAt'] === 'string'
    && typeof value['recentSessions'] === 'number'
    && typeof value['streakDays'] === 'number'
    && typeof value['robotCount'] === 'number'
    && typeof value['isNewOperator'] === 'boolean';
}

const PERIOD_OPTIONS = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
] as const;

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'See which robot rooms are drawing a crowd right now.',
  openGraph: {
    title: 'Leaderboard — BotParty',
    description: 'See which robot rooms are drawing a crowd right now.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Leaderboard — BotParty',
    description: 'See which robot rooms are drawing a crowd right now.',
  },
};

export const revalidate = 10;

async function getRobots(): Promise<RobotPublic[]> {
  const apiUrl = getServerApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots`);
    if (!res.ok) return [];
    return parseJsonArray(await res.json(), isRobotPublic);
  } catch {
    return [];
  }
}

async function getTopCreators(period: string): Promise<CreatorLeaderboardEntry[]> {
  const apiUrl = getServerApiUrl();
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/users/leaderboard?limit=10&metric=engagement&period=${encodeURIComponent(period)}`,
    );
    if (!res.ok) return [];
    return parseJsonArray(await res.json(), isCreatorLeaderboardEntry);
  } catch {
    return [];
  }
}

async function getOverview(): Promise<PublicRobotOverview | null> {
  const apiUrl = getServerApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots/overview`);
    if (!res.ok) return null;
    const payload: unknown = await res.json();
    return isPublicRobotOverview(payload) ? payload : null;
  } catch {
    return null;
  }
}

function statusColor(status: RobotPublic['status']) {
  if (status === 'ONLINE') return 'text-[var(--online)] bg-[var(--online)]/15';
  if (status === 'BUSY') return 'text-amber-400 bg-amber-500/15';
  if (status === 'MAINTENANCE') return 'text-orange-400 bg-orange-600/15';
  return 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100';
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const selectedPeriod = PERIOD_OPTIONS.some((option) => option.id === params?.period)
    ? (params?.period ?? '30d')
    : '30d';
  const [robots, creators, overview] = await Promise.all([
    getRobots(),
    getTopCreators(selectedPeriod),
    getOverview(),
  ]);
  const ranked = [...robots].sort((a, b) => b.viewerCount - a.viewerCount);
  const newOperators = [...robots]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .filter(
      (robot, index, source) =>
        source.findIndex((candidate) => candidate.owner.id === robot.owner.id) === index,
    )
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 border-b border-[var(--border)] pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
              <Trophy className="h-6 w-6 text-[var(--primary)]" />
              Leaderboard
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Live rooms and creator activity.
            </p>
          </div>
          <div className="flex border-b border-[var(--border)]">
            {PERIOD_OPTIONS.map((option) => (
              <Link
                key={option.id}
                href={`/leaderboard?period=${option.id}`}
                className={`border-b-2 px-3 py-2 text-xs font-semibold ${
                  selectedPeriod === option.id
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)]'
                }`}
              >
                {option.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {ranked.length === 0 ? (
        <section className="rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
          <p className="text-lg font-semibold text-[var(--muted-foreground)]">No robots yet</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Connect a robot to appear on the leaderboard.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="grid grid-cols-12 border-b border-[var(--border)] px-4 py-3 text-xs uppercase tracking-wide text-[var(--muted-foreground)] sm:px-6">
            <span className="col-span-1">#</span>
            <span className="col-span-5 sm:col-span-4">Robot</span>
            <span className="col-span-3 sm:col-span-2">Status</span>
            <span className="col-span-3 sm:col-span-2">Viewers</span>
            <span className="hidden sm:col-span-3 sm:block">Owner</span>
          </div>

          <ul>
            {ranked.map((robot, index) => (
              <li
                key={robot.id}
                className="grid grid-cols-12 items-center gap-2 border-b border-[var(--border)] px-4 py-3 last:border-none sm:px-6"
              >
                <span className="col-span-1 text-sm font-bold text-[var(--muted-foreground)]">
                  {index + 1}
                </span>

                <div className="col-span-5 sm:col-span-4">
                  <Link
                    href={`/robot/${robot.owner.username}/${robot.slug}`}
                    className="truncate font-semibold hover:text-violet-300 transition-colors"
                  >
                    {robot.name}
                  </Link>
                </div>

                <span
                  className={`col-span-3 sm:col-span-2 inline-flex w-fit rounded-md px-2 py-0.5 text-xs font-medium ${statusColor(robot.status)}`}
                >
                  {robot.status}
                </span>

                <span className="col-span-3 sm:col-span-2 inline-flex items-center gap-1 text-sm">
                  <Eye className="h-3.5 w-3.5 text-violet-300" />
                  {robot.viewerCount}
                </span>

                <span className="hidden truncate text-sm text-[var(--muted-foreground)] sm:col-span-3 sm:block">
                  {robot.owner.displayName ?? robot.owner.username}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 grid grid-cols-3 border-y border-[var(--border)]">
        <div className="border-r border-[var(--border)] p-4">
          <p className="inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Radio className="h-4 w-4 text-violet-300" />
            Online robots
          </p>
          <p className="mt-1 text-xl font-semibold">
            {overview
              ? overview.totals.liveRobots
              : ranked.filter((r) => r.status === 'ONLINE' || r.status === 'BUSY').length}
          </p>
        </div>
        <div className="border-r border-[var(--border)] p-4">
          <p className="inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Eye className="h-4 w-4 text-violet-300" />
            Total live viewers
          </p>
          <p className="mt-1 text-xl font-semibold">
            {overview
              ? overview.totals.totalViewers
              : ranked.reduce((sum, r) => sum + r.viewerCount, 0)}
          </p>
        </div>
        <div className="p-4">
          <p className="inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Clock3 className="h-4 w-4 text-violet-300" />
            Ranked entries
          </p>
          <p className="mt-1 text-xl font-semibold">{ranked.length}</p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Seasonal creators</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Credits, activity streaks, and session volume for the selected window
          </p>
        </div>

        {creators.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No creator stats available yet.</p>
        ) : (
          <ul className="space-y-2">
            {creators.map((creator, index) => (
              <li
                key={creator.id}
                className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-6 text-xs font-bold text-[var(--muted-foreground)]">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {creator.displayName ?? creator.username}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span className="inline-flex items-center gap-1">
                        <Flame className="h-3 w-3 text-orange-300" />
                        {creator.streakDays}d streak
                      </span>
                      <span>{creator.recentSessions} sessions</span>
                      <span>{creator.robotCount} robots</span>
                      {creator.isNewOperator ? (
                        <span className="rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-200">
                          New operator
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  {creator.credits} sessions
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-2 text-lg font-bold">
            <Sparkles className="h-4 w-4 text-emerald-300" />
            New operators
          </h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Latest robot hosts to launch a room
          </p>
        </div>

        {newOperators.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No operator launches yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {newOperators.map((robot) => (
              <Link
                key={robot.owner.id}
                href={`/robot/${robot.owner.username}/${robot.slug}`}
                className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition hover:border-sky-400/30"
              >
                <p className="text-sm font-semibold">
                  {robot.owner.displayName ?? robot.owner.username}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">Launched {robot.name}</p>
                <p className="mt-3 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  Joined {new Date(robot.createdAt).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
