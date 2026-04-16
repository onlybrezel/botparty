import type { Metadata } from 'next';
import Link from 'next/link';
import type { PublicRobotOverview, RobotPublic } from '@botparty/shared';
import { Trophy, Eye, Radio, Clock3 } from 'lucide-react';

type CreatorLeaderboardEntry = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  credits: number;
};

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
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots`);
    if (!res.ok) return [];
    return res.json() as Promise<RobotPublic[]>;
  } catch {
    return [];
  }
}

async function getTopCreators(): Promise<CreatorLeaderboardEntry[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/api/v1/users/leaderboard?limit=10`);
    if (!res.ok) return [];
    return res.json() as Promise<CreatorLeaderboardEntry[]>;
  } catch {
    return [];
  }
}

async function getOverview(): Promise<PublicRobotOverview | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots/overview`);
    if (!res.ok) return null;
    return res.json() as Promise<PublicRobotOverview>;
  } catch {
    return null;
  }
}

function statusColor(status: RobotPublic['status']) {
  if (status === 'ONLINE') return 'text-[var(--online)] bg-[var(--online)]/15';
  if (status === 'BUSY') return 'text-amber-400 bg-amber-500/15';
  if (status === 'MAINTENANCE') return 'text-orange-400 bg-orange-600/15';
  return 'text-zinc-400 bg-zinc-700/40';
}

export default async function LeaderboardPage() {
  const [robots, creators, overview] = await Promise.all([getRobots(), getTopCreators(), getOverview()]);
  const ranked = [...robots].sort((a, b) => b.viewerCount - a.viewerCount);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <section className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/15">
            <Trophy className="h-5 w-5 text-violet-300" />
          </span>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Leaderboard</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              A quick look at which rooms have attention right now.
            </p>
          </div>
        </div>
      </section>

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
                  className={`col-span-3 sm:col-span-2 inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(robot.status)}`}
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

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <Radio className="h-4 w-4 text-violet-300" />
            Online robots
          </p>
          <p className="mt-2 text-2xl font-black">
            {overview ? overview.totals.liveRobots : ranked.filter((r) => r.status === 'ONLINE' || r.status === 'BUSY').length}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <Eye className="h-4 w-4 text-violet-300" />
            Total live viewers
          </p>
          <p className="mt-2 text-2xl font-black">
            {overview ? overview.totals.totalViewers : ranked.reduce((sum, r) => sum + r.viewerCount, 0)}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <Clock3 className="h-4 w-4 text-violet-300" />
            Ranked entries
          </p>
          <p className="mt-2 text-2xl font-black">{ranked.length}</p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Top Creators (Credits)</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Hosts ranked by current credit totals</p>
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
                  <span className="w-6 text-xs font-bold text-[var(--muted-foreground)]">{index + 1}</span>
                  <span className="truncate text-sm font-medium">
                    {creator.displayName ?? creator.username}
                  </span>
                </div>
                <span className="text-sm font-semibold text-amber-300">{creator.credits} cr</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
