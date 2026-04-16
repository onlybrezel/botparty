export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 h-10 w-48 animate-pulse rounded-md bg-[var(--border)]" />
      <div className="mb-6 flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-[var(--border)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="aspect-video w-full rounded-t-xl bg-[var(--border)]" />
            <div className="p-4 space-y-2">
              <div className="h-5 w-3/4 rounded bg-[var(--border)]" />
              <div className="h-4 w-1/2 rounded bg-[var(--border)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
