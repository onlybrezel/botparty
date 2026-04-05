import type { Metadata } from 'next';
import type { PublicRobotOverview, RobotPublic } from '@botparty/shared';
import RobotCard from '@/components/robot-card';
import { Search, SlidersHorizontal, Bot } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Explore Robots',
  description: 'Browse live robots and take control in real-time.',
};

async function getRobots(params: { status?: string; tag?: string; q?: string; sort?: string }): Promise<RobotPublic[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.tag) qs.set('tag', params.tag);
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);

  try {
    const res = await fetch(`${apiUrl}/api/v1/robots?${qs.toString()}`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) return [];
    return res.json() as Promise<RobotPublic[]>;
  } catch {
    return [];
  }
}

async function getOverview(): Promise<PublicRobotOverview | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
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

const STATUS_OPTIONS = [
  { value: '', label: 'All robots' },
  { value: 'ONLINE', label: 'Online now' },
  { value: 'OFFLINE', label: 'Offline' },
];

const SORT_OPTIONS = [
  { value: '', label: 'Featured first' },
  { value: 'new', label: 'Newest' },
  { value: 'sessions', label: 'Most active' },
  { value: 'name', label: 'Name A-Z' },
];

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tag?: string; q?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const [robots, overview] = await Promise.all([getRobots(params), getOverview()]);
  const liveCount = robots.filter((r) => r.status === 'ONLINE' || r.status === 'BUSY').length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-3xl font-black tracking-tight">Explore Robots</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {robots.length === 0
            ? 'No robots found'
            : `${robots.length} robot${robots.length !== 1 ? 's' : ''} · ${liveCount} live`}
        </p>
      </div>

      {/* Filters */}
      <form method="get" className="mb-7 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search robots, tags, creators..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-9 pr-4 text-sm outline-none transition-colors focus:border-[var(--primary)]"
          />
          </div>

          <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
            <SlidersHorizontal className="h-4 w-4 text-[var(--muted-foreground)]" />
            <select
              name="status"
              defaultValue={params.status ?? ''}
              className="bg-transparent px-1 py-1 text-sm outline-none"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
            <select
              name="sort"
              defaultValue={params.sort ?? ''}
              className="bg-transparent px-1 py-1 text-sm outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--primary-hover)]"
          >
            Apply filters
          </button>

          {(params.status || params.q || params.tag || params.sort) && (
            <a
              href="/explore"
              className="text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            >
              Clear
            </a>
          )}
        </div>
      </form>

      {overview && overview.topTags.length > 0 && !params.q && (
        <div className="mb-6 flex flex-wrap gap-2">
          {overview.topTags.slice(0, 10).map((tag) => (
            <a
              key={tag.tag}
              href={`/explore?tag=${encodeURIComponent(tag.tag)}`}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                params.tag === tag.tag
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                  : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {tag.tag} · {tag.count}
            </a>
          ))}
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
              ? 'Try different search terms'
              : 'Be the first to connect one!'}
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
