type Props = {
  count?: number;
};

export function RobotCardGridSkeleton({ count = 6 }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading robot cards"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]"
        >
          <div className="relative h-28 animate-pulse bg-[var(--muted)]">
            <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.12), transparent 55%)' }} />
            <div className="absolute left-2 top-2 h-5 w-14 rounded-full bg-black/20" />
          </div>

          <div className="space-y-3 p-3">
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--border)]" />
            <div className="h-3 w-20 animate-pulse rounded bg-[var(--border)]" />
            <div className="flex flex-wrap gap-1.5">
              <div className="h-5 w-12 animate-pulse rounded-full bg-[var(--border)]" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-[var(--border)]" />
              <div className="h-5 w-10 animate-pulse rounded-full bg-[var(--border)]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}