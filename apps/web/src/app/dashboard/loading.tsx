import { RobotCardGridSkeleton } from '@/components/dashboard/robot-card-grid-skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-xl bg-[var(--border)]" />
          <div className="space-y-2">
            <div className="h-8 w-52 animate-pulse rounded-md bg-[var(--border)]" />
            <div className="h-4 w-72 max-w-full animate-pulse rounded-md bg-[var(--border)]" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <div className="mb-4 h-6 w-24 animate-pulse rounded bg-[var(--border)]" />
        <RobotCardGridSkeleton />
      </div>
    </div>
  );
}
