import { Select } from '@/components/ui/select';
import { Search, SlidersHorizontal } from 'lucide-react';

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

type Props = {
  action?: string;
  q?: string;
  status?: string;
  sort?: string;
  tag?: string;
};

export function ExploreFilters({ action = '/explore/search', q, status, sort, tag }: Props) {
  const hasFilters = !!(q || status || tag || sort);

  return (
    <form
      action={action}
      method="get"
      className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 sm:mb-7 sm:p-4"
    >
      {tag ? <input type="hidden" name="tag" value={tag} /> : null}
      <div className="flex flex-col gap-3">
        {/* Search */}
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search robot names, hosts, descriptions, or an exact tag..."
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] py-3 pl-10 pr-4 text-sm outline-none transition-colors focus:border-[var(--primary)]"
          />
        </div>

        {/* Select filters + clear */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
          <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-sm text-[var(--muted-foreground)]">
            <SlidersHorizontal className="h-4 w-4 flex-shrink-0" />
            <span className="sr-only">Robot status</span>
            <Select
              name="status"
              defaultValue={status ?? ''}
              className="w-full border-0 bg-transparent px-0 py-0 pr-7 text-sm outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-sm text-[var(--muted-foreground)]">
            <span className="sr-only">Sort order</span>
            <Select
              name="sort"
              defaultValue={sort ?? ''}
              className="w-full border-0 bg-transparent px-0 py-0 pr-7 text-sm outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
            >
              Apply filters
            </button>
            {hasFilters ? (
              <a
                href="/explore"
                className="rounded-xl border border-[var(--border)] px-4 py-3 text-center text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
              >
                Clear
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}
