import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { PublicRobotOverview, RobotPublic } from '@botparty/shared';
import RobotCard from '@/components/robot-card';
import { Bot } from 'lucide-react';
import { ExploreFilters } from './explore-filters';
import { ExploreAutoRefresh } from './explore-refresh';
import { getServerApiUrl } from '@/lib/server-api-url';

export const metadata: Metadata = {
  title: 'Explore Robots',
  description: 'Browse live robot rooms, watch what is online, and jump into the queue.',
  openGraph: {
    title: 'Explore Robots — BotParty',
    description: 'Browse live robot rooms, watch what is online, and jump into the queue.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Explore Robots — BotParty',
    description: 'Browse live robot rooms, watch what is online, and jump into the queue.',
  },
};

export const revalidate = 30;

async function getRobots(params: { status?: string; tag?: string; q?: string; sort?: string }): Promise<RobotPublic[]> {
  const apiUrl = getServerApiUrl();
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.tag) qs.set('tag', params.tag);
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);

  try {
    const res = await fetch(`${apiUrl}/api/v1/robots?${qs.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    return res.json() as Promise<RobotPublic[]>;
  } catch {
    return [];
  }
}

async function getOverview(): Promise<PublicRobotOverview | null> {
  const apiUrl = getServerApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots/overview`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<PublicRobotOverview>;
  } catch {
    return null;
  }
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tag?: string; q?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const [robots, overview] = await Promise.all([getRobots(params), getOverview()]);
  const liveCount = robots.filter((r) => r.status === 'ONLINE' || r.status === 'BUSY').length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <ExploreAutoRefresh />
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Explore robot rooms</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {robots.length === 0
              ? 'No robots found'
              : `${robots.length} room${robots.length !== 1 ? 's' : ''} listed · ${liveCount} live right now`}
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {liveCount} available right now
        </div>
      </div>

      {/* Filters */}
      <Suspense>
        <ExploreFilters q={params.q} status={params.status} sort={params.sort} tag={params.tag} />
      </Suspense>

      {overview && overview.topTags.length > 0 && !params.q && (
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            Browse by tag
          </p>
          <div className="flex flex-wrap gap-2">
            {overview.topTags.slice(0, 10).map((tag) => (
              <a
                key={tag.tag}
                href={`/explore?tag=${encodeURIComponent(tag.tag)}`}
                className={`rounded-full border px-3 py-2 text-sm transition ${
                  params.tag === tag.tag
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                    : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {tag.tag} · {tag.count}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      {robots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-20 text-center">
          <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
            <Bot className="h-8 w-8 text-[var(--muted-foreground)]" />
          </div>
          <p className="font-medium text-[var(--muted-foreground)]">No robots found</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {params.q || params.status || params.tag
              ? 'Try a different host, status, or exact tag'
              : 'Nothing is listed yet. The first good room sets the tone.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {robots.map((robot) => (
            <RobotCard key={robot.id} robot={robot} />
          ))}
        </div>
      )}
    </div>
  );
}
