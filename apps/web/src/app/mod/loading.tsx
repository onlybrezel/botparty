export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-[var(--border)]" />
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2"
          >
            <div className="h-4 w-1/2 rounded bg-[var(--border)]" />
            <div className="h-3 w-full rounded bg-[var(--border)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
