export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-[var(--border)]" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3"
          >
            <div className="h-5 w-1/2 rounded bg-[var(--border)]" />
            <div className="h-4 w-full rounded bg-[var(--border)]" />
            <div className="h-4 w-3/4 rounded bg-[var(--border)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
