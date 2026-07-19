import { Select } from '@/components/ui/select';
import { Search } from 'lucide-react';

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
      className="mb-6 border-y border-[var(--border)] py-3 sm:mb-7"
    >
      {tag ? <input type="hidden" name="tag" value={tag} /> : null}
      <div className="grid gap-2 md:grid-cols-[minmax(260px,2fr)_minmax(150px,1fr)_minmax(150px,1fr)_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search robot names, hosts, descriptions, or an exact tag..."
            className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-10 pr-3 text-sm outline-none transition-colors focus:border-[var(--primary)]"
          />
        </div>

        <Select name="status" defaultValue={status ?? ''} aria-label="Robot status" className="h-11 bg-[var(--background)]">
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select name="sort" defaultValue={sort ?? ''} aria-label="Sort order" className="h-11 bg-[var(--background)]">
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <div className="flex gap-2">
          <button
            type="submit"
            aria-label="Apply filters"
            className="h-11 rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
          >
            Apply
          </button>
          {hasFilters ? (
            <a
              href="/explore"
              className="inline-flex h-11 items-center rounded-lg border border-[var(--border)] px-4 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            >
              Clear
            </a>
          ) : null}
        </div>
      </div>
    </form>
  );
}
