'use client';

export function TelemetryBars({
  title,
  values,
  suffix,
}: {
  title: string;
  values: number[];
  suffix: string;
}) {
  const recent = values.slice(-24);
  const current = recent.length > 0 ? (recent[recent.length - 1] ?? null) : null;

  return (
    <div className="rounded border border-[var(--border)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{title}</p>
        <p className="text-xs font-semibold">{current === null ? '-' : `${Math.round(current)}${suffix}`}</p>
      </div>
      {recent.length === 0 ? (
        <p className="text-[10px] text-[var(--muted-foreground)]">No recent samples</p>
      ) : (
        <div className="flex h-14 items-end gap-1">
          {recent.map((value, idx) => (
            <div
              key={`${title}-${idx}`}
              className="flex-1 rounded-sm bg-[var(--primary)]/60"
              style={{ height: `${Math.max(8, Math.min(100, value))}%` }}
              title={`${Math.round(value)}${suffix}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
