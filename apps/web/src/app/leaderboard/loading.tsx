export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-[var(--border)]" />
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="h-6 w-6 shrink-0 rounded bg-[var(--border)]" />
            <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--border)]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-1/3 rounded bg-[var(--border)]" />
              <div className="h-3 w-1/4 rounded bg-[var(--border)]" />
            </div>
            <div className="h-4 w-16 rounded bg-[var(--border)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
