import type { Viewer } from './types';

interface Props {
  viewers: Viewer[];
}

export function RobotViewersList({ viewers }: Props) {
  if (viewers.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Watching ({viewers.length})
      </p>
      <div className="flex flex-wrap gap-1">
        {viewers.slice(0, 15).map((v) => (
          <span
            key={v.userId}
            className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]"
            title={v.username}
          >
            {v.username.slice(0, 14)}
          </span>
        ))}
        {viewers.length > 15 && (
          <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
            +{viewers.length - 15}
          </span>
        )}
      </div>
    </div>
  );
}
