import type { PublicRobotOverview, RobotPublic } from '@botparty/shared';
import { Bot } from 'lucide-react';
import RobotCard from '@/components/robot-card';
import { getServerApiUrl } from '@/lib/server-api-url';
import { isPublicRobotOverview, isRobotPublic, parseJsonArray } from '@/lib/api-response-guards';
import { ExploreFilters } from './explore-filters';

export type ExploreParams = {
  status?: string;
  tag?: string;
  q?: string;
  sort?: string;
  limit?: string;
  offset?: string;
};

function clampPositiveInt(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

async function getRobots(params: ExploreParams): Promise<RobotPublic[]> {
  const apiUrl = getServerApiUrl();
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.tag) qs.set('tag', params.tag);
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);
  if (params.limit) qs.set('limit', params.limit);
  if (params.offset) qs.set('offset', params.offset);

  try {
    const res = await fetch(`${apiUrl}/api/v1/robots?${qs.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    return parseJsonArray(await res.json(), isRobotPublic);
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
    const payload: unknown = await res.json();
    return isPublicRobotOverview(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function ExploreResults({
  params,
  filterAction = '/explore/search',
}: {
  params: ExploreParams;
  filterAction?: string;
}) {
  const pageSize = clampPositiveInt(params.limit, 24, 80);
  const offset = clampPositiveInt(params.offset, 0, 10_000);
  const [robots, overview] = await Promise.all([getRobots(params), getOverview()]);
  const liveCount = robots.filter((robot) => robot.status === 'ONLINE' || robot.status === 'BUSY').length;
  const hasMore = robots.length >= pageSize;
  const nextParams = new URLSearchParams();
  if (params.status) nextParams.set('status', params.status);
  if (params.tag) nextParams.set('tag', params.tag);
  if (params.q) nextParams.set('q', params.q);
  if (params.sort) nextParams.set('sort', params.sort);
  nextParams.set('limit', String(pageSize));
  nextParams.set('offset', String(offset + pageSize));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <div className="mb-6 sm:mb-7">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Explore robot rooms</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {robots.length === 0
              ? 'No robots found'
              : `${robots.length} room${robots.length !== 1 ? 's' : ''} listed · ${liveCount} live right now`}
          </p>
        </div>
      </div>

      <ExploreFilters
        action={filterAction}
        {...(params.q ? { q: params.q } : {})}
        {...(params.status ? { status: params.status } : {})}
        {...(params.sort ? { sort: params.sort } : {})}
        {...(params.tag ? { tag: params.tag } : {})}
      />

      {overview && overview.topTags.length > 0 && !params.q && (
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            Browse by tag
          </p>
          <div className="flex flex-wrap gap-2">
            {overview.topTags.slice(0, 10).map((tag) => (
              <a
                key={tag.tag}
                href={`/explore/search?tag=${encodeURIComponent(tag.tag)}`}
                className={`rounded-md border px-3 py-2 text-sm transition ${
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

      {robots.length === 0 ? (
        <div className="flex flex-col items-center justify-center border border-dashed border-[var(--border)] py-16 text-center">
          <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
            <Bot className="h-8 w-8 text-[var(--muted-foreground)]" />
          </div>
          <p className="font-medium text-[var(--muted-foreground)]">No robots found</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {params.q || params.status || params.tag
              ? 'Try a different host, status, or exact tag'
              : 'No public rooms are available yet.'}
          </p>
          {!(params.q || params.status || params.tag) && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <a
                href="/dashboard/robots/new"
                className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
              >
                Host the first robot
              </a>
              <a
                href="/docs"
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--primary)]"
              >
                Read the host guide
              </a>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {robots.map((robot) => (
              <RobotCard key={robot.id} robot={robot} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <a
                href={`/explore/search?${nextParams.toString()}`}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--primary)]"
              >
                Load more rooms
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
