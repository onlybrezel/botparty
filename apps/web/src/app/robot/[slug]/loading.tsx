export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 animate-pulse space-y-4">
          <div className="aspect-video w-full rounded-xl bg-[var(--border)]" />
          <div className="h-6 w-1/2 rounded bg-[var(--border)]" />
          <div className="h-4 w-3/4 rounded bg-[var(--border)]" />
        </div>
        <div className="space-y-4">
          <div className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
            <div className="h-5 w-1/3 rounded bg-[var(--border)]" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 w-full rounded-lg bg-[var(--border)]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
