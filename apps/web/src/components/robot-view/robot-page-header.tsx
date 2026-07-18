import Link from 'next/link';
import type { ReconnectNotice } from './types';

type Props = {
  robotName: string;
  connected: boolean;
  viewerLabel: string;
  reconnectNotice: ReconnectNotice | null;
  reconnectSeconds: number | null;
  robotStatus: string;
  queueSummary: string;
};

export function RobotPageHeader({
  robotName,
  connected,
  viewerLabel,
  reconnectNotice,
  reconnectSeconds,
  robotStatus,
  queueSummary,
}: Props) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Link href="/explore" prefetch={false} className="hover:text-[var(--foreground)] transition-colors">
          Explore
        </Link>
        <span>/</span>
        <span className="max-w-full truncate text-[var(--foreground)]">{robotName}</span>
        <div className="ml-0 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 sm:ml-auto">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-[var(--online)]' : 'bg-zinc-600'}`} />
          <span className="text-xs">{viewerLabel}</span>
        </div>
      </div>

      {reconnectNotice && !connected && (
        <div
          role="status"
          aria-live="polite"
          className="sticky top-4 z-20 mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 backdrop-blur"
        >
          <p className="font-medium">
            {reconnectNotice.reason === 'maintenance'
              ? 'Maintenance window'
              : reconnectNotice.reason === 'update' || reconnectNotice.reason === 'deploy'
                ? 'Update in progress'
                : 'Realtime restart'}
          </p>
          <p className="mt-1 text-amber-100/85">
            {reconnectNotice.message}
            {reconnectSeconds !== null ? ` Trying again in about ${reconnectSeconds}s.` : ''}
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:hidden">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Status</p>
          <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
            {robotStatus.charAt(0) + robotStatus.slice(1).toLowerCase()}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Queue</p>
          <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">{queueSummary}</p>
        </div>
      </div>
    </>
  );
}
