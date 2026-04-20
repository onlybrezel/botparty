function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[var(--border)] ${className}`} />;
}

export function RobotRoomSkeleton() {
  return (
    <div
      className="mx-auto max-w-6xl px-4 py-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading robot room"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <SkeletonBlock className="h-8 w-44" />
          <SkeletonBlock className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <SkeletonBlock className="h-9 w-24 rounded-lg" />
          <SkeletonBlock className="h-9 w-24 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3" aria-hidden="true">
        <div className="space-y-4 lg:col-span-2">
          <div className="aspect-video w-full animate-pulse rounded-xl border border-[var(--border)] bg-[var(--muted)]" />

          <div className="flex flex-wrap items-center gap-2">
            <SkeletonBlock className="h-9 w-24 rounded-lg" />
            <SkeletonBlock className="h-9 w-20 rounded-lg" />
            <SkeletonBlock className="hidden h-4 w-40 sm:block" />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <SkeletonBlock className="h-3 w-20" />
              <SkeletonBlock className="h-3 w-16" />
            </div>

            <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-start">
              <div className="mx-auto grid grid-cols-3 gap-2 sm:mx-0">
                {Array.from({ length: 9 }).map((_, index) => (
                  <SkeletonBlock key={index} className="h-12 w-12 rounded-lg" />
                ))}
              </div>

              <div className="flex flex-wrap items-start gap-3">
                <SkeletonBlock className="h-12 w-28 rounded-lg" />
                <SkeletonBlock className="h-24 w-24 rounded-2xl" />
                <SkeletonBlock className="h-24 w-24 rounded-2xl" />
              </div>

              <SkeletonBlock className="hidden h-11 w-px self-center sm:block" />
              <SkeletonBlock className="h-14 w-full max-w-[12rem] rounded-xl sm:w-28" />
            </div>

            <SkeletonBlock className="mt-3 h-3 w-72 max-w-full" />
            <SkeletonBlock className="mt-2 h-3 w-60 max-w-full" />
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <SkeletonBlock className="h-6 w-36" />
                <SkeletonBlock className="h-4 w-28" />
              </div>
              <SkeletonBlock className="h-6 w-16 rounded-full" />
            </div>
            <SkeletonBlock className="mt-3 h-4 w-full" />
            <SkeletonBlock className="mt-2 h-4 w-5/6" />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <SkeletonBlock className="h-9 w-full rounded-lg" />
              <SkeletonBlock className="h-9 w-full rounded-lg" />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <SkeletonBlock className="h-6 w-14 rounded-full" />
              <SkeletonBlock className="h-6 w-16 rounded-full" />
              <SkeletonBlock className="h-6 w-12 rounded-full" />
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <SkeletonBlock className="mb-3 h-3 w-16" />
            <div className="space-y-2">
              <SkeletonBlock className="h-8 w-full rounded-lg" />
              <SkeletonBlock className="h-8 w-full rounded-lg" />
              <SkeletonBlock className="h-8 w-5/6 rounded-lg" />
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <SkeletonBlock className="mb-3 h-3 w-24" />
            <SkeletonBlock className="h-10 w-full rounded-lg" />
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-5 w-5 rounded-full" />
                <SkeletonBlock className="h-4 w-28" />
              </div>
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-5 w-5 rounded-full" />
                <SkeletonBlock className="h-4 w-24" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <SkeletonBlock className="mb-3 h-3 w-12" />
            <div className="space-y-2 rounded-lg bg-[var(--background)] px-2 py-2">
              <SkeletonBlock className="h-12 w-full rounded-md" />
              <SkeletonBlock className="h-12 w-full rounded-md" />
              <SkeletonBlock className="h-12 w-5/6 rounded-md" />
            </div>
            <div className="mt-3 flex gap-2">
              <SkeletonBlock className="h-10 flex-1 rounded-lg" />
              <SkeletonBlock className="h-10 w-20 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}